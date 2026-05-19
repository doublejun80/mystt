import type { SessionRecord, SessionStatus } from "@mystt/audio-core";

import type { AuditEventRecord } from "./persistence";
import type { SessionSnapshot } from "./store";

const blockedAuditPayloadKeys = new Set([
  "location",
  "artifactLocations",
  "localAudioPath",
  "fileId",
  "transcriptionId",
  "jobId"
]);
const staleClientRecordingMs = 5 * 60 * 1000;
const stalePipelineProcessingMs = 45 * 60 * 1000;
const completionArtifactKinds = new Set([
  "meeting_notes_json",
  "meeting_notes_html",
  "meeting_notes_docx",
  "email_preview_html"
]);
const pipelineProcessingStatuses = new Set<SessionStatus>([
  "transcribing",
  "summarizing",
  "emailing"
]);

function readFileLabel(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1)?.trim() ?? "";
}

function isBlockedAuditPayloadKey(key: string) {
  return blockedAuditPayloadKeys.has(key) || key.endsWith("Path");
}

export function buildPortalSessionRecord(session: SessionRecord): SessionRecord {
  return {
    ...session,
    localAudioPath: session.localAudioPath ? readFileLabel(session.localAudioPath) : "",
    artifacts: session.artifacts.map((artifact) => ({
      ...artifact,
      location: undefined
    }))
  };
}

function hasCompletedNoteOutput(snapshot: SessionSnapshot) {
  return (
    Boolean(snapshot.notes) ||
    snapshot.session.artifacts.some(
      (artifact) =>
        artifact.status === "ready" && completionArtifactKinds.has(artifact.kind)
    )
  );
}

function resolvePortalSessionStatus(
  snapshot: SessionSnapshot,
  now: Date
): SessionStatus {
  const status = snapshot.session.status;

  if (status === "completed" || status === "failed") {
    return status;
  }

  if (hasCompletedNoteOutput(snapshot)) {
    return "completed";
  }

  if (status === "recording" && snapshot.session.localAudioPath) {
    return "transcribing";
  }

  if (
    pipelineProcessingStatuses.has(status) &&
    snapshot.session.localAudioPath
  ) {
    const startedAtMs = Date.parse(snapshot.session.startedAt);
    const ageMs = Number.isFinite(startedAtMs)
      ? now.getTime() - startedAtMs
      : 0;

    if (ageMs > stalePipelineProcessingMs) {
      return "failed";
    }
  }

  if (status === "recording" || status === "uploading") {
    const startedAtMs = Date.parse(snapshot.session.startedAt);
    const ageMs = Number.isFinite(startedAtMs)
      ? now.getTime() - startedAtMs
      : 0;

    if (!snapshot.session.localAudioPath && ageMs > staleClientRecordingMs) {
      return "failed";
    }
  }

  return status;
}

export function buildPortalSessionSnapshot(
  snapshot: SessionSnapshot,
  options?: { now?: Date }
): SessionSnapshot {
  const session = buildPortalSessionRecord(snapshot.session);

  return {
    ...snapshot,
    session: {
      ...session,
      status: resolvePortalSessionStatus(snapshot, options?.now ?? new Date())
    }
  };
}

export function buildPortalSourceAudioUpload(input: {
  sessionId: string;
  fileId: string;
  fileName: string;
  byteLength: number;
  sha256?: string;
  createdAt: string;
}) {
  return {
    sessionId: input.sessionId,
    fileId: input.fileId,
    fileName: input.fileName,
    byteLength: input.byteLength,
    sha256: input.sha256,
    createdAt: input.createdAt
  };
}

export function buildPortalAuditEvent(event: AuditEventRecord): AuditEventRecord {
  return {
    ...event,
    payload: Object.fromEntries(
      Object.entries(event.payload).filter(([key]) => !isBlockedAuditPayloadKey(key))
    )
  };
}
