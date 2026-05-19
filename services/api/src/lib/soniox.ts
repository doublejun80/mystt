import type { WebhookEvent } from "@soniox/node";
import { createReadStream } from "node:fs";

import type { SessionMode } from "@mystt/audio-core";
import {
  buildCleanupTargets,
  type SonioxAsyncTranscript,
  type SonioxWebhookEvent
} from "@mystt/soniox-client";

import { apiConfig } from "../config";
import { getSonioxClient } from "./providers";

const SONIOX_API_BASE_URL = "https://api.soniox.com";
const SONIOX_CONTEXT_LIMIT = 10_000;
const SONIOX_REST_TIMEOUT_MS = 30_000;
const SONIOX_REST_MAX_ATTEMPTS = 3;
const SONIOX_REST_RETRY_BASE_DELAY_MS = 250;
const SONIOX_REST_RETRY_MAX_DELAY_MS = 2_000;

const meetingTemplateTypeCandidates = [
  "general_meeting",
  "purchase_review",
  "sales_meeting",
  "user_interview",
  "support_call"
] as const;

type SonioxContextGeneralEntry = {
  key: string;
  value: string;
};

export interface SonioxContextInput {
  sessionId: string;
  mode: SessionMode;
  title?: string;
  project?: string;
  templateTypeCandidates?: string[];
  expectedLanguages?: string[];
  expectedSpeakerCount?: number;
  knownTerms?: string[];
  participantNames?: string[];
  meetingPurpose?: string;
  additionalContext?: string[];
}

interface RestTranscriptToken {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker?: string | null;
  language?: string | null;
  confidence: number;
}

interface RestTranscriptResponse {
  id: string;
  text: string;
  tokens: RestTranscriptToken[];
}

interface RestTranscriptionResponse {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  created_at: string;
  filename: string;
  audio_url?: string | null;
  file_id?: string | null;
  client_reference_id?: string | null;
  error_message?: string | null;
}

class SonioxHttpError extends Error {
  constructor(
    readonly status: number,
    body: string
  ) {
    super(`Soniox HTTP ${status}: ${body}`);
  }
}

class SonioxTimeoutError extends Error {
  constructor() {
    super(`Soniox REST request timed out after ${SONIOX_REST_TIMEOUT_MS}ms`);
    this.name = "SonioxTimeoutError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /abort/i.test(error.message))
  );
}

function isRetryableSonioxError(error: unknown): boolean {
  if (error instanceof SonioxTimeoutError) {
    return false;
  }

  if (error instanceof SonioxHttpError) {
    return error.status === 429 || error.status >= 500;
  }

  if (isAbortError(error)) {
    return false;
  }

  return error instanceof Error;
}

function retryDelayMs(attemptIndex: number): number {
  const baseDelay = SONIOX_REST_RETRY_BASE_DELAY_MS * 2 ** attemptIndex;
  const jitter = Math.floor(Math.random() * SONIOX_REST_RETRY_BASE_DELAY_MS);
  return Math.min(baseDelay + jitter, SONIOX_REST_RETRY_MAX_DELAY_MS);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SONIOX_REST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (timedOut || isAbortError(error)) {
      throw new SonioxTimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function truncateSonioxContextText(value: string, limit = SONIOX_CONTEXT_LIMIT): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function compactList(values?: string[]): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
}

function contextEntry(
  key: string,
  value: string | number | undefined
): SonioxContextGeneralEntry | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return {
    key,
    value: truncateSonioxContextText(normalized, 1_000)
  };
}

function defaultTemplateTypeCandidates(mode: SessionMode): string[] {
  if (mode === "interview") {
    return ["user_interview", "general_meeting"];
  }

  if (mode === "speech") {
    return ["general_meeting"];
  }

  return [...meetingTemplateTypeCandidates];
}

