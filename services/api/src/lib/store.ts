import {
  createSessionRecord,
  type ArtifactKind,
  type SessionMode,
  type SessionRecord,
  type SessionStatus
} from "@mystt/audio-core";
import type { SessionNotes } from "@mystt/notes-schema";
import type { SonioxAsyncTranscript, SonioxWebhookEvent } from "@mystt/soniox-client";
import type { NormalizedTranscript } from "@mystt/transcript-normalizer";

import {
  renderCleanTranscriptMarkdown,
  renderSessionNotesDocx,
  renderEmailPreviewHtml,
  renderSessionNotesHtml
} from "./artifacts";
import {
  deletePersistedSessionFiles,
  type AuditEventRecord,
  loadPersistedApiState,
  persistApiState,
  persistNotesArtifacts,
  persistTranscriptArtifacts,
  writeSessionSourceAudio,
  writeSessionSourceAudioFromFile,
  type StoredProviderCheck,
  type StoredTranscription
} from "./persistence";

const sessions = new Map<string, SessionRecord>();
const webhookFingerprints = new Set<string>();
const sessionByTranscriptionId = new Map<string, string>();
const transcriptionBySessionId = new Map<string, StoredTranscription>();
const normalizedTranscripts = new Map<string, NormalizedTranscript>();
const rawTranscriptText = new Map<string, string>();
const notesBySessionId = new Map<
  string,
  {
    model: string;
    notes: SessionNotes;
    createdAt: string;
  }
>();
const providerChecks = new Map<"soniox" | "openai", StoredProviderCheck>();
const auditEvents: AuditEventRecord[] = [];

let initializationPromise: Promise<void> | null = null;
let refreshPromise: Promise<void> | null = null;

export interface SessionSnapshot {
  session: SessionRecord;
  transcription?: StoredTranscription;
  transcriptText?: string;
  normalizedTranscript?: NormalizedTranscript;
  notes?: {
    model: string;
    notes: SessionNotes;
    createdAt: string;
  };
}

function snapshotState() {
  return {
    sessions: [...sessions.values()],
    webhookFingerprints: [...webhookFingerprints.values()],
    sessionByTranscriptionId: Object.fromEntries(sessionByTranscriptionId),
    transcriptionBySessionId: Object.fromEntries(transcriptionBySessionId),
    normalizedTranscripts: Object.fromEntries(normalizedTranscripts),
    rawTranscriptText: Object.fromEntries(rawTranscriptText),
    notesBySessionId: Object.fromEntries(notesBySessionId),
    providerChecks: Object.fromEntries(providerChecks),
    auditEvents: [...auditEvents]
  };
}

function hydrateState(state: Awaited<ReturnType<typeof loadPersistedApiState>>) {
  sessions.clear();
  webhookFingerprints.clear();
  sessionByTranscriptionId.clear();
  transcriptionBySessionId.clear();
  normalizedTranscripts.clear();
  rawTranscriptText.clear();
  notesBySessionId.clear();
  providerChecks.clear();
  auditEvents.splice(0, auditEvents.length);

  for (const session of state.sessions) {
    sessions.set(session.id, session);
  }

  for (const fingerprint of state.webhookFingerprints) {
    webhookFingerprints.add(fingerprint);
  }

  for (const [transcriptionId, sessionId] of Object.entries(state.sessionByTranscriptionId)) {
    sessionByTranscriptionId.set(transcriptionId, sessionId);
  }

  for (const [sessionId, transcription] of Object.entries(state.transcriptionBySessionId)) {
    transcriptionBySessionId.set(sessionId, transcription);
  }

  for (const [sessionId, transcript] of Object.entries(state.normalizedTranscripts)) {
    normalizedTranscripts.set(sessionId, transcript);
  }

  for (const [sessionId, text] of Object.entries(state.rawTranscriptText)) {
    rawTranscriptText.set(sessionId, text);
  }

  for (const [sessionId, notes] of Object.entries(state.notesBySessionId)) {
    notesBySessionId.set(sessionId, notes);
  }

  for (const [provider, check] of Object.entries(state.providerChecks)) {
    if (!check) {
      continue;
    }

    providerChecks.set(provider as "soniox" | "openai", check);
  }

  auditEvents.push(...state.auditEvents);
}

