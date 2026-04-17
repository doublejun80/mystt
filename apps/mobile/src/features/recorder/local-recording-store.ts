import * as FileSystem from "expo-file-system";

import type {
  RecorderEvidenceEvent,
  RecorderInputSelection,
  RecorderPhase,
  RecorderRuntimeState,
  SessionRecord
} from "@mystt/audio-core";

const documentRoot = FileSystem.documentDirectory ?? null;
const recorderRoot = documentRoot ? `${documentRoot}mystt-recorder` : null;
const recordingsRoot = recorderRoot ? `${recorderRoot}/recordings` : null;
const ledgerPath = recorderRoot ? `${recorderRoot}/sessions.json` : null;
const runtimeStatePath = recorderRoot ? `${recorderRoot}/runtime-state.json` : null;

export interface LocalRecordingLedgerEntry {
  session: SessionRecord;
  durationMillis: number;
  sizeBytes: number | null;
  phaseHistory: RecorderPhase[];
  savedAt: string;
  uploadState: "local-only" | "queued" | "uploaded";
  operationLog: string[];
  remoteSessionId?: string;
  remoteFileId?: string;
  uploadQueuedAt?: string;
  checksumMd5: string | null;
  sessionJsonPath: string;
  runtimeStatePath: string;
  lastKnownAppState: string;
  backgroundTransitionCount: number;
  selectedInput: RecorderInputSelection | null;
  evidenceLog: RecorderEvidenceEvent[];
}

function requireRecorderPath(path: string | null, label: string) {
  if (!path) {
    throw new Error(`${label} 경로를 만들 수 없습니다. documentDirectory가 비어 있습니다.`);
  }

  return path;
}

async function ensureRecorderDirectories() {
  const root = requireRecorderPath(recorderRoot, "레코더 루트");
  const recordings = requireRecorderPath(recordingsRoot, "녹음 저장소");

  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  await FileSystem.makeDirectoryAsync(recordings, { intermediates: true });

  return {
    root,
    recordings,
    ledger: requireRecorderPath(ledgerPath, "세션 인덱스"),
    runtimeState: requireRecorderPath(runtimeStatePath, "런타임 상태")
  };
}

function sanitizeFileSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function inferExtension(sourceUri: string) {
  const matched = sourceUri.match(/\.[a-z0-9]+(?:\?.*)?$/i)?.[0];

  if (!matched) {
    return ".m4a";
  }

  return matched.replace(/\?.*$/, "");
}

async function writeSessionEntry(entry: LocalRecordingLedgerEntry) {
  const { recordings } = await ensureRecorderDirectories();
  const sessionDir = `${recordings}/${entry.session.id}`;

  await FileSystem.makeDirectoryAsync(sessionDir, { intermediates: true });
  await FileSystem.writeAsStringAsync(
    `${sessionDir}/session.json`,
    JSON.stringify(entry, null, 2)
  );
}

export async function readLocalRecordingLedger(): Promise<LocalRecordingLedgerEntry[]> {
  const { ledger } = await ensureRecorderDirectories();
  const info = await FileSystem.getInfoAsync(ledger);

  if (!info.exists) {
    return [];
  }

  const content = await FileSystem.readAsStringAsync(ledger);

  if (!content.trim()) {
    return [];
  }

  return JSON.parse(content) as LocalRecordingLedgerEntry[];
}

async function writeLocalRecordingLedger(entries: LocalRecordingLedgerEntry[]) {
  const { ledger } = await ensureRecorderDirectories();

  await FileSystem.writeAsStringAsync(ledger, JSON.stringify(entries, null, 2));
}

