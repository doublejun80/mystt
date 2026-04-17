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
  const response = await fetch(`${SONIOX_API_BASE_URL}${path}`, {
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
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Soniox HTTP ${response.status}: ${errorText}`);
  }

  if (init?.expectJson === false) {
    return undefined as T;
  }

  return (await response.json()) as T;
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
  audioUrl?: string;
  fileId?: string;
  languageHints: string[];
  context: string[];
}) {
  const request = {
    model: apiConfig.SONIOX_ASYNC_MODEL,
    language_hints: input.languageHints,
    enable_language_identification: true,
    enable_speaker_diarization: true,
    context: {
      general: [
        { key: "session_id", value: input.sessionId },
        { key: "mode", value: input.mode },
        ...input.context.map((item, index) => ({
          key: `context_${index + 1}`,
          value: item
        }))
      ],
      text: input.context.join("\n")
    },
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

  try {
    await deleteAsyncTranscription(input.transcriptionId);
    deletedTargets.push(...buildCleanupTargets(input));
    return {
      cleanupTargets: buildCleanupTargets(input),
      deletedTargets,
      skippedTargets
    };
  } catch (error) {
    if (!isCleanupNotFoundError(error)) {
      throw error;
    }

    skippedTargets.push(`transcriptions/${input.transcriptionId}`);
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
