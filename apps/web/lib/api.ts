import type { SessionMode, SessionRecord } from "@mystt/audio-core";

const defaultBaseUrl = "http://127.0.0.1:4100";

export interface PersistenceStatus {
  configured: boolean;
  mode: "disabled" | "remote" | "local-fallback";
  lastLoadOk: boolean | null;
  lastWriteOk: boolean | null;
  lastReadOk: boolean | null;
  lastError?: string;
}

export interface QueueStatus {
  configured: boolean;
  mode: "disabled" | "remote" | "inline-fallback";
  depth: number | null;
  lastEnqueueOk: boolean | null;
  lastDepthOk: boolean | null;
  lastError?: string;
}

export interface ApiHealth {
  ok: boolean;
  service: string;
  now: string;
  providers?: {
    sonioxConfigured: boolean;
    openaiConfigured: boolean;
  };
  integrations?: {
    insforgeConfigured?: boolean;
    insforgeAdminConfigured?: boolean;
    insforge?: {
      configured: boolean;
      adminConfigured: boolean;
      shadowWriteEnabled: boolean;
      baseUrl?: string;
      lastPublicConfigOk: boolean | null;
      lastSessionOk: boolean | null;
      lastStorageOk: boolean | null;
      lastShadowWriteOk: boolean | null;
      lastError?: string;
    };
  };
  persistence?: {
    postgres: PersistenceStatus;
    minio: PersistenceStatus;
    paths?: {
      dataRoot: string;
      stateFile: string;
      auditLogFile: string;
      artifactRoot: string;
      audioRoot: string;
    };
  };
  queue?: QueueStatus;
}

export interface TempKeyProbeResponse {
  provider: string;
  sessionId: string;
  ttlSeconds: number;
  issuedAt: string;
  expiresAt: string;
  apiKey: string;
  note: string;
}

export interface RealtimeCaptionChunkResponse {
  sessionId: string;
  chunkId: string;
  text: string;
  model: string;
}

export interface SourceAudioUploadResponse {
  sessionId: string;
  fileId: string;
  location: string;
  fileName: string;
  byteLength: number;
  sha256?: string;
  createdAt: string;
}

export interface NotesPreviewResponse {
  model: string;
  prompt: string;
  responseShape: string;
  transcriptPreview: string;
  notes: SessionNotesRecord;
}

export interface SessionsEnvelope {
  data: SessionRecord[];
  snapshots?: SessionSnapshotRecord[];
}

export interface SessionEnvelope {
  data: SessionRecord;
  snapshot?: SessionSnapshotRecord;
}

export interface MeetingNotesRecord {
  mode: "meeting";
  title: string;
  summary: string;
  decisions: Array<{
    decision: string;
    rationale: string | null;
    evidence: {
      speaker: string | null;
      quote: string;
      timestampRange: string;
    };
  }>;
  actionItems: Array<{
    task: string;
    owner: string | null;
    dueDate: string | null;
    evidence: {
      speaker: string | null;
      quote: string;
      timestampRange: string;
    };
  }>;
  risks: string[];
  openQuestions: string[];
  nextAgenda: string[];
  speakerHighlights: Array<{
    speaker: string;
    summary: string;
  }>;
}

export interface SpeechNotesRecord {
  mode: "speech";
  title: string;
  summary: string;
  keyMessages: string[];
  quotableLines: string[];
  sectionSummaries: Array<{
    section: string;
    summary: string;
  }>;
  audienceQna: Array<{
    question: string;
    answer: string;
  }>;
}

export interface InterviewNotesRecord {
  mode: "interview";
  title: string;
  summary: string;
  keyInsights: string[];
  questionAnswerPairs: Array<{
    question: string;
    answer: string;
  }>;
  followUpQuestions: string[];
  sensitiveStatements: string[];
}

export type SessionNotesRecord =
  | MeetingNotesRecord
  | SpeechNotesRecord
  | InterviewNotesRecord;

export interface SessionSnapshotRecord {
  session: SessionRecord;
  transcriptText?: string;
  normalizedTranscript?: {
    text: string;
  };
  notes?: {
    model: string;
    notes: SessionNotesRecord;
    createdAt: string;
  };
}