export async function persistLocalRecording(params: {
  sourceUri: string;
  session: SessionRecord;
  durationMillis: number;
  phaseHistory: RecorderPhase[];
  operationLog: string[];
  lastKnownAppState: string;
  backgroundTransitionCount: number;
  selectedInput: RecorderInputSelection | null;
  evidenceLog: RecorderEvidenceEvent[];
}) {
  const { recordings, runtimeState } = await ensureRecorderDirectories();
  const sessionDir = `${recordings}/${params.session.id}`;

  await FileSystem.makeDirectoryAsync(sessionDir, { intermediates: true });

  const safeTitle = sanitizeFileSegment(params.session.title) || params.session.id;
  const extension = inferExtension(params.sourceUri);
  const targetUri = `${sessionDir}/${safeTitle}${extension}`;

  if (params.sourceUri !== targetUri) {
    const existingTarget = await FileSystem.getInfoAsync(targetUri);

    if (existingTarget.exists) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
    }

    await FileSystem.copyAsync({
      from: params.sourceUri,
      to: targetUri
    });
  }

  const fileInfo = await FileSystem.getInfoAsync(targetUri, {
    size: true,
    md5: true
  });
  const sessionJsonPath = `${sessionDir}/session.json`;
  const entry: LocalRecordingLedgerEntry = {
    session: {
      ...params.session,
      localAudioPath: targetUri
    },
    durationMillis: params.durationMillis,
    sizeBytes:
      fileInfo.exists && !fileInfo.isDirectory && typeof fileInfo.size === "number"
        ? fileInfo.size
        : null,
    phaseHistory: params.phaseHistory,
    savedAt: new Date().toISOString(),
    uploadState: "local-only",
    operationLog: params.operationLog,
    checksumMd5:
      fileInfo.exists && !fileInfo.isDirectory && typeof fileInfo.md5 === "string"
        ? fileInfo.md5
        : null,
    sessionJsonPath,
    runtimeStatePath: runtimeState,
    lastKnownAppState: params.lastKnownAppState,
    backgroundTransitionCount: params.backgroundTransitionCount,
    selectedInput: params.selectedInput,
    evidenceLog: params.evidenceLog
  };

  await writeSessionEntry(entry);

  const existingEntries = await readLocalRecordingLedger();
  const nextEntries = [
    entry,
    ...existingEntries.filter((item) => item.session.id !== params.session.id)
  ];

  await writeLocalRecordingLedger(nextEntries);

  return entry;
}

export function getRecorderRootPath() {
  return recorderRoot ?? "unavailable";
}

export function getRecorderRuntimeStatePath() {
  return runtimeStatePath ?? "unavailable";
}

export async function persistRecorderRuntimeState(state: RecorderRuntimeState) {
  const { runtimeState } = await ensureRecorderDirectories();

  await FileSystem.writeAsStringAsync(runtimeState, JSON.stringify(state, null, 2));
}

export async function readRecorderRuntimeState(): Promise<RecorderRuntimeState | null> {
  const { runtimeState } = await ensureRecorderDirectories();
  const info = await FileSystem.getInfoAsync(runtimeState);

  if (!info.exists) {
    return null;
  }

  const content = await FileSystem.readAsStringAsync(runtimeState);

  if (!content.trim()) {
    return null;
  }

  return JSON.parse(content) as RecorderRuntimeState;
}

export async function clearRecorderRuntimeState() {
  const { runtimeState } = await ensureRecorderDirectories();

  await FileSystem.deleteAsync(runtimeState, { idempotent: true });
}

export async function updateLocalRecordingLedgerEntry(input: {
  sessionId: string;
  patch: Partial<
    Pick<
      LocalRecordingLedgerEntry,
      "uploadState" | "remoteSessionId" | "remoteFileId" | "uploadQueuedAt"
    >
  >;
}) {
  const entries = await readLocalRecordingLedger();
  const nextEntries = entries.map((entry) =>
    entry.session.id === input.sessionId
      ? {
          ...entry,
          ...input.patch
        }
      : entry
  );

  await writeLocalRecordingLedger(nextEntries);

  const updatedEntry = nextEntries.find((entry) => entry.session.id === input.sessionId);

  if (updatedEntry) {
    await writeSessionEntry(updatedEntry);
  }

  return nextEntries;
}
