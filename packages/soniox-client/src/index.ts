import type { SessionMode } from "@mystt/audio-core";

export interface SonioxTempKeyRequest {
  sessionId: string;
  ttlSeconds: number;
}

export interface SonioxRealtimeStreamConfig {
  languageHints: string[];
  diarization: boolean;
  translationMode: "off" | "one-way" | "two-way";
  context: string[];
  enableEndpointDetection: boolean;
}

export interface SonioxAsyncCreateRequest {
  sessionId: string;
  mode: SessionMode;
  audioUrl?: string;
  fileId?: string;
  languageHints: string[];
  webhookUrl: string;
  context: string[];
}

export interface SonioxToken {
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string;
  language?: string;
  confidence?: number;
}

export interface SonioxSegment {
  id: string;
  speaker?: string;
  language?: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  tokens?: SonioxToken[];
}

export interface SonioxAsyncTranscript {
  transcriptionId: string;
  sessionId: string;
  languageHints: string[];
  segments: SonioxSegment[];
  tokens?: SonioxToken[];
}

export interface SonioxWebhookEvent {
  transcriptionId: string;
  sessionId?: string;
  status: "queued" | "processing" | "completed" | "error";
  deliveredAt: string;
  fileId?: string;
}

export function buildTempKeyRequest(
  sessionId: string,
  ttlSeconds = 900
): SonioxTempKeyRequest {
  return {
    sessionId,
    ttlSeconds
  };
}

export function buildRealtimeStreamConfig(input?: Partial<SonioxRealtimeStreamConfig>) {
  return {
    languageHints: input?.languageHints ?? ["ko", "en"],
    diarization: input?.diarization ?? true,
    translationMode: input?.translationMode ?? "off",
    context: input?.context ?? [],
    enableEndpointDetection: input?.enableEndpointDetection ?? true
  } satisfies SonioxRealtimeStreamConfig;
}

export function buildAsyncTranscriptionRequest(
  input: SonioxAsyncCreateRequest
): Record<string, unknown> {
  return {
    session_id: input.sessionId,
    mode: input.mode,
    audio_url: input.audioUrl,
    file_id: input.fileId,
    language_hints: input.languageHints,
    webhook: {
      url: input.webhookUrl,
      events: ["completed", "failed"]
    },
    diarization: true,
    enable_language_identification: true,
    include_confidence: true,
    context: input.context.join("\n")
  };
}

export function buildCleanupTargets(input: {
  transcriptionId: string;
  fileId?: string;
}): string[] {
  return [
    `transcriptions/${input.transcriptionId}`,
    ...(input.fileId ? [`files/${input.fileId}`] : [])
  ];
}
