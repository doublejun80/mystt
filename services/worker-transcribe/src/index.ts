import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import type { SessionMode } from "@mystt/audio-core";

import { loadRepoEnv, readJsonFile, requireEnv } from "../../../scripts/env";

const SONIOX_API_BASE_URL = "https://api.soniox.com";

type RawSonioxToken = {
  text: string;
  speaker?: string;
  language?: string;
  translation_status?: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
};

type RawSonioxTranscript = {
  id?: string;
  transcription_id?: string;
  transcriptionId?: string;
  status?: string;
  error_message?: string;
  tokens?: RawSonioxToken[];
  transcript?: {
    tokens?: RawSonioxToken[];
  };
};

export interface NormalizedSonioxToken {
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string;
  language?: string;
  confidence?: number;
  translationStatus?: string;
}

export interface NormalizedSonioxSegment {
  id: string;
  speaker?: string;
  language?: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  tokens: NormalizedSonioxToken[];
}

export interface NormalizedSonioxTranscript {
  transcriptionId: string;
  sessionId: string;
  languageHints: string[];
  segments: NormalizedSonioxSegment[];
  tokens: NormalizedSonioxToken[];
}

export interface SonioxJobResult {
  transcriptionId: string;
  status: string;
  transcript?: NormalizedSonioxTranscript;
  rawTranscript?: RawSonioxTranscript;
  cleanupTargets: string[];
  created: boolean;
}

export interface CreateSonioxJobInput {
  sessionId: string;
  title: string;
  mode: SessionMode;
  audioUrl?: string;
  fileId?: string;
  languageHints?: string[];
  webhookUrl?: string;
  webhookAuthHeaderName?: string;
  webhookAuthHeaderValue?: string;
  project?: string;
  wait?: boolean;
  fetchTranscript?: boolean;
  cleanup?: boolean;
  pollIntervalMs?: number;
  dryRun?: boolean;
}

type SonioxConfig = {
  model: "stt-async-v4";
  language_hints: string[];
  enable_language_identification: boolean;
  enable_speaker_diarization: boolean;
  context: {
    general: Array<{ key: string; value: string }>;
    text?: string;
    terms?: string[];
  };
  client_reference_id: string;
  audio_url?: string;
  file_id?: string;
  webhook_url?: string;
  webhook_auth_header_name?: string;
  webhook_auth_header_value?: string;
};

function normalizeToken(token: RawSonioxToken): NormalizedSonioxToken {
  return {
    text: token.text,
    startMs: token.start_ms ?? 0,
    endMs: token.end_ms ?? token.start_ms ?? 0,
    speaker: token.speaker,
    language: token.language,
    confidence: token.confidence,
    translationStatus: token.translation_status
  };
}

function groupTokensIntoSegments(
  tokens: NormalizedSonioxToken[]
): NormalizedSonioxSegment[] {
  const segments: NormalizedSonioxSegment[] = [];

  for (const token of tokens) {
    const current = segments.at(-1);
    if (
      !current ||
      current.speaker !== token.speaker ||
      current.language !== token.language ||
      token.startMs - current.endMs > 2_000
    ) {
      segments.push({
        id: `seg_${segments.length + 1}`,
        speaker: token.speaker,
        language: token.language,
        startMs: token.startMs,
        endMs: token.endMs,
        text: token.text,
        confidence: token.confidence,
        tokens: [token]
      });
      continue;
    }

    const currentSegment = segments[segments.length - 1]!;
    currentSegment.endMs = token.endMs;
    currentSegment.text = `${currentSegment.text}${
      currentSegment.text.endsWith(" ") ? "" : " "
    }${token.text}`;
    currentSegment.tokens.push(token);
    currentSegment.confidence =
      currentSegment.confidence === undefined || token.confidence === undefined
        ? currentSegment.confidence ?? token.confidence
        : Math.min(currentSegment.confidence, token.confidence);
  }

  return segments;
}