export function buildSonioxContext(input: SonioxContextInput): {
  general: SonioxContextGeneralEntry[];
  text: string;
} {
  const templateTypeCandidates = compactList(
    input.templateTypeCandidates ?? defaultTemplateTypeCandidates(input.mode)
  );
  const expectedLanguages = compactList(input.expectedLanguages);
  const knownTerms = compactList(input.knownTerms);
  const participantNames = compactList(input.participantNames);
  const additionalContext = compactList(input.additionalContext);
  const project = input.project?.trim() || "general";
  const title = input.title?.trim() || "Untitled session";

  const general = [
    contextEntry("session_id", input.sessionId),
    contextEntry("mode", input.mode),
    contextEntry("title", title),
    contextEntry("project", project),
    contextEntry("template_type_candidates", templateTypeCandidates.join(", ")),
    contextEntry("expected_languages", expectedLanguages.join(", ")),
    contextEntry("expected_speaker_count", input.expectedSpeakerCount),
    contextEntry("known_terms", knownTerms.join(", ")),
    contextEntry("participant_names", participantNames.join(", ")),
    ...additionalContext.map((item, index) => contextEntry(`context_${index + 1}`, item))
  ].filter((entry): entry is SonioxContextGeneralEntry => Boolean(entry));

  const text = truncateSonioxContextText(
    [
      `회의 제목: ${title}`,
      `프로젝트: ${project}`,
      `세션 모드: ${input.mode}`,
      templateTypeCandidates.length > 0
        ? `회의록 템플릿 후보: ${templateTypeCandidates.join(", ")}`
        : null,
      expectedLanguages.length > 0 ? `예상 언어: ${expectedLanguages.join(", ")}` : null,
      input.expectedSpeakerCount !== undefined
        ? `예상 화자 수: ${input.expectedSpeakerCount}`
        : null,
      participantNames.length > 0 ? `참석자 후보: ${participantNames.join(", ")}` : null,
      knownTerms.length > 0 ? `도메인 용어: ${knownTerms.join(", ")}` : null,
      input.meetingPurpose?.trim() ? `회의 목적: ${input.meetingPurpose.trim()}` : null,
      additionalContext.length > 0 ? `추가 맥락: ${additionalContext.join(" / ")}` : null,
      "Soniox는 최종 OpenAI 회의록 작성에 사용할 원장 역할을 하므로 화자, 시간, 언어, 낮은 신뢰도 구간을 가능한 한 보존합니다."
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  );

  return {
    general,
    text
  };
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  ) {
    return true;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
    const octets = normalized.split(".").map((value) => Number(value));
    const [first = 0, second = 0] = octets;

    if (first === 127 || first === 10) {
      return true;
    }

    if (first === 192 && second === 168) {
      return true;
    }

    if (first === 172 && second >= 16 && second <= 31) {
      return true;
    }
  }

  return false;
}

export function resolveSonioxWebhookUrl(config = apiConfig): string | undefined {
  const explicitUrl = config.SONIOX_WEBHOOK_URL?.trim();

  if (explicitUrl) {
    const parsed = new URL(explicitUrl);

    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error("SONIOX_WEBHOOK_URL must start with http:// or https://");
    }

    return parsed.toString();
  }

  const apiDomain = config.API_DOMAIN?.trim();

  if (!apiDomain) {
    return undefined;
  }

  const parsed = new URL(`https://${apiDomain}`);

  if (isLocalHostname(parsed.hostname)) {
    return undefined;
  }

  parsed.pathname = "/v1/webhooks/soniox";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function resolveSonioxWebhookConfig(): {
  webhook_url?: string;
  webhook_auth_header_name?: string;
  webhook_auth_header_value?: string;
} {
  const webhookUrl = resolveSonioxWebhookUrl(apiConfig);
  const webhookSecret = apiConfig.SONIOX_WEBHOOK_SECRET?.trim() || undefined;

  if (!webhookUrl) {
    return {};
  }

  return {
    webhook_url: webhookUrl,
    webhook_auth_header_name: webhookSecret ? "x-soniox-webhook-secret" : undefined,
    webhook_auth_header_value: webhookSecret
  };
}