async function persistCurrentState() {
  await persistApiState(snapshotState());
}

function buildSnapshot(session: SessionRecord): SessionSnapshot {
  return {
    session,
    transcription: transcriptionBySessionId.get(session.id),
    transcriptText: rawTranscriptText.get(session.id),
    normalizedTranscript: normalizedTranscripts.get(session.id),
    notes: notesBySessionId.get(session.id)
  };
}

function appendAuditEvent(input: {
  sessionId?: string;
  kind: string;
  payload: Record<string, unknown>;
}) {
  const event: AuditEventRecord = {
    eventId: crypto.randomUUID(),
    sessionId: input.sessionId,
    kind: input.kind,
    payload: input.payload,
    createdAt: new Date().toISOString()
  };
  auditEvents.unshift(event);
  return event;
}

function setSessionStatus(
  sessionId: string,
  status: SessionStatus
): SessionRecord | undefined {
  const session = sessions.get(sessionId);

  if (!session) {
    return undefined;
  }

  const next = { ...session, status };
  sessions.set(sessionId, next);
  return next;
}

function setArtifactRecord(
  sessionId: string,
  kind: ArtifactKind,
  input: { status: "pending" | "ready" | "failed"; location?: string }
) {
  const session = sessions.get(sessionId);

  if (!session) {
    return undefined;
  }

  const artifacts = session.artifacts.map((artifact) =>
    artifact.kind === kind ? { ...artifact, ...input } : artifact
  );

  const next = { ...session, artifacts };
  sessions.set(sessionId, next);
  return next;
}

function setSessionLocalAudioPath(sessionId: string, localAudioPath: string) {
  const session = sessions.get(sessionId);

  if (!session) {
    return undefined;
  }

  const next = {
    ...session,
    localAudioPath
  };
  sessions.set(sessionId, next);
  return next;
}

export async function initializeStore() {
  if (initializationPromise) {
    await initializationPromise;
    return;
  }

  initializationPromise = (async () => {
    await refreshStore();
  })();

  await initializationPromise;
}