export interface AuditEventRecord {
  eventId: string;
  sessionId?: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function getWebApiBaseUrl() {
  const configured = (process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultBaseUrl).replace(
    /\/$/,
    ""
  );

  if (typeof window === "undefined") {
    return configured;
  }
  return "";
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  const hasBody = init?.body !== undefined && init?.body !== null;

  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${getWebApiBaseUrl()}${path}`, {
    cache: "no-store",
    ...init,
    headers
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;

    try {
      const payload = (await response.json()) as { message?: string; error?: string };
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      try {
        const text = await response.text();
        if (text.trim()) {
          detail = text.trim();
        }
      } catch {
        // Keep the default detail when the error body cannot be read.
      }
    }

    throw new Error(`Request failed: ${detail}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function fetchApiHealth(): Promise<ApiHealth> {
  return requestJson<ApiHealth>("/health");
}

export async function fetchPortalSessions(): Promise<SessionSnapshotRecord[]> {
  const payload = await requestJson<SessionsEnvelope>("/v1/sessions");
  return payload.snapshots ?? payload.data.map((session) => ({ session }));
}

export async function fetchSessionById(sessionId: string): Promise<SessionRecord> {
  const payload = await requestJson<SessionEnvelope>(`/v1/sessions/${sessionId}`);
  return payload.data;
}

export async function fetchSessionSnapshotById(
  sessionId: string
): Promise<SessionSnapshotRecord> {
  const payload = await requestJson<SessionEnvelope>(`/v1/sessions/${sessionId}`);

  return payload.snapshot ?? {
    session: payload.data
  };
}

export async function createPortalSession(input: {
  title: string;
  mode: SessionMode;
  projectKey?: string;
  languageHints?: string[];
  realtimeOptions?: {
    enableMixedLanguage: boolean;
    enableSpeakerDiarization: boolean;
    highlightLowConfidence: boolean;
    enableLiveTranslation: boolean;
    endpointDelayMs?: number;
    contextTerms?: string[];
    inputDeviceLabel?: string | null;
  };
}): Promise<SessionRecord> {
  const payload = await requestJson<SessionEnvelope>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return payload.data;
}

export async function fetchSessionAuditEvents(
  sessionId: string,
  limit = 20
): Promise<AuditEventRecord[]> {
  const payload = await requestJson<{ data: AuditEventRecord[] }>(
    `/v1/sessions/${sessionId}/audit-events?limit=${limit}`
  );

  return payload.data;
}

export function getSessionSourceAudioHref(sessionId: string) {
  return `${getWebApiBaseUrl()}/v1/sessions/${sessionId}/source-audio`;
}

export function getSessionSourceAudioPreviewHref(sessionId: string) {
  return `${getSessionSourceAudioHref(sessionId)}?inline=1`;
}

export async function uploadPortalSourceAudio(input: {
  sessionId: string;
  file: Blob;
  fileName: string;
}): Promise<SourceAudioUploadResponse> {
  const form = new FormData();
  form.append("sessionId", input.sessionId);
  form.append("file", input.file, input.fileName);

  const response = await fetch(`${getWebApiBaseUrl()}/v1/uploads/source-audio`, {
    method: "POST",
    body: form,
    cache: "no-store"
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;

    try {
      const payload = (await response.json()) as { message?: string; error?: string };
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      try {
        const text = await response.text();
        if (text.trim()) {
          detail = text.trim();
        }
      } catch {
        // Keep the default detail when the error body cannot be read.
      }
    }

    throw new Error(`Request failed: ${detail}`);
  }

  const payload = (await response.json()) as { data: SourceAudioUploadResponse };
  return payload.data;
}

export async function processPortalSession(input: {
  sessionId: string;
  fileId: string;
  wait?: boolean;
}): Promise<SessionSnapshotRecord> {
  const payload = await requestJson<{ data: SessionSnapshotRecord }>(
    `/v1/sessions/${input.sessionId}/process`,
    {
      method: "POST",
      body: JSON.stringify({
        fileId: input.fileId,
        wait: input.wait ?? true
      })
    }
  );

  return payload.data;
}

export function getSessionArtifactHref(sessionId: string, kind: string) {
  return `${getWebApiBaseUrl()}/v1/sessions/${sessionId}/artifacts/${kind}`;
}

export async function deletePortalSession(sessionId: string): Promise<void> {
  await requestJson(`/v1/sessions/${sessionId}`, {
    method: "DELETE",
    headers: {}
  });
}

export async function sendSessionShareEmail(input: {
  sessionId: string;
  to: string[];
  portalBaseUrl: string;
  idempotencyKey: string;
  includeSummary: boolean;
  includeDetails: boolean;
  includeAudio: boolean;
}): Promise<{
  sent: boolean;
  duplicate: boolean;
  messageId?: string;
  accepted?: string[];
  attachmentSummary?: {
    transcriptAttached: boolean;
    notesAttached: boolean;
    audioAttached: boolean;
  };
}> {
  const payload = await requestJson<{
    data: {
      sent: boolean;
      duplicate: boolean;
      messageId?: string;
      accepted?: string[];
      attachmentSummary?: {
        transcriptAttached: boolean;
        notesAttached: boolean;
        audioAttached: boolean;
      };
    };
  }>(`/v1/sessions/${input.sessionId}/share/email`, {
    method: "POST",
    body: JSON.stringify({
      to: input.to,
      portalBaseUrl: input.portalBaseUrl,
      idempotencyKey: input.idempotencyKey,
      includeSummary: input.includeSummary,
      includeDetails: input.includeDetails,
      includeAudio: input.includeAudio
    })
  });

  return payload.data;
}

export async function probeSonioxTempKey(sessionId: string): Promise<TempKeyProbeResponse> {
  const payload = await requestJson<{ data: TempKeyProbeResponse }>("/v1/soniox/temp-key", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      ttlSeconds: 900
    })
  });

  return payload.data;
}

export async function generateSessionNotes(input: {
  sessionId: string;
  mode: SessionMode;
  transcript: string;
}): Promise<SessionSnapshotRecord> {
  const payload = await requestJson<{ data: SessionSnapshotRecord }>("/v1/notes/generate", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return payload.data;
}

export async function previewSessionNotes(input: {
  mode: SessionMode;
  transcript: string;
  title?: string;
}): Promise<NotesPreviewResponse> {
  const payload = await requestJson<{ data: NotesPreviewResponse }>("/v1/notes/preview", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return payload.data;
}

export async function transcribeRealtimeCaptionChunk(input: {
  sessionId: string;
  chunkId: string;
  mimeType: string;
  audioBase64: string;
  language?: string;
  prompt?: string;
}): Promise<RealtimeCaptionChunkResponse> {
  const payload = await requestJson<{ data: RealtimeCaptionChunkResponse }>(
    "/v1/realtime/caption-chunk",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );

  return payload.data;
}