function normalizeTranscript(
  raw: RawSonioxTranscript,
  input: CreateSonioxJobInput
): NormalizedSonioxTranscript {
  const rawTokens = raw.tokens ?? raw.transcript?.tokens ?? [];
  const tokens = rawTokens.map(normalizeToken);

  return {
    transcriptionId:
      raw.transcription_id ??
      raw.transcriptionId ??
      raw.id ??
      `tx_${input.sessionId}`,
    sessionId: input.sessionId,
    languageHints: input.languageHints ?? ["ko", "en"],
    tokens,
    segments: groupTokensIntoSegments(tokens)
  };
}

function getSonioxHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireEnv("SONIOX_API_KEY")}`,
    "Content-Type": "application/json"
  };
}

async function sonioxFetch<T>(
  path: string,
  init?: RequestInit & { json?: unknown; expectJson?: boolean }
): Promise<T> {
  const response = await fetch(`${SONIOX_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...getSonioxHeaders(),
      ...(init?.headers ?? {})
    },
    body:
      init && "json" in init && init.json !== undefined
        ? JSON.stringify(init.json)
        : init?.body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Soniox HTTP ${response.status}: ${errorText}`);
  }

  if (init?.expectJson === false) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

function buildSonioxConfig(input: CreateSonioxJobInput): SonioxConfig {
  return {
    model: "stt-async-v4",
    language_hints: input.languageHints ?? ["ko", "en"],
    enable_language_identification: true,
    enable_speaker_diarization: true,
    context: {
      general: [
        { key: "session_id", value: input.sessionId },
        { key: "title", value: input.title },
        { key: "mode", value: input.mode },
        ...(input.project ? [{ key: "project", value: input.project }] : [])
      ],
      text: [input.title, input.project, input.mode].filter(Boolean).join("\n"),
      terms: [input.title, input.project].filter((value): value is string => Boolean(value))
    },
    client_reference_id: input.sessionId,
    audio_url: input.audioUrl,
    file_id: input.fileId,
    webhook_url: input.webhookUrl,
    webhook_auth_header_name: input.webhookAuthHeaderName,
    webhook_auth_header_value: input.webhookAuthHeaderValue
  };
}

export async function createSonioxTranscriptionJob(input: CreateSonioxJobInput) {
  if (!input.dryRun && !input.audioUrl && !input.fileId) {
    throw new Error("Provide either audioUrl or fileId.");
  }

  if (input.dryRun) {
    const config = buildSonioxConfig(input);
    return {
      created: false,
      transcriptionId: `dry_${input.sessionId}`,
      status: "dry-run",
      cleanupTargets: [`transcriptions/dry_${input.sessionId}`],
      rawTranscript: undefined,
      transcript: normalizeTranscript(
        {
          transcriptionId: `dry_${input.sessionId}`,
          tokens: []
        },
        input
      ),
      request: config
    };
  }

  const request = buildSonioxConfig(input);
  const created = await sonioxFetch<{ id: string }>("/v1/transcriptions", {
    method: "POST",
    json: request
  });

  return {
    created: true,
    transcriptionId: created.id,
    status: "queued",
    cleanupTargets: [`transcriptions/${created.id}`, ...(input.fileId ? [`files/${input.fileId}`] : [])],
    request
  };
}

export async function getSonioxTranscriptionStatus(transcriptionId: string) {
  return sonioxFetch<{ id: string; status: string; error_message?: string }>(
    `/v1/transcriptions/${transcriptionId}`
  );
}

export async function getSonioxTranscript(
  transcriptionId: string,
  input: Pick<CreateSonioxJobInput, "sessionId" | "languageHints" | "title" | "mode" | "project">
) {
  const raw = await sonioxFetch<RawSonioxTranscript>(
    `/v1/transcriptions/${transcriptionId}/transcript`
  );
  return normalizeTranscript(raw, {
    sessionId: input.sessionId,
    title: input.title,
    mode: input.mode,
    languageHints: input.languageHints,
    project: input.project
  });
}

export async function waitForSonioxTranscription(
  transcriptionId: string,
  pollIntervalMs = 1_000
) {
  while (true) {
    const status = await getSonioxTranscriptionStatus(transcriptionId);
    if (status.status === "completed") {
      return status;
    }

    if (status.status === "error") {
      throw new Error(status.error_message ?? "Soniox transcription failed");
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function deleteSonioxTranscription(transcriptionId: string) {
  await sonioxFetch(`/v1/transcriptions/${transcriptionId}`, {
    method: "DELETE",
    expectJson: false
  });
}

export async function runSonioxCli(argv = process.argv.slice(2)) {
  loadRepoEnv();

  const { values } = parseArgs({
    options: {
      audio_url: { type: "string" },
      file_id: { type: "string" },
      transcription_id: { type: "string" },
      session_id: { type: "string", default: `sess_${Date.now()}` },
      title: { type: "string", default: "Untitled Session" },
      mode: { type: "string", default: "meeting" },
      project: { type: "string" },
      language_hints: { type: "string", default: "ko,en" },
      webhook_url: { type: "string" },
      webhook_auth_header_name: { type: "string" },
      webhook_auth_header_value: { type: "string" },
      wait: { type: "boolean", default: false },
      fetch_transcript: { type: "boolean", default: false },
      cleanup: { type: "boolean", default: false },
      dry_run: { type: "boolean", default: false },
      poll_interval_ms: { type: "string", default: "1000" }
    },
    args: argv,
    strict: false
  });

  const languageHints = String(values.language_hints ?? "ko,en")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const mode = String(values.mode ?? "meeting") as SessionMode;
  const pollIntervalMs = Number(values.poll_interval_ms ?? "1000");
  const cleanup = Boolean(values.cleanup);

  if (values.transcription_id) {
    const transcriptionId = String(values.transcription_id);
    const status = await getSonioxTranscriptionStatus(transcriptionId);
    const transcript =
      values.fetch_transcript || values.wait
        ? await getSonioxTranscript(transcriptionId, {
            sessionId: String(values.session_id),
            title: String(values.title),
            mode,
            languageHints,
            project: values.project ? String(values.project) : undefined
          })
        : undefined;

    const payload = {
      created: false,
      transcriptionId,
      status: status.status,
      transcript
    };

    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  const created = await createSonioxTranscriptionJob({
    sessionId: String(values.session_id),
    title: String(values.title),
    mode,
    audioUrl: values.audio_url ? String(values.audio_url) : undefined,
    fileId: values.file_id ? String(values.file_id) : undefined,
    languageHints,
    webhookUrl: values.webhook_url ? String(values.webhook_url) : undefined,
    webhookAuthHeaderName: values.webhook_auth_header_name
      ? String(values.webhook_auth_header_name)
      : undefined,
    webhookAuthHeaderValue: values.webhook_auth_header_value
      ? String(values.webhook_auth_header_value)
      : undefined,
    project: values.project ? String(values.project) : undefined,
    wait: Boolean(values.wait),
    fetchTranscript: Boolean(values.fetch_transcript),
    cleanup,
    pollIntervalMs,
    dryRun: Boolean(values.dry_run)
  });

  let transcript: NormalizedSonioxTranscript | undefined;
  if (values.wait || values.fetch_transcript) {
    if (!created.created) {
      transcript = created.transcript;
    } else {
      await waitForSonioxTranscription(created.transcriptionId, pollIntervalMs);
      transcript = await getSonioxTranscript(created.transcriptionId, {
        sessionId: String(values.session_id),
        title: String(values.title),
        mode,
        languageHints,
        project: values.project ? String(values.project) : undefined
      });
    }
  }

  if (cleanup && created.created) {
    await deleteSonioxTranscription(created.transcriptionId);
  }

  const payload = {
    ...created,
    transcript
  };

  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runSonioxCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
