import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
  createSessionRecord,
  type SessionMode,
  type SessionRecord
} from "../packages/audio-core/src/index";
import type { SessionNotes } from "../packages/notes-schema/src/index";

import { loadRepoEnv, readJsonFile } from "./env";
import {
  createSonioxTranscriptionJob,
  getSonioxTranscript,
  waitForSonioxTranscription,
  type NormalizedSonioxTranscript
} from "../services/worker-transcribe/src/index";
import { summarizeTranscript } from "../services/worker-summarize/src/index";
import {
  deliverNotesEmail,
  renderNotesEmail,
  type EmailPayload
} from "../services/worker-mail/src/index";

function buildDemoTranscript(sessionId: string, title: string): NormalizedSonioxTranscript {
  return {
    transcriptionId: `demo_${sessionId}`,
    sessionId,
    languageHints: ["ko", "en"],
    tokens: [
      {
        text: "이번 주 금요일까지",
        startMs: 0,
        endMs: 1200,
        speaker: "Mina",
        language: "ko",
        confidence: 0.97
      },
      {
        text: "launch checklist",
        startMs: 1200,
        endMs: 2200,
        speaker: "Mina",
        language: "en",
        confidence: 0.91
      }
    ],
    segments: [
      {
        id: "seg_1",
        speaker: "Mina",
        language: "ko",
        startMs: 0,
        endMs: 2200,
        text: `${title}의 launch checklist를 이번 주 금요일까지 정리합니다.`,
        confidence: 0.91,
        tokens: [
          {
            text: "이번 주 금요일까지",
            startMs: 0,
            endMs: 1200,
            speaker: "Mina",
            language: "ko",
            confidence: 0.97
          },
          {
            text: "launch checklist",
            startMs: 1200,
            endMs: 2200,
            speaker: "Mina",
            language: "en",
            confidence: 0.91
          }
        ]
      }
    ]
  };
}

function buildSession(values: Record<string, unknown>): SessionRecord {
  return createSessionRecord({
    id: String(values.session_id ?? `sess_${Date.now()}`),
    title: String(values.title ?? "Untitled Session"),
    mode: String(values.mode ?? "meeting") as SessionMode,
    projectKey: values.project ? String(values.project) : undefined
  });
}

export async function runVerticalSliceCli(argv = process.argv.slice(2)) {
  loadRepoEnv();

  const { values } = parseArgs({
    options: {
      audio_url: { type: "string" },
      file_id: { type: "string" },
      session_id: { type: "string" },
      title: { type: "string", default: "Untitled Session" },
      mode: { type: "string", default: "meeting" },
      project: { type: "string" },
      language_hints: { type: "string", default: "ko,en" },
      webhook_url: { type: "string" },
      wait: { type: "boolean", default: true },
      dry_run: { type: "boolean", default: false },
      cleanup: { type: "boolean", default: false },
      send: { type: "boolean", default: false },
      to: { type: "string" },
      portal_base_url: { type: "string", default: "https://app.localhost" },
      transcript_file: { type: "string" },
      notes_file: { type: "string" }
    },
    args: argv,
    strict: false
  });

  const session = buildSession(values);
  const languageHints = String(values.language_hints ?? "ko,en");
  const parsedLanguageHints = languageHints
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const mode = String(values.mode ?? "meeting") as SessionMode;

  let transcript: NormalizedSonioxTranscript;
  let sonioxResult: unknown;

  if (values.transcript_file) {
    transcript = readJsonFile<NormalizedSonioxTranscript>(String(values.transcript_file));
    sonioxResult = {
      created: false,
      transcriptionId: transcript.transcriptionId,
      status: "loaded-from-file"
    };
  } else {
    const created = await createSonioxTranscriptionJob({
      sessionId: session.id,
      title: session.title,
      mode,
      audioUrl: values.audio_url ? String(values.audio_url) : undefined,
      fileId: values.file_id ? String(values.file_id) : undefined,
      languageHints: parsedLanguageHints,
      webhookUrl: values.webhook_url ? String(values.webhook_url) : undefined,
      project: session.projectKey,
      wait: Boolean(values.wait),
      fetchTranscript: true,
      cleanup: Boolean(values.cleanup),
      dryRun: Boolean(values.dry_run)
    });

    sonioxResult = created;

    if ("transcript" in created && created.transcript) {
      transcript = created.transcript;
    } else if (created.created && values.wait && !Boolean(values.dry_run)) {
      await waitForSonioxTranscription(created.transcriptionId, 1000);
      transcript = await getSonioxTranscript(created.transcriptionId, {
        sessionId: session.id,
        title: session.title,
        mode,
        languageHints: parsedLanguageHints,
        project: session.projectKey
      });
    } else {
      transcript = buildDemoTranscript(session.id, session.title);
    }
  }

  const notesResult = await summarizeTranscript({
    mode,
    title: session.title,
    transcript,
    project: session.projectKey,
    dryRun: Boolean(values.dry_run)
  });

  const notes = notesResult.notes as SessionNotes;
  const emailPayload = {
    ...renderNotesEmail({
      session,
      notes,
      portalBaseUrl: String(values.portal_base_url ?? "https://app.localhost")
    }),
    to: String(values.to ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  } satisfies EmailPayload;

  const emailResult = await deliverNotesEmail({
    payload: emailPayload,
    send: Boolean(values.send),
    dryRun: Boolean(values.dry_run)
  });

  const payload = {
    session,
    soniox: sonioxResult,
    transcript,
    notes,
    notesResult,
    email: emailResult
  };

  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runVerticalSliceCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
