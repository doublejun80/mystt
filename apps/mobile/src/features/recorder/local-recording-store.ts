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
  localSha256?: string | null;
  remoteSha256?: string;
  remoteByteLength?: number;
  uploadVerifiedAt?: string;
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

function rightRotate(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Bytes(bytes: Uint8Array) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15]!, 7) ^ rightRotate(words[index - 15]!, 18) ^ (words[index - 15]! >>> 3);
      const s1 = rightRotate(words[index - 2]!, 17) ^ rightRotate(words[index - 2]!, 19) ^ (words[index - 2]! >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + constants[index]! + words[index]!) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + temp1) >>> 0, c, b, a, (temp1 + temp2) >>> 0];
    }
    for (let index = 0; index < 8; index += 1) {
      hash[index] = (hash[index]! + [a, b, c, d, e, f, g, h][index]!) >>> 0;
    }
  }

  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

async function computeFileSha256(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return sha256Bytes(bytes);
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
  let checksumSha256: string | null = null;
  try {
    checksumSha256 = await computeFileSha256(targetUri);
  } catch {
    checksumSha256 = null;
  }
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
    localSha256: checksumSha256,
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
      | "uploadState"
      | "remoteSessionId"
      | "remoteFileId"
      | "localSha256"
      | "remoteSha256"
      | "remoteByteLength"
      | "uploadVerifiedAt"
      | "uploadQueuedAt"
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