export async function refreshStore() {
  if (refreshPromise) {
    await refreshPromise;
    return;
  }

  refreshPromise = (async () => {
    const state = await loadPersistedApiState([]);
    hydrateState(state);
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export function listSessions(): SessionSnapshot[] {
  return [...sessions.values()].map(buildSnapshot);
}

export function getSession(sessionId: string): SessionRecord | undefined {
  return sessions.get(sessionId);
}

export function getSessionSnapshot(sessionId: string): SessionSnapshot | undefined {
  const session = sessions.get(sessionId);
  return session ? buildSnapshot(session) : undefined;
}

export function listAuditEvents(input?: { sessionId?: string; limit?: number }) {
  const filtered = input?.sessionId
    ? auditEvents.filter((event) => event.sessionId === input.sessionId)
    : auditEvents;

  return filtered.slice(0, input?.limit ?? 100);
}

export async function recordAuditEvent(input: {
  sessionId?: string;
  kind: string;
  payload: Record<string, unknown>;
}) {
  const event = appendAuditEvent(input);
  await persistCurrentState();
  return event;
}

export async function createSession(input: {
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
  const session = {
    ...createSessionRecord({
      id: crypto.randomUUID(),
      title: input.title,
      mode: input.mode,
      projectKey: input.projectKey,
      languageHints: input.languageHints,
      localAudioPath: ""
    }),
    status: "recording" as const
  };

  sessions.set(session.id, session);
  appendAuditEvent({
    sessionId: session.id,
    kind: "session.created",
    payload: {
      title: session.title,
      mode: session.mode,
      projectKey: session.projectKey ?? null,
      languageHints: session.languageHints,
      realtimeOptions: input.realtimeOptions ?? null
    }
  });
  await persistCurrentState();
  return session;
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);

  if (!session) {
    return false;
  }

  const transcription = transcriptionBySessionId.get(sessionId);

  await deletePersistedSessionFiles({
    sessionId,
    localAudioPath: session.localAudioPath,
    artifactLocations: session.artifacts.map((artifact) => artifact.location)
  });

  sessions.delete(sessionId);
  normalizedTranscripts.delete(sessionId);
  rawTranscriptText.delete(sessionId);
  notesBySessionId.delete(sessionId);
  transcriptionBySessionId.delete(sessionId);

  if (transcription?.transcriptionId) {
    sessionByTranscriptionId.delete(transcription.transcriptionId);
  }

  for (let index = auditEvents.length - 1; index >= 0; index -= 1) {
    if (auditEvents[index]?.sessionId === sessionId) {
      auditEvents.splice(index, 1);
    }
  }

  appendAuditEvent({
    kind: "session.deleted",
    payload: {
      sessionId,
      title: session.title
    }
  });

  await persistCurrentState();
  return true;
}

export async function updateSessionStatus(
  sessionId: string,
  status: SessionStatus
): Promise<SessionRecord | undefined> {
  const previous = sessions.get(sessionId);
  const next = setSessionStatus(sessionId, status);
  if (next && previous?.status !== status) {
    appendAuditEvent({
      sessionId,
      kind: "session.status.updated",
      payload: {
        from: previous?.status ?? null,
        to: status
      }
    });
  }
  await persistCurrentState();
  return next;
}

export async function markArtifact(
  sessionId: string,
  kind: ArtifactKind,
  input: { status: "pending" | "ready" | "failed"; location?: string }
) {
  const next = setArtifactRecord(sessionId, kind, input);
  await persistCurrentState();
  return next;
}

export async function saveTranscriptionMetadata(
  sessionId: string,
  input: {
    transcriptionId: string;
    status: "queued" | "processing" | "completed" | "error";
    createdAt: string;
    filename?: string;
    audioUrl?: string;
    fileId?: string;
    cleanupTargets?: string[];
    cleanupStatus?: "pending" | "completed" | "failed" | "skipped";
    cleanupRequestedAt?: string;
    cleanupCompletedAt?: string;
    cleanupLastError?: string;
    errorMessage?: string;
  }
) {
  const previous = transcriptionBySessionId.get(sessionId);
  const isReplacement =
    previous?.transcriptionId !== undefined && previous.transcriptionId !== input.transcriptionId;
  const isAuthoritativeReplacement =
    isReplacement && previous !== undefined && input.createdAt > previous.createdAt;

  if (isReplacement && !isAuthoritativeReplacement) {
    return;
  }

  if (isAuthoritativeReplacement && previous?.transcriptionId) {
    sessionByTranscriptionId.delete(previous.transcriptionId);
  }

  const next = isAuthoritativeReplacement
    ? {
        ...input,
        cleanupTargets: input.cleanupTargets ?? [],
        cleanupStatus: input.cleanupStatus ?? "pending",
        cleanupRequestedAt: input.cleanupRequestedAt,
        cleanupCompletedAt:
          input.cleanupStatus === "completed" ? input.cleanupCompletedAt : undefined,
        cleanupLastError: "cleanupLastError" in input ? input.cleanupLastError : undefined
      }
    : {
        ...previous,
        ...input,
        cleanupTargets: input.cleanupTargets ?? previous?.cleanupTargets ?? [],
        cleanupStatus: input.cleanupStatus ?? previous?.cleanupStatus ?? "pending",
        cleanupRequestedAt: input.cleanupRequestedAt ?? previous?.cleanupRequestedAt,
        cleanupCompletedAt:
          input.cleanupStatus === undefined
            ? input.cleanupCompletedAt ?? previous?.cleanupCompletedAt
            : input.cleanupStatus === "completed"
              ? input.cleanupCompletedAt ?? previous?.cleanupCompletedAt
              : undefined,
        cleanupLastError:
          "cleanupLastError" in input
            ? input.cleanupLastError
            : previous?.cleanupLastError
      };

  sessionByTranscriptionId.set(input.transcriptionId, sessionId);
  transcriptionBySessionId.set(sessionId, next);
  appendAuditEvent({
    sessionId,
    kind: "transcription.metadata.updated",
    payload: {
      transcriptionId: next.transcriptionId,
      status: next.status,
      filename: next.filename ?? null,
      audioUrl: next.audioUrl ?? null,
      fileId: next.fileId ?? null,
      cleanupTargets: next.cleanupTargets ?? [],
      cleanupStatus: next.cleanupStatus ?? null
    }
  });

  if (input.cleanupStatus) {
    appendAuditEvent({
      sessionId,
      kind: "transcription.cleanup.updated",
      payload: {
        transcriptionId: next.transcriptionId,
        cleanupStatus: next.cleanupStatus,
        cleanupTargets: next.cleanupTargets ?? [],
        cleanupRequestedAt: next.cleanupRequestedAt ?? null,
        cleanupCompletedAt: next.cleanupCompletedAt ?? null,
        cleanupLastError: next.cleanupLastError ?? null
      }
    });
  }

  await persistCurrentState();
}

export function getSessionIdByTranscriptionId(transcriptionId: string) {
  return sessionByTranscriptionId.get(transcriptionId);
}

export function getStoredTranscription(sessionId: string) {
  return transcriptionBySessionId.get(sessionId);
}

export async function saveTranscriptText(sessionId: string, transcriptText: string) {
  rawTranscriptText.set(sessionId, transcriptText);
  appendAuditEvent({
    sessionId,
    kind: "transcript.text.cached",
    payload: {
      textLength: transcriptText.length
    }
  });
  await persistCurrentState();
}

export async function saveSourceAudio(input: {
  sessionId: string;
  fileName: string;
  content: Uint8Array;
  contentType?: string;
  sourceUrl?: string;
}) {
  const location = await writeSessionSourceAudio({
    sessionId: input.sessionId,
    fileName: input.fileName,
    content: input.content,
    contentType: input.contentType
  });
  setSessionLocalAudioPath(input.sessionId, location);
  appendAuditEvent({
    sessionId: input.sessionId,
    kind: "source_audio.staged",
    payload: {
      location,
      fileName: input.fileName,
      byteLength: input.content.byteLength,
      contentType: input.contentType ?? null,
      sourceUrl: input.sourceUrl ?? null
    }
  });
  await persistCurrentState();
  return location;
}

export async function saveSourceAudioFromFile(input: {
  sessionId: string;
  fileName: string;
  filePath: string;
  byteLength: number;
  sha256: string;
  contentType?: string;
  sourceUrl?: string;
}) {
  const location = await writeSessionSourceAudioFromFile({
    sessionId: input.sessionId,
    fileName: input.fileName,
    filePath: input.filePath,
    contentType: input.contentType
  });
  setSessionLocalAudioPath(input.sessionId, location);
  appendAuditEvent({
    sessionId: input.sessionId,
    kind: "source_audio.staged",
    payload: {
      location,
      fileName: input.fileName,
      byteLength: input.byteLength,
      sha256: input.sha256,
      contentType: input.contentType ?? null,
      sourceUrl: input.sourceUrl ?? null
    }
  });
  await persistCurrentState();
  return location;
}

export async function saveNormalizedTranscript(
  sessionId: string,
  input: {
    rawTranscript: SonioxAsyncTranscript;
    normalizedTranscript: NormalizedTranscript;
  }
) {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  normalizedTranscripts.set(sessionId, input.normalizedTranscript);
  rawTranscriptText.set(sessionId, input.normalizedTranscript.text);
  const artifactPaths = await persistTranscriptArtifacts({
    session,
    rawTranscript: input.rawTranscript,
    normalizedTranscript: input.normalizedTranscript,
    cleanMarkdown: renderCleanTranscriptMarkdown({
      session,
      transcript: input.normalizedTranscript
    })
  });
  setArtifactRecord(sessionId, "clean_transcript_md", {
    status: "ready",
    location: artifactPaths.cleanTranscriptPath
  });
  setArtifactRecord(sessionId, "raw_transcript_json", {
    status: "ready",
    location: artifactPaths.rawTranscriptPath
  });
  appendAuditEvent({
    sessionId,
    kind: "transcript.artifacts.saved",
    payload: {
      rawTranscriptPath: artifactPaths.rawTranscriptPath,
      cleanTranscriptPath: artifactPaths.cleanTranscriptPath,
      textLength: input.normalizedTranscript.text.length,
      segmentCount: input.normalizedTranscript.segments.length
    }
  });
  await persistCurrentState();
}

export async function saveStructuredNotes(
  sessionId: string,
  input: {
    model: string;
    notes: SessionNotes;
  }
) {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  notesBySessionId.set(sessionId, {
    ...input,
    createdAt: new Date().toISOString()
  });
  const notesDocx = await renderSessionNotesDocx({
    session,
    notes: input.notes
  });
  const artifactPaths = await persistNotesArtifacts({
    session,
    notes: input.notes,
    notesHtml: renderSessionNotesHtml({
      session,
      notes: input.notes
    }),
    notesDocx,
    emailPreviewHtml: renderEmailPreviewHtml({
      session,
      notes: input.notes
    })
  });
  setArtifactRecord(sessionId, "meeting_notes_json", {
    status: "ready",
    location: artifactPaths.notesJsonPath
  });
  setArtifactRecord(sessionId, "meeting_notes_html", {
    status: "ready",
    location: artifactPaths.notesHtmlPath
  });
  setArtifactRecord(sessionId, "meeting_notes_docx", {
    status: "ready",
    location: artifactPaths.notesDocxPath
  });
  setArtifactRecord(sessionId, "email_preview_html", {
    status: "ready",
    location: artifactPaths.emailPreviewPath
  });
  appendAuditEvent({
    sessionId,
    kind: "notes.artifacts.saved",
    payload: {
      model: input.model,
      notesJsonPath: artifactPaths.notesJsonPath,
      notesHtmlPath: artifactPaths.notesHtmlPath,
      notesDocxPath: artifactPaths.notesDocxPath,
      emailPreviewPath: artifactPaths.emailPreviewPath
    }
  });
  await persistCurrentState();
}

export async function updateProviderCheck(
  provider: "soniox" | "openai",
  input: {
    configured: boolean;
    ok: boolean | null;
    checkedAt?: string;
    detail?: string;
  }
) {
  providerChecks.set(provider, input);
  await persistCurrentState();
}

export function getProviderChecks() {
  return {
    soniox: providerChecks.get("soniox"),
    openai: providerChecks.get("openai")
  };
}

export async function applySonioxWebhook(event: SonioxWebhookEvent) {
  const fingerprint = `${event.transcriptionId}:${event.status}`;

  if (webhookFingerprints.has(fingerprint)) {
    appendAuditEvent({
      sessionId: event.sessionId,
      kind: "soniox.webhook.duplicate",
      payload: {
        transcriptionId: event.transcriptionId,
        status: event.status,
        deliveredAt: event.deliveredAt
      }
    });
    await persistCurrentState();
    return {
      duplicate: true,
      session: event.sessionId ? sessions.get(event.sessionId) : undefined
    };
  }

  webhookFingerprints.add(fingerprint);

  const resolvedSessionId = event.sessionId ?? getSessionIdByTranscriptionId(event.transcriptionId);

  if (!resolvedSessionId) {
    appendAuditEvent({
      kind: "soniox.webhook.unmatched",
      payload: {
        transcriptionId: event.transcriptionId,
        status: event.status,
        deliveredAt: event.deliveredAt
      }
    });
    await persistCurrentState();
    return { duplicate: false, session: undefined };
  }

  const statusMap: Record<SonioxWebhookEvent["status"], SessionStatus> = {
    queued: "transcribing",
    processing: "transcribing",
    completed: "summarizing",
    error: "failed"
  };

  const session = setSessionStatus(resolvedSessionId, statusMap[event.status]);

  const currentTranscription = transcriptionBySessionId.get(resolvedSessionId);

  if (currentTranscription) {
    transcriptionBySessionId.set(resolvedSessionId, {
      ...currentTranscription,
      status: event.status
    });
  }

  if (event.status === "completed" && session) {
    setArtifactRecord(resolvedSessionId, "raw_transcript_json", {
      status: "pending"
    });
  }

  appendAuditEvent({
    sessionId: resolvedSessionId,
    kind: "soniox.webhook.received",
    payload: {
      transcriptionId: event.transcriptionId,
      status: event.status,
      deliveredAt: event.deliveredAt
    }
  });

  await persistCurrentState();

  return {
    duplicate: false,
    session
  };
}
