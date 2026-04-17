import {
  createReadStream,
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";

import {
  artifactKinds,
  type ArtifactRecord,
  type SessionRecord
} from "@mystt/audio-core";
import type { SessionNotes } from "@mystt/notes-schema";
import type { SonioxAsyncTranscript } from "@mystt/soniox-client";
import type { NormalizedTranscript } from "@mystt/transcript-normalizer";

import { isMinioConfigured, isPostgresConfigured } from "../config";
import {
  getAudioBucketName,
  getArtifactBucketName,
  getPostgresPool,
  getS3StorageClient
} from "./backends";
import { shadowWriteInsforgeArtifact } from "./insforge";

export interface StoredTranscription {
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

export interface StoredNotes {
  model: string;
  notes: SessionNotes;
  createdAt: string;
}

export interface StoredProviderCheck {
  configured: boolean;
  ok: boolean | null;
  checkedAt?: string;
  detail?: string;
}

export interface AuditEventRecord {
  eventId: string;
  sessionId?: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PersistedApiState {
  sessions: SessionRecord[];
  webhookFingerprints: string[];
  sessionByTranscriptionId: Record<string, string>;
  transcriptionBySessionId: Record<string, StoredTranscription>;
  normalizedTranscripts: Record<string, NormalizedTranscript>;
  rawTranscriptText: Record<string, string>;
  notesBySessionId: Record<string, StoredNotes>;
  providerChecks: Partial<Record<"soniox" | "openai", StoredProviderCheck>>;
  auditEvents: AuditEventRecord[];
}

export interface PersistenceBackendStatus {
  configured: boolean;
  mode: "disabled" | "remote" | "local-fallback";
  lastLoadOk: boolean | null;
  lastWriteOk: boolean | null;
  lastReadOk: boolean | null;
  lastError?: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const dataRoot = resolve(repoRoot, ".data");
const stateFile = resolve(dataRoot, "api-state.json");
const auditLogFile = resolve(dataRoot, "audit-events.ndjson");
const artifactRoot = resolve(dataRoot, "artifacts", "sessions");
const audioRoot = resolve(dataRoot, "audio", "sessions");
const locallyAppendedAuditEventIds = new Set<string>();
const postgresStateWriteLockKey = 54_240_001;
const persistenceStatus: {
  postgres: PersistenceBackendStatus;
  minio: PersistenceBackendStatus;
} = {
  postgres: {
    configured: isPostgresConfigured(),
    mode: isPostgresConfigured() ? "local-fallback" : "disabled",
    lastLoadOk: null,
    lastWriteOk: null,
    lastReadOk: null
  },
  minio: {
    configured: isMinioConfigured(),
    mode: isMinioConfigured() ? "local-fallback" : "disabled",
    lastLoadOk: null,
    lastWriteOk: null,
    lastReadOk: null
  }
};

function setPostgresStatus(input: Partial<PersistenceBackendStatus>) {
  Object.assign(persistenceStatus.postgres, input, {
    configured: isPostgresConfigured()
  });
}

function setMinioStatus(input: Partial<PersistenceBackendStatus>) {
  Object.assign(persistenceStatus.minio, input, {
    configured: isMinioConfigured()
  });
}

export function getPersistenceRuntimeStatus() {
  return {
    postgres: { ...persistenceStatus.postgres },
    minio: { ...persistenceStatus.minio },
    paths: {
      dataRoot,
      stateFile,
      auditLogFile,
      artifactRoot,
      audioRoot
    }
  };
}

function createEmptyState(seedSessions: SessionRecord[]): PersistedApiState {
  return {
    sessions: seedSessions,
    webhookFingerprints: [],
    sessionByTranscriptionId: {},
    transcriptionBySessionId: {},
    normalizedTranscripts: {},
    rawTranscriptText: {},
    notesBySessionId: {},
    providerChecks: {},
    auditEvents: []
  };
}

function markAuditEventsAsLocallyPersisted(events: AuditEventRecord[]) {
  for (const event of events) {
    locallyAppendedAuditEventIds.add(event.eventId);
  }
}

function ensurePaths() {
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(audioRoot, { recursive: true });
}

function readLocalAuditEvents(): AuditEventRecord[] {
  if (!existsSync(auditLogFile)) {
    return [];
  }

  const lines = readFileSync(auditLogFile, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const events = lines.map((line) => JSON.parse(line) as AuditEventRecord);
  markAuditEventsAsLocallyPersisted(events);
  return events;
}

function loadLocalPersistedApiState(seedSessions: SessionRecord[]): PersistedApiState {
  ensurePaths();
  const auditEvents = readLocalAuditEvents();

  if (!existsSync(stateFile)) {
    return {
      ...createEmptyState(seedSessions),
      auditEvents
    };
  }

  const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Partial<PersistedApiState>;
  const fallbackAuditEvents = parsed.auditEvents ?? [];
  if (auditEvents.length === 0 && fallbackAuditEvents.length > 0) {
    markAuditEventsAsLocallyPersisted(fallbackAuditEvents);
  }

  return {
    ...createEmptyState(seedSessions),
    ...parsed,
    auditEvents: auditEvents.length > 0 ? auditEvents : fallbackAuditEvents
  };
}

function persistLocalApiState(
  state: PersistedApiState,
  pendingAuditEvents: AuditEventRecord[]
) {
  ensurePaths();
  if (pendingAuditEvents.length > 0) {
    const eventsToAppend = pendingAuditEvents.filter(
      (event) => !locallyAppendedAuditEventIds.has(event.eventId)
    );
    const lines = eventsToAppend.map((event) => JSON.stringify(event));

    if (lines.length > 0) {
      appendFileSync(auditLogFile, `${lines.join("\n")}\n`, "utf8");
      markAuditEventsAsLocallyPersisted(eventsToAppend);
    }
  }

  writeFileSync(
    stateFile,
    JSON.stringify(
      {
        ...state,
        auditEvents: []
      },
      null,
      2
    ),
    "utf8"
  );
}

function writeLocalSessionArtifact(params: {
  sessionId: string;
  fileName: string;
  content: string | Uint8Array;
}): string {
  ensurePaths();
  const sessionDir = resolve(artifactRoot, params.sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const filePath = resolve(sessionDir, params.fileName);

  if (typeof params.content === "string") {
    writeFileSync(filePath, params.content, "utf8");
  } else {
    writeFileSync(filePath, params.content);
  }

  return filePath;
}

function writeLocalSessionAudio(params: {
  sessionId: string;
  fileName: string;
  content: Uint8Array;
}): string {
  ensurePaths();
  const sessionDir = resolve(audioRoot, params.sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const filePath = resolve(sessionDir, params.fileName);
  writeFileSync(filePath, params.content);
  return filePath;
}

async function writeLocalSessionAudioFromFile(params: {
  sessionId: string;
  fileName: string;
  filePath: string;
}): Promise<string> {
  ensurePaths();
  const sessionDir = resolve(audioRoot, params.sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const destinationPath = resolve(sessionDir, params.fileName);
  await copyFile(params.filePath, destinationPath);
  return destinationPath;
}

function buildArtifactObjectKey(sessionId: string, fileName: string): string {
  return `sessions/${sessionId}/${fileName}`;
}

function buildArtifactLocation(bucket: string, key: string): string {
  return `minio://${bucket}/${key}`;
}

function parseArtifactLocation(location: string): { bucket: string; key: string } | null {
  if (!location.startsWith("minio://")) {
    return null;
  }

  const withoutScheme = location.slice("minio://".length);
  const [bucket, ...rest] = withoutScheme.split("/");

  if (!bucket || rest.length === 0) {
    return null;
  }

  return {
    bucket,
    key: rest.join("/")
  };
}

async function writeRemoteSessionArtifact(params: {
  sessionId: string;
  fileName: string;
  content: string | Uint8Array;
  bucket?: string;
  contentType?: string;
}): Promise<string> {
  const bucket = params.bucket ?? getArtifactBucketName();
  const key = buildArtifactObjectKey(params.sessionId, params.fileName);
  const client = getS3StorageClient();
  const resolvedContentType = params.contentType ?? (params.fileName.endsWith(".json")
    ? "application/json"
    : params.fileName.endsWith(".html")
      ? "text/html; charset=utf-8"
      : params.fileName.endsWith(".md")
        ? "text/markdown; charset=utf-8"
        : params.fileName.endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/octet-stream");

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: typeof params.content === "string" ? Buffer.from(params.content, "utf8") : params.content,
      ContentType: resolvedContentType
    })
  );

  setMinioStatus({
    mode: "remote",
    lastWriteOk: true,
    lastError: undefined
  });

  return buildArtifactLocation(bucket, key);
}

async function writeRemoteSessionArtifactFromFile(params: {
  sessionId: string;
  fileName: string;
  filePath: string;
  bucket?: string;
  contentType?: string;
}): Promise<string> {
  const bucket = params.bucket ?? getArtifactBucketName();
  const key = buildArtifactObjectKey(params.sessionId, params.fileName);
  const client = getS3StorageClient();
  const resolvedContentType = params.contentType ?? "application/octet-stream";

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(params.filePath),
      ContentType: resolvedContentType
    })
  );

  setMinioStatus({
    mode: "remote",
    lastWriteOk: true,
    lastError: undefined
  });

  return buildArtifactLocation(bucket, key);
}

async function readRemoteArtifactBuffer(location: string): Promise<Buffer> {
  const parsed = parseArtifactLocation(location);

  if (!parsed) {
    throw new Error(`Unsupported artifact location: ${location}`);
  }

  const client = getS3StorageClient();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key
    })
  );

  const body = response.Body;

  if (!body || typeof body.transformToByteArray !== "function") {
    throw new Error(`Artifact body is not readable for location: ${location}`);
  }

  const content = Buffer.from(await body.transformToByteArray());
  setMinioStatus({
    mode: "remote",
    lastReadOk: true,
    lastError: undefined
  });
  return content;
}

