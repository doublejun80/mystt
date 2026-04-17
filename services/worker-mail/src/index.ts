import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import type { SessionRecord } from "@mystt/audio-core";
import type { SessionNotes } from "@mystt/notes-schema";
import nodemailer from "nodemailer";

import { loadRepoEnv, readJsonFile, requireEnv } from "../../../scripts/env";

export interface EmailPayload {
  subject: string;
  text: string;
  html: string;
  from: string;
  to: string[];
}

export interface BuildMailInput {
  session: SessionRecord;
  notes: SessionNotes;
  portalBaseUrl?: string;
}

export interface MailDeliveryInput {
  payload: EmailPayload;
  send?: boolean;
  dryRun?: boolean;
}

export function renderNotesEmail(input: BuildMailInput): EmailPayload {
  const portalBaseUrl = input.portalBaseUrl ?? "https://app.localhost";
  const session = input.session;
  const notes = input.notes;
  const subject = `[회의록] ${session.projectKey ?? "general"} / ${session.startedAt.slice(0, 10)} / ${session.title}`;
  const portalUrl = `${portalBaseUrl}/sessions/${session.id}`;

  const actionItems =
    notes.mode === "meeting"
      ? notes.actionItems
      : notes.mode === "speech"
        ? []
        : [];

  const lines = [
    notes.summary,
    "",
    "Action items:",
    ...(actionItems.length > 0
      ? actionItems.map(
          (item) => `- ${item.task} / ${item.owner ?? "Unassigned"} / ${item.dueDate ?? "No due date"}`
        )
      : ["- None"])
    ,
    "",
    `Portal: ${portalUrl}`
  ];

  const html = `
    <section style="font-family: Arial, sans-serif; color: #1f2b23; line-height: 1.6;">
      <h1>${subject}</h1>
      <p>${notes.summary}</p>
      <h2>Action items</h2>
      <ul>
        ${
          actionItems.length > 0
            ? actionItems
                .map(
                  (item) =>
                    `<li><strong>${item.task}</strong> · ${item.owner ?? "Unassigned"} · ${
                      item.dueDate ?? "No due date"
                    }</li>`
                )
                .join("")
            : "<li>None</li>"
        }
      </ul>
      <p><a href="${portalUrl}">Open portal session</a></p>
    </section>
  `.trim();

  return {
    subject,
    text: lines.join("\n"),
    html,
    from: process.env.MAIL_FROM ?? "notes@mystt.local",
    to: []
  };
}

async function sendEmail(payload: EmailPayload): Promise<{ messageId?: string }> {
  const host = process.env.MAIL_HOST ?? "mailpit";
  const port = Number(process.env.MAIL_PORT ?? "1025");
  const secure = String(process.env.MAIL_SECURE ?? "false") === "true";

  const transport = nodemailer.createTransport({
    host,
    port,
    secure
  });

  const result = await transport.sendMail({
    from: payload.from,
    to: payload.to.join(", "),
    subject: payload.subject,
    text: payload.text,
    html: payload.html
  });

  return {
    messageId: result.messageId
  };
}

export async function deliverNotesEmail(input: MailDeliveryInput) {
  if (input.dryRun || !input.send) {
    return {
      sent: false,
      payload: input.payload
    };
  }

  if (!input.payload.to.length) {
    throw new Error("Provide at least one recipient with --to.");
  }

  const result = await sendEmail(input.payload);
  return {
    sent: true,
    messageId: result.messageId,
    payload: input.payload
  };
}

export async function runMailCli(argv = process.argv.slice(2)) {
  loadRepoEnv();

  const { values } = parseArgs({
    options: {
      session_file: { type: "string" },
      notes_file: { type: "string" },
      to: { type: "string" },
      portal_base_url: { type: "string", default: "https://app.localhost" },
      send: { type: "boolean", default: false },
      dry_run: { type: "boolean", default: false }
    },
    args: argv,
    strict: false
  });

  if (!values.session_file || !values.notes_file) {
    throw new Error("Provide --session_file and --notes_file.");
  }

  const session = readJsonFile<SessionRecord>(String(values.session_file));
  const notes = readJsonFile<SessionNotes>(String(values.notes_file));
  const payload = {
    ...renderNotesEmail({
      session,
      notes,
      portalBaseUrl: String(values.portal_base_url)
    }),
    to: String(values.to ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  };

  const result = await deliverNotesEmail({
    payload,
    send: Boolean(values.send),
    dryRun: Boolean(values.dry_run)
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runMailCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
