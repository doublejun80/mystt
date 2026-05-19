import type {
  RecorderEvidenceEvent,
  RecorderInputSelection,
  RecorderPhase,
  RecorderRuntimeState
} from "./recorder-domain";
import type { SessionRecord } from "./session-core";

export type RecorderUploadState = "local-only" | "queued" | "uploaded" | "failed";

export interface TauriRecorderPersistedSessionEntry {
  session: SessionRecord;
  durationMillis: number | null;
  sizeBytes: number | null;
  phaseHistory: RecorderPhase[];
  savedAt: string;
  uploadState: RecorderUploadState;
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

export interface TauriRecorderStoreStatus {
  platform: string;
  recorderRoot: string;
  recordingsRoot: string;
  ledgerPath: string;
  runtimeStatePath: string;
  hasRuntimeState: boolean;
  savedSessionCount: number;
  runtimeState: RecorderRuntimeState | null;
  recentSessions: TauriRecorderPersistedSessionEntry[];
}
