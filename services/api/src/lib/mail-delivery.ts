import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import nodemailer from "nodemailer";

import { apiConfig } from "../config";

const execFileAsync = promisify(execFile);

export type MailDeliveryMode = "auto" | "smtp" | "mailapp";
export type ResolvedMailDeliveryMode = "smtp" | "mailapp";

export interface MailMessageInput {
  from?: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: MailMessageAttachment[];
}

export interface MailMessageAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

function isLocalSmtpHost(host: string) {
  return ["127.0.0.1", "localhost", "mailpit"].includes(host);
}

export function resolveMailDeliveryMode(): ResolvedMailDeliveryMode {
  if (apiConfig.MAIL_DELIVERY_MODE === "smtp") {
    return "smtp";
  }

  if (apiConfig.MAIL_DELIVERY_MODE === "mailapp") {
    return "mailapp";
  }

  return process.platform === "darwin" && isLocalSmtpHost(apiConfig.MAIL_HOST)
    ? "mailapp"
    : "smtp";
}

async function runAppleScript(script: string, args: string[]) {
  const tempDir = await mkdtemp(join(tmpdir(), "mystt-mailapp-"));
  const scriptPath = join(tempDir, "mail.applescript");

  try {
    await writeFile(scriptPath, script, "utf8");
    return await execFileAsync("osascript", [scriptPath, ...args], {
      timeout: 15000
    });
  } finally {
    await rm(tempDir, {
      recursive: true,
      force: true
    });
  }
}

export async function listMailAppAccounts(): Promise<string[]> {
  if (process.platform !== "darwin") {
    return [];
  }

  const script = `
on run
  tell application "Mail"
    set AppleScript's text item delimiters to ", "
    return email addresses of every account as string
  end tell
end run
  `.trim();

  const result = await runAppleScript(script, []);
  return result.stdout
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function sendViaSmtp(input: MailMessageInput) {
  const transport = nodemailer.createTransport({
    host: apiConfig.MAIL_HOST,
    port: apiConfig.MAIL_PORT,
    secure: apiConfig.MAIL_SECURE,
    auth:
      apiConfig.MAIL_USER && apiConfig.MAIL_PASSWORD
        ? {
            user: apiConfig.MAIL_USER,
            pass: apiConfig.MAIL_PASSWORD
          }
        : undefined
  });

  const result = await transport.sendMail({
    from: input.from ?? apiConfig.MAIL_FROM,
    to: input.to.join(", "),
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType
    }))
  });

  return {
    mode: "smtp" as const,
    messageId: result.messageId,
    accepted: result.accepted
  };
}

function sanitizeAttachmentFilename(fileName: string) {
  return fileName.replace(/[^\w.\-가-힣]+/g, "_");
}

async function sendViaMailApp(input: MailMessageInput) {
  const tempDir = await mkdtemp(join(tmpdir(), "mystt-mailapp-"));
  const script = `
on run argv
  set recipientBlob to item 1 of argv
  set messageSubject to item 2 of argv
  set messageBody to item 3 of argv
  set attachmentBlob to item 4 of argv
  set AppleScript's text item delimiters to linefeed
  set recipientList to every text item of recipientBlob
  set attachmentList to every text item of attachmentBlob

  tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:messageSubject, content:messageBody & return & return, visible:false}

    tell newMessage
      repeat with recipientAddress in recipientList
        if recipientAddress is not "" then
          make new to recipient at end of to recipients with properties {address:recipientAddress}
        end if
      end repeat

      repeat with attachmentPath in attachmentList
        if attachmentPath is not "" then
          make new attachment with properties {file name:(POSIX file attachmentPath as alias)} at after the last paragraph
        end if
      end repeat

      send
    end tell
  end tell

  return "sent"
end run
  `.trim();

  const attachmentPaths: string[] = [];

  try {
    for (const attachment of input.attachments ?? []) {
      const targetPath = join(tempDir, sanitizeAttachmentFilename(attachment.filename));
      await writeFile(targetPath, attachment.content);
      attachmentPaths.push(targetPath);
    }

    const scriptPath = join(tempDir, "mail.applescript");
    await writeFile(scriptPath, script, "utf8");
    await execFileAsync(
      "osascript",
      [scriptPath, input.to.join("\n"), input.subject, input.text, attachmentPaths.join("\n")],
      {
        timeout: 20000
      }
    );
  } finally {
    await rm(tempDir, {
      recursive: true,
      force: true
    });
  }

  return {
    mode: "mailapp" as const,
    messageId: `mailapp:${Date.now()}`,
    accepted: input.to
  };
}

export async function sendMailMessage(input: MailMessageInput) {
  const mode = resolveMailDeliveryMode();
  return mode === "mailapp" ? sendViaMailApp(input) : sendViaSmtp(input);
}

export async function getMailDeliveryStatus() {
  const resolvedMode = resolveMailDeliveryMode();
  const status = {
    configured: true,
    requestedMode: apiConfig.MAIL_DELIVERY_MODE,
    resolvedMode,
    from: apiConfig.MAIL_FROM,
    smtp: {
      host: apiConfig.MAIL_HOST,
      port: apiConfig.MAIL_PORT,
      secure: apiConfig.MAIL_SECURE,
      authConfigured: Boolean(apiConfig.MAIL_USER && apiConfig.MAIL_PASSWORD)
    },
    mailapp: {
      available: false,
      accounts: [] as string[]
    },
    lastError: null as string | null
  };

  if (process.platform === "darwin") {
    try {
      const accounts = await listMailAppAccounts();
      status.mailapp.available = accounts.length > 0;
      status.mailapp.accounts = accounts;
    } catch (error) {
      status.lastError =
        error instanceof Error ? error.message : "Mail.app account lookup failed";
    }
  }

  return status;
}