async function sonioxRestFetch<T>(
  path: string,
  init?: RequestInit & { json?: unknown; expectJson?: boolean }
): Promise<T> {
  const url = `${SONIOX_API_BASE_URL}${path}`;
  const requestInit: RequestInit = {
    ...init,
    headers: {
      Authorization: `Bearer ${apiConfig.SONIOX_API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    body:
      init && "json" in init && init.json !== undefined
        ? JSON.stringify(init.json)
        : init?.body
  };

  let lastError: unknown;

  for (let attempt = 0; attempt < SONIOX_REST_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;

    try {
      response = await fetchWithTimeout(url, requestInit);
    } catch (error) {
      lastError = error;

      if (
        attempt < SONIOX_REST_MAX_ATTEMPTS - 1 &&
        isRetryableSonioxError(error)
      ) {
        await sleep(retryDelayMs(attempt));
        continue;
      }

      throw error;
    }

    if (!response.ok) {
      const error = new SonioxHttpError(response.status, await response.text());
      lastError = error;

      if (
        attempt < SONIOX_REST_MAX_ATTEMPTS - 1 &&
        isRetryableSonioxError(error)
      ) {
        await sleep(retryDelayMs(attempt));
        continue;
      }

      throw error;
    }

    if (init?.expectJson === false) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function createRealtimeTemporaryKey(input: {
  sessionId: string;
  ttlSeconds: number;
}) {
  const client = getSonioxClient();

  return client.auth.createTemporaryKey({
    usage_type: "transcribe_websocket",
    expires_in_seconds: input.ttlSeconds,
    client_reference_id: input.sessionId
  });
}

export async function uploadSourceAudioFile(input: {
  sessionId: string;
  fileName: string;
  filePath: string;
}) {
  const client = getSonioxClient();
  const file = await client.files.upload(createReadStream(input.filePath), {
    filename: input.fileName,
    client_reference_id: input.sessionId
  });

  return {
    fileId: file.id,
    fileName: file.filename,
    byteLength: file.size,
    createdAt: file.created_at
  };
}

export async function createAsyncTranscriptionJob(input: {
  sessionId: string;
  mode: SessionMode;
  title?: string;
  project?: string;
  audioUrl?: string;
  fileId?: string;
  languageHints: string[];
  context?: string[];
  templateTypeCandidates?: string[];
  expectedSpeakerCount?: number;
  knownTerms?: string[];
  participantNames?: string[];
  meetingPurpose?: string;
}) {
  const context = buildSonioxContext({
    sessionId: input.sessionId,
    mode: input.mode,
    title: input.title,
    project: input.project,
    templateTypeCandidates: input.templateTypeCandidates,
    expectedLanguages: input.languageHints,
    expectedSpeakerCount: input.expectedSpeakerCount,
    knownTerms: input.knownTerms,
    participantNames: input.participantNames,
    meetingPurpose: input.meetingPurpose,
    additionalContext: input.context
  });
  const request = {
    model: apiConfig.SONIOX_ASYNC_MODEL,
    language_hints: input.languageHints,
    enable_language_identification: true,
    enable_speaker_diarization: true,
    context,
    client_reference_id: input.sessionId,
    ...resolveSonioxWebhookConfig(),
    audio_url: input.audioUrl,
    file_id: input.fileId
  };

  if (!request.audio_url && !request.file_id) {
    throw new Error("audioUrl or fileId is required to create a Soniox transcription.");
  }

  return sonioxRestFetch<RestTranscriptionResponse>("/v1/transcriptions", {
    method: "POST",
    json: request
  });
}

export async function getAsyncTranscription(transcriptionId: string) {
  return sonioxRestFetch<RestTranscriptionResponse>(
    `/v1/transcriptions/${transcriptionId}`
  );
}

export async function getAsyncTranscript(transcriptionId: string) {
  return sonioxRestFetch<RestTranscriptResponse>(
    `/v1/transcriptions/${transcriptionId}/transcript`
  );
}

export async function deleteAsyncTranscription(transcriptionId: string) {
  return sonioxRestFetch<void>(`/v1/transcriptions/${transcriptionId}`, {
    method: "DELETE",
    expectJson: false
  });
}

export async function deleteUploadedFile(fileId: string) {
  return sonioxRestFetch<void>(`/v1/files/${fileId}`, {
    method: "DELETE",
    expectJson: false
  });
}

function isCleanupNotFoundError(error: unknown) {
  return error instanceof Error && /404|not[_ ]found/i.test(error.message);
}

export async function cleanupAsyncTranscriptionResources(input: {
  transcriptionId: string;
  fileId?: string;
}) {
  const deletedTargets: string[] = [];
  const skippedTargets: string[] = [];
  const failures: string[] = [];

  try {
    await deleteAsyncTranscription(input.transcriptionId);
    deletedTargets.push(`transcriptions/${input.transcriptionId}`);
  } catch (error) {
    if (isCleanupNotFoundError(error)) {
      skippedTargets.push(`transcriptions/${input.transcriptionId}`);
    } else {
      failures.push(
        `transcriptions/${input.transcriptionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (input.fileId) {
    try {
      await deleteUploadedFile(input.fileId);
      deletedTargets.push(`files/${input.fileId}`);
    } catch (error) {
      if (!isCleanupNotFoundError(error)) {
        throw error;
      }

      skippedTargets.push(`files/${input.fileId}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Soniox cleanup failed: ${failures.join("; ")}`);
  }

  return {
    cleanupTargets: buildCleanupTargets(input),
    deletedTargets,
    skippedTargets
  };
}

export function convertTranscriptToPackageShape(
  sessionId: string,
  transcript: RestTranscriptResponse
): SonioxAsyncTranscript {
  return {
    transcriptionId: transcript.id,
    sessionId,
    languageHints: [],
    segments: [],
    tokens: transcript.tokens.map((token) => ({
      text: token.text,
      startMs: token.start_ms,
      endMs: token.end_ms,
      speaker: token.speaker ?? undefined,
      language: token.language ?? undefined,
      confidence: token.confidence
    }))
  };
}

export function toWebhookEventPayload(event: WebhookEvent): SonioxWebhookEvent {
  return {
    transcriptionId: event.id,
    status: event.status,
    deliveredAt: new Date().toISOString()
  };
}

export function transcriptionSummary(transcription: RestTranscriptionResponse) {
  return {
    transcriptionId: transcription.id,
    status: transcription.status,
    createdAt: transcription.created_at,
    filename: transcription.filename,
    audioUrl: transcription.audio_url ?? undefined,
    fileId: transcription.file_id ?? undefined,
    clientReferenceId: transcription.client_reference_id ?? undefined,
    errorMessage: transcription.error_message ?? undefined
  };
}
