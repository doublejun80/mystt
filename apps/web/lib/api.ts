import type { SessionMode, SessionRecord } from "@mystt/audio-core";

const defaultBaseUrl = "http://127.0.0.1:4100";
const forwardedAuthCookieNames = ["mystt_owner_session", "mystt_qa_token"];
export const finalProcessingTimeoutMs = 10 * 60 * 1000;

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

export interface EvidenceRefRecord {
  segmentId: string;
  startMs: number;
  endMs: number;
  speaker: string | null;
  quote: string;
}

export interface LegacyMeetingNotesRecord {
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

export interface MeetingNotesV2Record {
  schemaVersion: "meeting_notes_v2";
  mode: "meeting";
  title: string;
  summary: string;
  templateType:
    | "general_meeting"
    | "purchase_review"
    | "sales_meeting"
    | "user_interview"
    | "support_call";
  oneLineConclusion: string;
  executiveSummary: string[];
  detailedSummary: string;
  reportSummary?: {
    title: string;
    introduction: string;
    keyPoints: string[];
    conclusion: string;
  } | null;
  keywords: string[];
  topicTimeline?: Array<{
    timelineId: string;
    startMs: number;
    endMs: number;
    title: string;
    discussion: string;
    outcome: string | null;
    relatedSpeakers: string[];
    evidenceRefs: EvidenceRefRecord[];
  }> | null;
  topicSummaries: Array<{
    topicId: string;
    title: string;
    startMs: number;
    endMs: number;
    summaryBullets: string[];
    relatedSpeakers: string[];
    importance: "high" | "medium" | "low";
    evidenceRefs: EvidenceRefRecord[];
  }>;
  decisions: Array<{
    decision: string;
    rationale: string | null;
    status: "confirmed" | "inferred" | "unclear";
    decidedBy: string | null;
    evidence: {
      speaker: string | null;
      quote: string;
      timestampRange: string;
    };
    evidenceRefs: EvidenceRefRecord[];
  }>;
  actionItems: Array<{
    task: string;
    owner: string | null;
    dueDate: string | null;
    ownerStatus: "explicit" | "inferred" | "needs_confirmation";
    dueStatus: "explicit" | "inferred" | "needs_confirmation";
    priority: "high" | "medium" | "low";
    status: "todo" | "in_progress" | "done" | "needs_confirmation";
    evidence: {
      speaker: string | null;
      quote: string;
      timestampRange: string;
    };
    evidenceRefs: EvidenceRefRecord[];
  }>;
  openIssues: Array<{
    content: string;
    issueType: string;
    severity: "high" | "medium" | "low";
    suggestedNextAction: string;
    evidenceRefs: EvidenceRefRecord[];
  }>;
  risks: Array<{
    content: string;
    riskType: string;
    severity: "high" | "medium" | "low";
    mitigation: string;
    evidenceRefs: EvidenceRefRecord[];
  }>;
  reviewFlags: Array<{
    flagType: string;
    message: string;
    severity: "high" | "medium" | "low";
    relatedSegmentIds: string[];
  }>;
  reportMarkdown: string;
}

export type MeetingNotesRecord = LegacyMeetingNotesRecord | MeetingNotesV2Record;

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
    segments?: Array<{
      id: string;
      speaker: string;
      language?: string;
      startMs: number;
      endMs: number;
      text: string;
      confidence?: number;
    }>;
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

async function getServerAuthCookieHeader() {
  if (typeof window !== "undefined") {
    return undefined;
  }

  try {
    const { cookies } = await import("next/headers");
    const cookieStore = cookies();
    const values = forwardedAuthCookieNames
      .map((name) => {
        const value = cookieStore.get(name)?.value;
        return value ? `${name}=${encodeURIComponent(value)}` : null;
      })
      .filter(Boolean);

    return values.length > 0 ? values.join("; ") : undefined;
  } catch {
    return undefined;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  const hasBody = init?.body !== undefined && init?.body !== null;
  const serverAuthCookie = await getServerAuthCookieHeader();

  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (serverAuthCookie && !headers.has("cookie")) {
    headers.set("cookie", serverAuthCookie);
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

export async function fetchRawTranscriptArtifact(sessionId: string): Promise<unknown> {
  return requestJson<unknown>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/artifacts/raw_transcript_json`
  );
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

export function getSessionSourceAudioHref(
  sessionId: string,
  options?: { format?: "original" | "mp3" }
) {
  const path = `${getWebApiBaseUrl()}/v1/sessions/${sessionId}/source-audio`;

  if (!options?.format || options.format === "original") {
    return path;
  }

  return `${path}?format=${encodeURIComponent(options.format)}`;
}

export function getSessionSourceAudioPreviewHref(sessionId: string) {
  return `${getSessionSourceAudioHref(sessionId)}?inline=1`;
}

export async function uploadPortalSourceAudio(input: {
  sessionId: string;
  file: Blob;
  fileName: string;
}): Promise<SourceAudioUploadResponse> {
  if (shouldPreferJsonAudioUpload()) {
    const jsonUploadError = getBase64AudioUploadGuardError(input.file);

    if (jsonUploadError) {
      return uploadPortalSourceAudioBinaryFallback(input, jsonUploadError);
    }

    try {
      return await uploadPortalSourceAudioBase64(input);
    } catch (error) {
      return uploadPortalSourceAudioBinaryFallback(input, error);
    }
  }

  return uploadPortalSourceAudioBinaryFallback(input);
}

async function uploadPortalSourceAudioBinaryFallback(
  input: {
    sessionId: string;
    file: Blob;
    fileName: string;
  },
  jsonError?: unknown
): Promise<SourceAudioUploadResponse> {
  try {
    return await uploadPortalSourceAudioRaw(input);
  } catch (error) {
    try {
      return await uploadPortalSourceAudioMultipart(input);
    } catch (fallbackError) {
      if (!jsonError) {
        try {
          return await uploadPortalSourceAudioBase64(input);
        } catch (base64Error) {
          const rawMessage =
            error instanceof Error ? error.message : "raw upload failed";
          const multipartMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : "multipart upload failed";
          const base64Message =
            base64Error instanceof Error ? base64Error.message : "base64 upload failed";

          throw new Error(
            `원본 음성 업로드에 실패했습니다. raw: ${rawMessage}; multipart: ${multipartMessage}; base64: ${base64Message}`
          );
        }
      }

      const jsonMessage =
        jsonError instanceof Error ? jsonError.message : "base64 upload failed";
      const primaryMessage =
        error instanceof Error ? error.message : "raw upload failed";
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : "multipart upload failed";

      throw new Error(
        `원본 음성 업로드에 실패했습니다. base64: ${jsonMessage}; raw: ${primaryMessage}; multipart: ${fallbackMessage}`
      );
    }
  }
}

function shouldPreferJsonAudioUpload() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent;
  const platform = navigator.platform;

  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function getBinaryUploadTimeoutMs(fileSize: number) {
  const minimumTimeoutMs = 20_000;
  const longRecordingByteThreshold = 64 * 1024 * 1024;
  const longRecordingMinimumTimeoutMs = 30 * 60 * 1000;
  const maxLongRecordingUploadTimeoutMs = 45 * 60 * 1000;
  const expectedUploadMs = Math.ceil(fileSize / 64_000) * 1_000;
  const uploadTimeoutMs =
    fileSize >= longRecordingByteThreshold
      ? Math.max(longRecordingMinimumTimeoutMs, expectedUploadMs)
      : Math.max(minimumTimeoutMs, expectedUploadMs);

  return Math.min(uploadTimeoutMs, maxLongRecordingUploadTimeoutMs);
}

function getJsonUploadTimeoutMs(fileSize: number) {
  return Math.min(Math.max(45_000, Math.ceil(fileSize / 64_000) * 1_000), 180_000);
}

const maxBase64SourceAudioBytes = 64 * 1024 * 1024;

function getBase64AudioUploadGuardError(file: Blob) {
  if (Number.isFinite(file.size) && file.size > maxBase64SourceAudioBytes) {
    return new Error(
      `base64 source audio upload skipped for ${file.size} bytes; max=${maxBase64SourceAudioBytes}`
    );
  }

  return null;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

async function readRequestFailure(response: Response) {
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

  return detail;
}

async function parseSourceAudioUploadResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed: ${await readRequestFailure(response)}`);
  }

  const payload = (await response.json()) as { data: SourceAudioUploadResponse };
  return payload.data;
}

async function uploadPortalSourceAudioMultipart(input: {
  sessionId: string;
  file: Blob;
  fileName: string;
}): Promise<SourceAudioUploadResponse> {
  const form = new FormData();
  form.append("sessionId", input.sessionId);
  form.append("file", input.file, input.fileName);

  const response = await fetchWithTimeout(
    `${getWebApiBaseUrl()}/v1/uploads/source-audio`,
    {
      method: "POST",
      body: form,
      cache: "no-store"
    },
    getBinaryUploadTimeoutMs(input.file.size)
  );

  return parseSourceAudioUploadResponse(response);
}

async function uploadPortalSourceAudioRaw(input: {
  sessionId: string;
  file: Blob;
  fileName: string;
}): Promise<SourceAudioUploadResponse> {
  const search = new URLSearchParams({
    sessionId: input.sessionId,
    fileName: input.fileName
  });
  const response = await fetchWithTimeout(
    `${getWebApiBaseUrl()}/v1/uploads/source-audio/raw?${search.toString()}`,
    {
      method: "POST",
      body: input.file,
      headers: {
        "content-type": input.file.type || "application/octet-stream"
      },
      cache: "no-store"
    },
    getBinaryUploadTimeoutMs(input.file.size)
  );

  return parseSourceAudioUploadResponse(response);
}

async function uploadPortalSourceAudioBase64(input: {
  sessionId: string;
  file: Blob;
  fileName: string;
}): Promise<SourceAudioUploadResponse> {
  const guardError = getBase64AudioUploadGuardError(input.file);

  if (guardError) {
    throw guardError;
  }

  const audioBase64 = arrayBufferToBase64(await input.file.arrayBuffer());
  const response = await fetchWithTimeout(
    `${getWebApiBaseUrl()}/v1/uploads/source-audio/base64`,
    {
      method: "POST",
      body: JSON.stringify({
        sessionId: input.sessionId,
        fileName: input.fileName,
        contentType: input.file.type || "application/octet-stream",
        audioBase64
      }),
      headers: {
        "content-type": "application/json"
      },
      cache: "no-store"
    },
    getJsonUploadTimeoutMs(input.file.size)
  );

  return parseSourceAudioUploadResponse(response);
}

export async function processPortalSession(input: {
  sessionId: string;
  fileId: string;
  wait?: boolean;
  timeoutMs?: number;
}): Promise<SessionSnapshotRecord> {
  const payload = await requestJson<{ data: SessionSnapshotRecord }>(
    `/v1/sessions/${input.sessionId}/process`,
    {
      method: "POST",
      body: JSON.stringify({
        fileId: input.fileId,
        wait: input.wait ?? true,
        timeoutMs: input.timeoutMs ?? finalProcessingTimeoutMs
      })
    }
  );

  return payload.data;
}

export function getSessionArtifactHref(sessionId: string, kind: string) {
  return `${getWebApiBaseUrl()}/v1/sessions/${sessionId}/artifacts/${kind}`;
}

export async function deletePortalSession(sessionId: string): Promise<void> {
  const headers = new Headers();
  const serverAuthCookie = await getServerAuthCookieHeader();
  if (serverAuthCookie) {
    headers.set("cookie", serverAuthCookie);
  }

  const response = await fetch(`${getWebApiBaseUrl()}/v1/sessions/${sessionId}`, {
    cache: "no-store",
    method: "DELETE",
    headers
  });

  if (response.status === 204 || response.status === 404) {
    return;
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
}

export async function updatePortalSessionTitle(input: {
  sessionId: string;
  title: string;
}): Promise<SessionSnapshotRecord> {
  const payload = await requestJson<SessionEnvelope>(
    `/v1/sessions/${input.sessionId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        title: input.title
      })
    }
  );

  return payload.snapshot ?? {
    session: payload.data
  };
}

export async function failPortalSession(input: {
  sessionId: string;
  reason: string;
  phase?: string;
}): Promise<SessionRecord> {
  const payload = await requestJson<SessionEnvelope>(
    `/v1/sessions/${input.sessionId}/fail`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: input.reason,
        phase: input.phase
      })
    }
  );

  return payload.data;
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