async function deleteRemoteObject(location: string): Promise<void> {
  const parsed = parseArtifactLocation(location);

  if (!parsed) {
    throw new Error(`Unsupported artifact location: ${location}`);
  }

  const client = getS3StorageClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key
    })
  );
}

async function ensurePostgresTranscriptionCleanupColumns(client: {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}) {
  await client.query(
    `ALTER TABLE transcription_jobs
      ADD COLUMN IF NOT EXISTS cleanup_targets JSONB NOT NULL DEFAULT '[]'::jsonb`
  );
  await client.query(
    `ALTER TABLE transcription_jobs
      ADD COLUMN IF NOT EXISTS cleanup_status TEXT NOT NULL DEFAULT 'pending'`
  );
  await client.query(
    `ALTER TABLE transcription_jobs
      ADD COLUMN IF NOT EXISTS cleanup_requested_at TIMESTAMPTZ`
  );
  await client.query(
    `ALTER TABLE transcription_jobs
      ADD COLUMN IF NOT EXISTS cleanup_completed_at TIMESTAMPTZ`
  );
  await client.query(
    `ALTER TABLE transcription_jobs
      ADD COLUMN IF NOT EXISTS cleanup_last_error TEXT`
  );
  await client.query(
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'transcription_jobs_cleanup_status_check'
      ) THEN
        ALTER TABLE transcription_jobs
          ADD CONSTRAINT transcription_jobs_cleanup_status_check
          CHECK (cleanup_status IN ('pending', 'completed', 'failed', 'skipped'));
      END IF;
    END $$;`
  );
}

async function loadPostgresPersistedApiState(seedSessions: SessionRecord[]) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await ensurePostgresTranscriptionCleanupColumns(client);

    const sessionsResult = await client.query(
      `SELECT
          id,
          title,
          mode,
          status,
          started_at,
          ended_at,
          project_key,
          local_audio_path,
          language_hints,
          profile,
          realtime_policy,
          pending_chunk_count
        FROM sessions
        ORDER BY started_at DESC`
    );
    const participantsResult = await client.query(
      `SELECT session_id, participant_id, name, role
      FROM session_participants`
    );
    const artifactsResult = await client.query(
      `SELECT session_id, kind, status, location
      FROM session_artifacts`
    );
    const jobsResult = await client.query(
      `SELECT
          transcription_id,
          session_id,
          status,
          created_at,
          filename,
          audio_url,
          file_id,
          cleanup_targets,
          cleanup_status,
          cleanup_requested_at,
          cleanup_completed_at,
          cleanup_last_error,
          error_message
        FROM transcription_jobs`
    );
    const providerChecksResult = await client.query(
      `SELECT provider, configured, ok, detail, checked_at
      FROM provider_checks`
    );
    const notesResult = await client.query(
      `SELECT session_id, model, notes, created_at
      FROM note_artifacts`
    );
    const transcriptCacheResult = await client.query(
      `SELECT session_id, transcript_text, normalized_transcript
      FROM transcript_cache`
    );
    const fingerprintResult = await client.query(
      `SELECT fingerprint
      FROM webhook_fingerprints`
    );
    const auditEventsResult = await client.query(
      `SELECT event_id, session_id, kind, payload, created_at
      FROM audit_events
      ORDER BY created_at DESC`
    );

    if (sessionsResult.rowCount === 0) {
      const localState = loadLocalPersistedApiState(seedSessions);
      await persistPostgresApiState(localState);
      await persistPostgresAuditEvents(localState.auditEvents);
      setPostgresStatus({
        mode: "remote",
        lastLoadOk: true,
        lastError: undefined
      });
      return localState;
    }

    const participantsBySession = new Map<
      string,
      Array<{ id: string; name: string; role?: string }>
    >();
    for (const row of participantsResult.rows) {
      const list = participantsBySession.get(row.session_id) ?? [];
      list.push({
        id: row.participant_id,
        name: row.name,
        role: row.role ?? undefined
      });
      participantsBySession.set(row.session_id, list);
    }

    const artifactsBySession = new Map<
      string,
      Map<string, ArtifactRecord>
    >();
    for (const row of artifactsResult.rows) {
      const artifactMap = artifactsBySession.get(row.session_id) ?? new Map<string, ArtifactRecord>();
      artifactMap.set(row.kind, {
        kind: row.kind,
        status: row.status,
        location: row.location ?? undefined
      });
      artifactsBySession.set(row.session_id, artifactMap);
    }

    const transcriptionBySessionId = Object.fromEntries(
      jobsResult.rows.map((row: any) => [
        row.session_id,
        {
          transcriptionId: row.transcription_id,
          status: row.status,
          createdAt: new Date(row.created_at).toISOString(),
          filename: row.filename ?? undefined,
          audioUrl: row.audio_url ?? undefined,
          fileId: row.file_id ?? undefined,
          cleanupTargets: row.cleanup_targets ?? [],
          cleanupStatus: row.cleanup_status ?? "pending",
          cleanupRequestedAt: row.cleanup_requested_at
            ? new Date(row.cleanup_requested_at).toISOString()
            : undefined,
          cleanupCompletedAt: row.cleanup_completed_at
            ? new Date(row.cleanup_completed_at).toISOString()
            : undefined,
          cleanupLastError: row.cleanup_last_error ?? undefined,
          errorMessage: row.error_message ?? undefined
        } satisfies StoredTranscription
      ])
    ) as Record<string, StoredTranscription>;

    const sessionByTranscriptionId = Object.fromEntries(
      jobsResult.rows.map((row: any) => [row.transcription_id, row.session_id])
    );

    const notesBySessionId = Object.fromEntries(
      notesResult.rows.map((row: any) => [
        row.session_id,
        {
          model: row.model,
          notes: row.notes as SessionNotes,
          createdAt: new Date(row.created_at).toISOString()
        } satisfies StoredNotes
      ])
    ) as Record<string, StoredNotes>;

    const normalizedTranscripts = Object.fromEntries(
      transcriptCacheResult.rows.map((row: any) => [row.session_id, row.normalized_transcript])
    ) as Record<string, NormalizedTranscript>;

    const rawTranscriptText = Object.fromEntries(
      transcriptCacheResult.rows.map((row: any) => [row.session_id, row.transcript_text])
    ) as Record<string, string>;

    const providerChecks = Object.fromEntries(
      providerChecksResult.rows.map((row: any) => [
        row.provider,
        {
          configured: row.configured,
          ok: row.ok,
          detail: row.detail ?? undefined,
          checkedAt: row.checked_at ? new Date(row.checked_at).toISOString() : undefined
        } satisfies StoredProviderCheck
      ])
    ) as PersistedApiState["providerChecks"];

    const sessions = sessionsResult.rows.map((row: any) => {
      const artifactMap = artifactsBySession.get(row.id) ?? new Map<string, ArtifactRecord>();

      return {
        id: row.id,
        title: row.title,
        mode: row.mode,
        status: row.status,
        startedAt: new Date(row.started_at).toISOString(),
        endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : undefined,
        projectKey: row.project_key ?? undefined,
        participants: participantsBySession.get(row.id) ?? [],
        languageHints: row.language_hints ?? ["ko", "en"],
        localAudioPath: row.local_audio_path,
        profile: row.profile,
        realtimePolicy: row.realtime_policy,
        pendingChunkCount: row.pending_chunk_count,
        artifacts: artifactKinds.map(
          (kind) =>
            artifactMap.get(kind) ?? {
              kind,
              status: "pending"
            }
        )
      } satisfies SessionRecord;
    });

    setPostgresStatus({
      mode: "remote",
      lastLoadOk: true,
      lastError: undefined
    });

    return {
      sessions,
      webhookFingerprints: fingerprintResult.rows.map((row: any) => row.fingerprint as string),
      sessionByTranscriptionId,
      transcriptionBySessionId,
      normalizedTranscripts,
      rawTranscriptText,
      notesBySessionId,
      providerChecks,
      auditEvents: auditEventsResult.rows.map((row: any) => ({
        eventId: row.event_id,
        sessionId: row.session_id ?? undefined,
        kind: row.kind,
        payload: row.payload ?? {},
        createdAt: new Date(row.created_at).toISOString()
      }))
    } satisfies PersistedApiState;
  } finally {
    client.release();
  }
}

async function persistPostgresApiState(state: PersistedApiState) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  const sessionIds = state.sessions.map((session) => session.id);

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [postgresStateWriteLockKey]);
    await ensurePostgresTranscriptionCleanupColumns(client);

    if (sessionIds.length === 0) {
      await client.query("DELETE FROM webhook_fingerprints");
      await client.query("DELETE FROM provider_checks");
      await client.query("DELETE FROM sessions");
    } else {
      await client.query("DELETE FROM webhook_fingerprints");
      await client.query("DELETE FROM provider_checks");
      await client.query("DELETE FROM session_participants WHERE session_id = ANY($1::text[])", [
        sessionIds
      ]);
      await client.query("DELETE FROM session_artifacts WHERE session_id = ANY($1::text[])", [
        sessionIds
      ]);
      await client.query("DELETE FROM transcription_jobs WHERE session_id = ANY($1::text[])", [
        sessionIds
      ]);
      await client.query("DELETE FROM note_artifacts WHERE session_id = ANY($1::text[])", [
        sessionIds
      ]);
      await client.query("DELETE FROM transcript_cache WHERE session_id = ANY($1::text[])", [
        sessionIds
      ]);
      await client.query("DELETE FROM sessions WHERE NOT (id = ANY($1::text[]))", [sessionIds]);
    }

    for (const session of state.sessions) {
      await client.query(
        `INSERT INTO sessions (
          id,
          title,
          mode,
          status,
          started_at,
          ended_at,
          project_key,
          local_audio_path,
          language_hints,
          profile,
          realtime_policy,
          pending_chunk_count,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::jsonb, $11, $12, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          mode = EXCLUDED.mode,
          status = EXCLUDED.status,
          started_at = EXCLUDED.started_at,
          ended_at = EXCLUDED.ended_at,
          project_key = EXCLUDED.project_key,
          local_audio_path = EXCLUDED.local_audio_path,
          language_hints = EXCLUDED.language_hints,
          profile = EXCLUDED.profile,
          realtime_policy = EXCLUDED.realtime_policy,
          pending_chunk_count = EXCLUDED.pending_chunk_count,
          updated_at = NOW()`,
        [
          session.id,
          session.title,
          session.mode,
          session.status,
          session.startedAt,
          session.endedAt ?? null,
          session.projectKey ?? null,
          session.localAudioPath,
          session.languageHints,
          JSON.stringify(session.profile),
          session.realtimePolicy,
          session.pendingChunkCount
        ]
      );

      for (const participant of session.participants) {
        await client.query(
          `INSERT INTO session_participants (
            session_id,
            participant_id,
            name,
            role
          ) VALUES ($1, $2, $3, $4)`,
          [session.id, participant.id, participant.name, participant.role ?? null]
        );
      }

      for (const artifact of session.artifacts) {
        await client.query(
          `INSERT INTO session_artifacts (
            session_id,
            kind,
            status,
            location,
            updated_at
          ) VALUES ($1, $2, $3, $4, NOW())`,
          [session.id, artifact.kind, artifact.status, artifact.location ?? null]
        );
      }

      const transcription = state.transcriptionBySessionId[session.id];
      if (transcription) {
        await client.query(
          `INSERT INTO transcription_jobs (
            transcription_id,
            session_id,
            status,
            created_at,
            filename,
            audio_url,
            file_id,
            cleanup_targets,
            cleanup_status,
            cleanup_requested_at,
            cleanup_completed_at,
            cleanup_last_error,
            error_message
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)`,
          [
            transcription.transcriptionId,
            session.id,
            transcription.status,
            transcription.createdAt,
            transcription.filename ?? null,
            transcription.audioUrl ?? null,
            transcription.fileId ?? null,
            JSON.stringify(transcription.cleanupTargets ?? []),
            transcription.cleanupStatus ?? "pending",
            transcription.cleanupRequestedAt ?? null,
            transcription.cleanupCompletedAt ?? null,
            transcription.cleanupLastError ?? null,
            transcription.errorMessage ?? null
          ]
        );
      }

      const notes = state.notesBySessionId[session.id];
      if (notes) {
        await client.query(
          `INSERT INTO note_artifacts (
            session_id,
            model,
            notes,
            created_at
          ) VALUES ($1, $2, $3::jsonb, $4)`,
          [session.id, notes.model, JSON.stringify(notes.notes), notes.createdAt]
        );
      }

      const normalizedTranscript = state.normalizedTranscripts[session.id];
      const transcriptText = state.rawTranscriptText[session.id];
      if (normalizedTranscript && transcriptText) {
        await client.query(
          `INSERT INTO transcript_cache (
            session_id,
            transcript_text,
            normalized_transcript,
            updated_at
          ) VALUES ($1, $2, $3::jsonb, NOW())`,
          [session.id, transcriptText, JSON.stringify(normalizedTranscript)]
        );
      }
    }

    for (const [provider, check] of Object.entries(state.providerChecks)) {
      if (!check) {
        continue;
      }

      await client.query(
        `INSERT INTO provider_checks (
          provider,
          configured,
          ok,
          detail,
          checked_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          provider,
          check.configured,
          check.ok,
          check.detail ?? null,
          check.checkedAt ?? null
        ]
      );
    }

    for (const fingerprint of state.webhookFingerprints) {
      await client.query(
        `INSERT INTO webhook_fingerprints (fingerprint) VALUES ($1)`,
        [fingerprint]
      );
    }

    await client.query("COMMIT");
    setPostgresStatus({
      mode: "remote",
      lastWriteOk: true,
      lastError: undefined
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function persistPostgresAuditEvents(events: AuditEventRecord[]) {
  if (events.length === 0) {
    return;
  }

  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    for (const event of events) {
      await client.query(
        `INSERT INTO audit_events (
          event_id,
          session_id,
          kind,
          payload,
          created_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5)
        ON CONFLICT (event_id) DO NOTHING`,
        [
          event.eventId,
          event.sessionId ?? null,
          event.kind,
          JSON.stringify(event.payload),
          event.createdAt
        ]
      );
    }
  } finally {
    client.release();
  }
}

export async function loadPersistedApiState(
  seedSessions: SessionRecord[]
): Promise<PersistedApiState> {
  const localState = loadLocalPersistedApiState(seedSessions);

  if (!isPostgresConfigured()) {
    setPostgresStatus({
      mode: "disabled",
      lastLoadOk: null,
      lastWriteOk: null,
      lastReadOk: null,
      lastError: undefined
    });
    return localState;
  }

  try {
    return await loadPostgresPersistedApiState(seedSessions);
  } catch (error) {
    setPostgresStatus({
      mode: "local-fallback",
      lastLoadOk: false,
      lastError: error instanceof Error ? error.message : String(error)
    });
    console.warn(
      "[persistence] Falling back to local state because Postgres load failed:",
      error instanceof Error ? error.message : error
    );
    return localState;
  }
}

export async function persistApiState(state: PersistedApiState) {
  const pendingAuditEvents = state.auditEvents.filter(
    (event) => !locallyAppendedAuditEventIds.has(event.eventId)
  );
  persistLocalApiState(state, pendingAuditEvents);

  if (!isPostgresConfigured()) {
    setPostgresStatus({
      mode: "disabled",
      lastWriteOk: null,
      lastError: undefined
    });
    return;
  }

  try {
    await persistPostgresApiState(state);
    await persistPostgresAuditEvents(state.auditEvents);
  } catch (error) {
    setPostgresStatus({
      mode: "local-fallback",
      lastWriteOk: false,
      lastError: error instanceof Error ? error.message : String(error)
    });
    console.warn(
      "[persistence] Postgres write failed; local state remains current:",
      error instanceof Error ? error.message : error
    );
  }
}

export async function writeSessionArtifact(params: {
  sessionId: string;
  fileName: string;
  content: string | Uint8Array;
}): Promise<string> {
  await shadowWriteInsforgeArtifact(params);

  if (isMinioConfigured()) {
    try {
      return await writeRemoteSessionArtifact(params);
    } catch (error) {
      setMinioStatus({
        mode: "local-fallback",
        lastWriteOk: false,
        lastError: error instanceof Error ? error.message : String(error)
      });
      console.warn(
        "[persistence] MinIO write failed; storing artifact locally instead:",
        error instanceof Error ? error.message : error
      );
    }
  }

  if (!isMinioConfigured()) {
    setMinioStatus({
      mode: "disabled",
      lastWriteOk: null,
      lastError: undefined
    });
  }

  return writeLocalSessionArtifact(params);
}

export async function writeSessionSourceAudio(params: {
  sessionId: string;
  fileName: string;
  content: Uint8Array;
  contentType?: string;
}): Promise<string> {
  if (isMinioConfigured()) {
    try {
      return await writeRemoteSessionArtifact({
        sessionId: params.sessionId,
        fileName: params.fileName,
        content: params.content,
        bucket: getAudioBucketName(),
        contentType: params.contentType
      });
    } catch (error) {
      setMinioStatus({
        mode: "local-fallback",
        lastWriteOk: false,
        lastError: error instanceof Error ? error.message : String(error)
      });
      console.warn(
        "[persistence] MinIO audio write failed; storing source audio locally instead:",
        error instanceof Error ? error.message : error
      );
    }
  }

  if (!isMinioConfigured()) {
    setMinioStatus({
      mode: "disabled",
      lastWriteOk: null,
      lastError: undefined
    });
  }

  return writeLocalSessionAudio(params);
}

export async function writeSessionSourceAudioFromFile(params: {
  sessionId: string;
  fileName: string;
  filePath: string;
  contentType?: string;
}): Promise<string> {
  if (isMinioConfigured()) {
    try {
      return await writeRemoteSessionArtifactFromFile({
        sessionId: params.sessionId,
        fileName: params.fileName,
        filePath: params.filePath,
        bucket: getAudioBucketName(),
        contentType: params.contentType
      });
    } catch (error) {
      setMinioStatus({
        mode: "local-fallback",
        lastWriteOk: false,
        lastError: error instanceof Error ? error.message : String(error)
      });
      console.warn(
        "[persistence] MinIO audio write failed; storing source audio locally instead:",
        error instanceof Error ? error.message : error
      );
    }
  }

  if (!isMinioConfigured()) {
    setMinioStatus({
      mode: "disabled",
      lastWriteOk: null,
      lastError: undefined
    });
  }

  return writeLocalSessionAudioFromFile(params);
}

export async function readPersistedArtifact(location: string): Promise<string> {
  if (location.startsWith("minio://")) {
    return (await readPersistedArtifactBuffer(location)).toString("utf8");
  }

  return readFileSync(location, "utf8");
}

export async function readPersistedArtifactBuffer(location: string): Promise<Buffer> {
  if (location.startsWith("minio://")) {
    try {
      return await readRemoteArtifactBuffer(location);
    } catch (error) {
      setMinioStatus({
        mode: "local-fallback",
        lastReadOk: false,
        lastError: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  return readFileSync(location);
}

export async function deletePersistedLocation(location?: string | null) {
  if (!location) {
    return;
  }

  if (location.startsWith("minio://")) {
    try {
      await deleteRemoteObject(location);
      setMinioStatus({
        mode: "remote",
        lastWriteOk: true,
        lastError: undefined
      });
    } catch (error) {
      setMinioStatus({
        mode: "local-fallback",
        lastWriteOk: false,
        lastError: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    return;
  }

  if (existsSync(location)) {
    rmSync(location, { force: true });
  }
}

export async function deletePersistedSessionFiles(input: {
  sessionId: string;
  localAudioPath?: string | null;
  artifactLocations: Array<string | undefined>;
}) {
  const uniqueLocations = Array.from(
    new Set(
      [input.localAudioPath, ...input.artifactLocations]
        .filter((location): location is string => Boolean(location))
    )
  );

  for (const location of uniqueLocations) {
    try {
      await deletePersistedLocation(location);
    } catch (error) {
      console.warn(
        "[persistence] Failed to delete persisted location:",
        location,
        error instanceof Error ? error.message : error
      );
    }
  }

  rmSync(resolve(audioRoot, input.sessionId), { recursive: true, force: true });
  rmSync(resolve(artifactRoot, input.sessionId), { recursive: true, force: true });
}

export async function persistTranscriptArtifacts(input: {
  session: SessionRecord;
  rawTranscript: SonioxAsyncTranscript;
  normalizedTranscript: NormalizedTranscript;
  cleanMarkdown: string;
}) {
  return {
    rawTranscriptPath: await writeSessionArtifact({
      sessionId: input.session.id,
      fileName: "raw_transcript.json",
      content: JSON.stringify(input.rawTranscript, null, 2)
    }),
    cleanTranscriptPath: await writeSessionArtifact({
      sessionId: input.session.id,
      fileName: "clean_transcript.md",
      content: input.cleanMarkdown
    })
  };
}

export async function persistNotesArtifacts(input: {
  session: SessionRecord;
  notes: SessionNotes;
  notesHtml: string;
  notesDocx: Uint8Array;
  emailPreviewHtml: string;
}) {
  return {
    notesJsonPath: await writeSessionArtifact({
      sessionId: input.session.id,
      fileName: "meeting_notes.json",
      content: JSON.stringify(input.notes, null, 2)
    }),
    notesHtmlPath: await writeSessionArtifact({
      sessionId: input.session.id,
      fileName: "meeting_notes.html",
      content: input.notesHtml
    }),
    notesDocxPath: await writeSessionArtifact({
      sessionId: input.session.id,
      fileName: "meeting_notes.docx",
      content: input.notesDocx
    }),
    emailPreviewPath: await writeSessionArtifact({
      sessionId: input.session.id,
      fileName: "email_preview.html",
      content: input.emailPreviewHtml
    })
  };
}
