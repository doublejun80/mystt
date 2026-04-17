import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  type AudioRecorder,
  type RecorderState,
  type RecordingInput,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState
} from "expo-audio";
import * as FileSystem from "expo-file-system";

import {
  buildRecorderDomainSnapshot,
  buildRecorderSurvivalSummary,
  type RecorderEvidenceEvent,
  type RecorderEvidenceKind,
  type RecorderInputSelection,
  type RecorderPhase,
  type RecorderRuntimeState
} from "../../domain/background-recorder";
import {
  createMobileProcessingSession,
  enqueueSessionFromFileId,
  uploadMobileSourceAudio
} from "../../lib/api";
import {
  clearRecorderRuntimeState,
  getRecorderRootPath,
  getRecorderRuntimeStatePath,
  persistLocalRecording,
  persistRecorderRuntimeState,
  readLocalRecordingLedger,
  readRecorderRuntimeState,
  updateLocalRecordingLedgerEntry,
  type LocalRecordingLedgerEntry
} from "./local-recording-store";
import { createSessionRecord, type SessionMode, type SessionRecord } from "@mystt/audio-core";

type PermissionResponse = Awaited<ReturnType<typeof getRecordingPermissionsAsync>>;
type TransportState = "idle" | "recording" | "paused" | "saving" | "saved" | "error";

const targetRecordingMinutes = 120;
const estimatedBitRate = 64_000;
const twoHourEstimateMb = Math.round(((estimatedBitRate / 8) * 60 * 120) / 1024 / 1024);

const baseRecordingPreset =
  RecordingPresets.HIGH_QUALITY ?? RecordingPresets.LOW_QUALITY;

if (!baseRecordingPreset) {
  throw new Error("Expo audio recording preset is unavailable.");
}

const recordingOptions = {
  ...baseRecordingPreset,
  extension: ".m4a",
  sampleRate: 44_100,
  bitRate: estimatedBitRate,
  numberOfChannels: 1,
  isMeteringEnabled: true,
  android: {
    ...baseRecordingPreset.android,
    extension: ".m4a",
    outputFormat: "mpeg4" as const,
    audioEncoder: "aac" as const
  },
  ios: {
    ...baseRecordingPreset.ios,
    extension: ".m4a",
    sampleRate: 44_100
  }
};

export interface NativeRecorderInputOption {
  uid: string;
  label: string;
  type: string;
  preferred: boolean;
}

export interface NativeRecorderState {
  draftTitle: string;
  setDraftTitle: (value: string) => void;
  draftProjectKey: string;
  setDraftProjectKey: (value: string) => void;
  mode: SessionMode;
  setMode: (value: SessionMode) => void;
  permission: PermissionResponse | null;
  permissionLabel: string;
  transportState: TransportState;
  phase: RecorderPhase;
  recorderState: RecorderState;
  recorderSnapshot: ReturnType<typeof buildRecorderDomainSnapshot>;
  activeSession: SessionRecord;
  availableInputs: NativeRecorderInputOption[];
  selectedInputUid: string | null;
  selectInput: (uid: string) => void;
  refreshInputs: () => Promise<void>;
  recentRecordings: LocalRecordingLedgerEntry[];
  lastSavedEntry: LocalRecordingLedgerEntry | null;
  recoverySnapshot: RecorderRuntimeState | null;
  survivalSummary: ReturnType<typeof buildRecorderSurvivalSummary>;
  operationLog: string[];
  error: string | null;
  pipelineState: "idle" | "queueing" | "queued" | "error";
  recorderRootPath: string;
  runtimeStatePath: string;
  lastKnownAppState: string;
  backgroundTransitionCount: number;
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canSave: boolean;
  canDiscard: boolean;
  canQueueUpload: boolean;
  estimatedTwoHourSizeMb: number;
  startRecording: () => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  saveRecording: () => Promise<void>;
  discardRecording: () => Promise<void>;
  queueLocalRecording: () => Promise<void>;
}

function buildSessionId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `sess_mobile_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  );
}

function formatOperationLog(message: string) {
  const clock = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul"
  }).format(new Date());

  return `${clock} · ${message}`;
}

function choosePreferredInput(inputs: RecordingInput[]) {
  return [...inputs].sort((left, right) => {
    const leftScore = scoreInput(left);
    const rightScore = scoreInput(right);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return left.name.localeCompare(right.name, "ko");
  })[0];
}

function scoreInput(input: RecordingInput) {
  const label = `${input.name} ${input.type}`.toLowerCase();
  let score = 0;

  if (label.includes("airpods")) {
    score += 400;
  }

  if (/(headset|headphone|bluetooth|buds|earpod|external)/i.test(label)) {
    score += 250;
  }

  if (/(microphone|mic)/i.test(label)) {
    score += 120;
  }

  if (/(built-in|bottom|receiver)/i.test(label)) {
    score += 30;
  }

  return score;
}

function mapInputs(inputs: RecordingInput[], selectedUid: string | null): NativeRecorderInputOption[] {
  return inputs.map((input) => ({
    uid: input.uid,
    label: input.name,
    type: input.type,
    preferred: input.uid === selectedUid
  }));
}

function createInputSelection(
  inputs: Array<Pick<RecordingInput, "uid" | "name" | "type">>,
  selectedUid: string | null
): RecorderInputSelection | null {
  const target = inputs.find((input) => input.uid === selectedUid) ?? inputs[0];

  if (!target) {
    return null;
  }

  return {
    uid: target.uid,
    label: target.name,
    type: target.type
  };
}

async function configureRecordingMode() {
  await setAudioModeAsync({
    allowsRecording: true,
    shouldPlayInBackground: true,
    playsInSilentMode: true,
    interruptionMode: "doNotMix",
    shouldRouteThroughEarpiece: false
  });
}

async function relaxAudioMode() {
  await setAudioModeAsync({
    allowsRecording: false,
    shouldPlayInBackground: false,
    playsInSilentMode: false,
    interruptionMode: "mixWithOthers",
    shouldRouteThroughEarpiece: false
  });
}

async function prepareRecorder(
  recorder: AudioRecorder,
  selectedInputUid: string | null,
  setAvailableInputs: (value: NativeRecorderInputOption[]) => void,
  setSelectedInputUid: (value: string | null) => void
) {
  await recorder.prepareToRecordAsync(recordingOptions);
  const inputs = recorder.getAvailableInputs();

  if (inputs.length === 0) {
    setAvailableInputs([]);
    return [];
  }

  const selected =
    inputs.find((input) => input.uid === selectedInputUid) ?? choosePreferredInput(inputs);

  if (selected) {
    recorder.setInput(selected.uid);
    setSelectedInputUid(selected.uid);
  }

  setAvailableInputs(mapInputs(inputs, selected?.uid ?? null));

  return inputs;
}

function createPreviewSession({
  title,
  mode,
  projectKey
}: {
  title: string;
  mode: SessionMode;
  projectKey: string;
}) {
  return createSessionRecord({
    id: "sess_mobile_preview",
    title,
    mode,
    projectKey
  });
}

export function useNativeRecorder(): NativeRecorderState {
  const recorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(recorder, 300);
  const [draftTitle, setDraftTitle] = useState("새 회의");
  const [draftProjectKey, setDraftProjectKey] = useState("general");
  const [mode, setMode] = useState<SessionMode>("meeting");
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [transportState, setTransportState] = useState<TransportState>("idle");
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [availableInputs, setAvailableInputs] = useState<NativeRecorderInputOption[]>([]);
  const [selectedInputUid, setSelectedInputUid] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<SessionRecord>(() =>
    createPreviewSession({
      title: "새 회의",
      mode: "meeting",
      projectKey: "general"
    })
  );
  const [recentRecordings, setRecentRecordings] = useState<LocalRecordingLedgerEntry[]>([]);
  const [lastSavedEntry, setLastSavedEntry] = useState<LocalRecordingLedgerEntry | null>(null);
  const [recoverySnapshot, setRecoverySnapshot] = useState<RecorderRuntimeState | null>(null);
  const [operationLog, setOperationLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pipelineState, setPipelineState] = useState<"idle" | "queueing" | "queued" | "error">(
    "idle"
  );
  const activeSessionRef = useRef(activeSession);
  const transportStateRef = useRef<TransportState>(transportState);
  const phaseHistoryRef = useRef<RecorderPhase[]>(["idle"]);
  const operationLogRef = useRef<string[]>([]);
  const evidenceLogRef = useRef<RecorderEvidenceEvent[]>([]);
  const appStateRef = useRef(AppState.currentState ?? "active");
  const backgroundTransitionCountRef = useRef(0);

  const permissionLabel =
    permission == null
      ? "확인 전"
      : permission.granted
        ? "허용"
        : permission.canAskAgain
          ? "다시 요청 가능"
          : "거부됨";

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    transportStateRef.current = transportState;
  }, [transportState]);

  function resolveSelectedInputSelection() {
    return createInputSelection(
      availableInputs.map((input) => ({
        uid: input.uid,
        name: input.label,
        type: input.type
      })),
      selectedInputUid
    );
  }

  function pushLog(message: string) {
    const next = [formatOperationLog(message), ...operationLogRef.current].slice(0, 32);
    operationLogRef.current = next;
    setOperationLog(next);
  }

  function pushEvidence(
    kind: RecorderEvidenceKind,
    message: string,
    overrides?: {
      phase?: RecorderPhase;
      appState?: string;
      input?: RecorderInputSelection | null;
    }
  ) {
    const nextEvent: RecorderEvidenceEvent = {
      at: new Date().toISOString(),
      kind,
      message,
      phase: overrides?.phase ?? phaseHistoryRef.current.at(-1) ?? "idle",
      appState: overrides?.appState ?? appStateRef.current,
      input: overrides?.input ?? resolveSelectedInputSelection()
    };
    evidenceLogRef.current = [nextEvent, ...evidenceLogRef.current].slice(0, 40);
  }

  function transitionPhase(nextPhase: RecorderPhase) {
    if (phaseHistoryRef.current.at(-1) !== nextPhase) {
      phaseHistoryRef.current = [...phaseHistoryRef.current, nextPhase];
    }
    setPhase(nextPhase);
  }

  async function syncRuntimeState(overrides?: {
    session?: SessionRecord;
    transportState?: TransportState;
    phase?: RecorderPhase;
    selectedInput?: RecorderInputSelection | null;
    lastKnownAppState?: string;
    backgroundTransitionCount?: number;
  }) {
    const session = overrides?.session ?? activeSessionRef.current;
    const nextTransportState = overrides?.transportState ?? transportStateRef.current;

    if (session.id === "sess_mobile_preview" && nextTransportState === "idle") {
      return;
    }

    const snapshot: RecorderRuntimeState = {
      session,
      transportState: nextTransportState,
      phase: overrides?.phase ?? phaseHistoryRef.current.at(-1) ?? "idle",
      selectedInput: overrides?.selectedInput ?? resolveSelectedInputSelection(),
      lastKnownAppState: overrides?.lastKnownAppState ?? appStateRef.current,
      backgroundTransitionCount:
        overrides?.backgroundTransitionCount ?? backgroundTransitionCountRef.current,
      updatedAt: new Date().toISOString(),
      operationLog: operationLogRef.current,
      phaseHistory: phaseHistoryRef.current,
      evidenceLog: evidenceLogRef.current
    };

    setRecoverySnapshot(snapshot);

    try {
      await persistRecorderRuntimeState(snapshot);
    } catch (runtimeError) {
      setError(
        runtimeError instanceof Error
          ? runtimeError.message
          : "런타임 복구 상태를 쓰지 못했습니다."
      );
    }
  }

  async function loadLocalLedger() {
    try {
      const entries = await readLocalRecordingLedger();
      setRecentRecordings(entries);
      setLastSavedEntry(entries[0] ?? null);
    } catch (ledgerError) {
      setError(
        ledgerError instanceof Error ? ledgerError.message : "로컬 녹음 목록을 읽지 못했습니다."
      );
    }
  }

  async function loadRuntimeSnapshot() {
    try {
      const runtimeSnapshot = await readRecorderRuntimeState();
      setRecoverySnapshot(runtimeSnapshot);
    } catch (runtimeError) {
      setError(
        runtimeError instanceof Error
          ? runtimeError.message
          : "복구 후보 상태를 읽지 못했습니다."
      );
    }
  }

  async function refreshPermission() {
    try {
      const response = await getRecordingPermissionsAsync();
      setPermission(response);
    } catch (permissionError) {
      setError(
        permissionError instanceof Error
          ? permissionError.message
          : "마이크 권한 상태를 확인하지 못했습니다."
      );
    }
  }

  async function refreshInputs() {
    try {
      await prepareRecorder(
        recorder,
        selectedInputUid,
        setAvailableInputs,
        setSelectedInputUid
      );
    } catch (inputError) {
      setError(
        inputError instanceof Error ? inputError.message : "입력 장치 목록을 불러오지 못했습니다."
      );
    }
  }

  useEffect(() => {
    void refreshPermission();
    void loadLocalLedger();
    void loadRuntimeSnapshot();
    void refreshInputs();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (
        transportStateRef.current !== "recording" &&
        transportStateRef.current !== "paused" &&
        transportStateRef.current !== "saving"
      ) {
        return;
      }

      if (
        (nextState === "background" || nextState === "inactive") &&
        previousState !== nextState
      ) {
        if (nextState === "background") {
          backgroundTransitionCountRef.current += 1;
        }

        transitionPhase("recording_background");
        pushEvidence("app_state", `앱이 ${nextState} 상태로 전환되었습니다.`, {
          phase: "recording_background",
          appState: nextState
        });
        pushLog(`앱이 ${nextState} 상태로 전환되어도 녹음을 유지합니다.`);
        void syncRuntimeState({
          phase: "recording_background",
          lastKnownAppState: nextState
        });
        return;
      }

      if (nextState === "active" && previousState !== "active") {
        transitionPhase("recording_foreground");
        pushEvidence("app_state", "앱이 foreground로 복귀했습니다.", {
          phase: "recording_foreground",
          appState: nextState
        });
        pushLog("앱이 foreground로 복귀했습니다.");
        void syncRuntimeState({
          phase: "recording_foreground",
          lastKnownAppState: nextState
        });
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (transportState !== "idle" || activeSessionRef.current.id !== "sess_mobile_preview") {
      return;
    }

    setActiveSession(
      createPreviewSession({
        title: draftTitle.trim() || "새 회의",
        mode,
        projectKey: draftProjectKey.trim() || "general"
      })
    );
  }, [draftTitle, draftProjectKey, mode, transportState]);

  async function ensurePermissionGranted() {
    const currentPermission = await requestRecordingPermissionsAsync();
    setPermission(currentPermission);

    if (!currentPermission.granted) {
      throw new Error("마이크 권한이 거부되어 녹음을 시작할 수 없습니다.");
    }
  }

  function selectInput(uid: string) {
    setSelectedInputUid(uid);
    const selectedInput = createInputSelection(
      availableInputs.map((input) => ({
        uid: input.uid,
        name: input.label,
        type: input.type
      })),
      uid
    );

    if (selectedInput) {
      pushLog(`입력 장치를 ${selectedInput.label} 로 선택했습니다.`);
      pushEvidence("input_selected", `${selectedInput.label} 입력을 선택했습니다.`, {
        input: selectedInput
      });

      if (transportStateRef.current !== "idle" && transportStateRef.current !== "saved") {
        void syncRuntimeState({ selectedInput });
      }
    }
  }

  async function startRecording() {
    try {
      setError(null);
      setTransportState("idle");
      transportStateRef.current = "idle";
      setPipelineState("idle");
      setRecoverySnapshot(null);
      backgroundTransitionCountRef.current = 0;
      operationLogRef.current = [];
      evidenceLogRef.current = [];
      phaseHistoryRef.current = ["idle", "arming"];
      setPhase("arming");
      pushLog("마이크 권한과 입력 장치를 준비합니다.");
      pushEvidence("permission", "마이크 권한과 입력 장치를 준비합니다.", {
        phase: "arming"
      });

      await ensurePermissionGranted();
      pushEvidence("permission", "마이크 권한이 허용되었습니다.", {
        phase: "arming"
      });
      await configureRecordingMode();
      const inputs = await prepareRecorder(
        recorder,
        selectedInputUid,
        setAvailableInputs,
        setSelectedInputUid
      );
      const selectedInput = createInputSelection(inputs, selectedInputUid);

      if (selectedInput) {
        pushEvidence("input_selected", `${selectedInput.label} 입력을 사용합니다.`, {
          phase: "arming",
          input: selectedInput
        });
      }

      const session = createSessionRecord({
        id: buildSessionId(),
        title: draftTitle.trim() || "새 회의",
        mode,
        projectKey: draftProjectKey.trim() || undefined,
        localAudioPath: `pending://${Date.now()}.m4a`
      });

      setActiveSession(session);
      activeSessionRef.current = session;
      recorder.record();
      setTransportState("recording");
      transportStateRef.current = "recording";
      transitionPhase("recording_foreground");
      pushEvidence("recording_started", "녹음을 시작했습니다.", {
        phase: "recording_foreground",
        input: selectedInput
      });
      pushLog(
        `녹음을 시작했습니다.${selectedInput ? ` 입력 장치: ${selectedInput.label}` : ""}`
      );
      await syncRuntimeState({
        session,
        transportState: "recording",
        phase: "recording_foreground",
        selectedInput,
        backgroundTransitionCount: 0
      });
    } catch (startError) {
      setTransportState("error");
      transportStateRef.current = "error";
      setError(startError instanceof Error ? startError.message : "녹음을 시작하지 못했습니다.");
      transitionPhase("failed");
      pushEvidence("error", "녹음 시작에 실패했습니다.", {
        phase: "failed"
      });
      pushLog("녹음 시작에 실패했습니다.");
    }
  }

  async function pauseRecording() {
    try {
      recorder.pause();
      setTransportState("paused");
      transportStateRef.current = "paused";
      pushEvidence("pause", "녹음을 일시정지했습니다.");
      pushLog("녹음을 일시정지했습니다.");
      await syncRuntimeState({
        transportState: "paused"
      });
    } catch (pauseError) {
      setTransportState("error");
      transportStateRef.current = "error";
      setError(pauseError instanceof Error ? pauseError.message : "일시정지에 실패했습니다.");
    }
  }

  async function resumeRecording() {
    try {
      recorder.record();
      setTransportState("recording");
      transportStateRef.current = "recording";
      transitionPhase("recording_foreground");
      pushEvidence("resume", "녹음을 다시 시작했습니다.", {
        phase: "recording_foreground"
      });
      pushLog("녹음을 다시 시작했습니다.");
      await syncRuntimeState({
        transportState: "recording",
        phase: "recording_foreground"
      });
    } catch (resumeError) {
      setTransportState("error");
      transportStateRef.current = "error";
      setError(resumeError instanceof Error ? resumeError.message : "재시작에 실패했습니다.");
    }
  }

  async function saveRecording() {
    try {
      setError(null);
      setTransportState("saving");
      transportStateRef.current = "saving";
      transitionPhase("chunk_flushing");
      pushLog("로컬 원본 오디오를 영구 저장소로 복사합니다.");

      await recorder.stop();

      const sourceUri = recorder.uri ?? recorderState.url;

      if (!sourceUri) {
        throw new Error("녹음 파일 URI를 찾지 못했습니다.");
      }

      const endedAt = new Date().toISOString();
      const chunkCount = Math.ceil(
        targetRecordingMinutes / activeSessionRef.current.profile.chunkMinutes
      );
      const completedSession: SessionRecord = {
        ...activeSessionRef.current,
        endedAt,
        status: "completed",
        pendingChunkCount: chunkCount
      };

      activeSessionRef.current = completedSession;
      transitionPhase("completed");
      pushEvidence("saved", "로컬 원본 오디오를 보존했습니다.", {
        phase: "completed"
      });
      const entry = await persistLocalRecording({
        sourceUri,
        session: completedSession,
        durationMillis: recorderState.durationMillis,
        phaseHistory: phaseHistoryRef.current,
        operationLog: operationLogRef.current,
        lastKnownAppState: appStateRef.current,
        backgroundTransitionCount: backgroundTransitionCountRef.current,
        selectedInput: resolveSelectedInputSelection(),
        evidenceLog: evidenceLogRef.current
      });

      setTransportState("saved");
      transportStateRef.current = "saved";
      setPipelineState("idle");
      setActiveSession(entry.session);
      setLastSavedEntry(entry);
      setRecentRecordings((current) => [
        entry,
        ...current.filter((item) => item.session.id !== entry.session.id)
      ]);
      pushLog("로컬 녹음을 안전하게 저장했습니다.");
      await clearRecorderRuntimeState();
      setRecoverySnapshot(null);
      await relaxAudioMode();
      await refreshInputs();
    } catch (saveError) {
      setTransportState("error");
      transportStateRef.current = "error";
      transitionPhase("failed");
      setError(saveError instanceof Error ? saveError.message : "로컬 저장에 실패했습니다.");
      pushEvidence("error", "로컬 저장에 실패했습니다.", {
        phase: "failed"
      });
      pushLog("로컬 저장에 실패했습니다.");
      await syncRuntimeState({
        transportState: "error",
        phase: "failed"
      });
    }
  }

  async function discardRecording() {
    try {
      if (recorderState.isRecording || transportState === "paused") {
        await recorder.stop();
      }

      const sourceUri = recorder.uri ?? recorderState.url;

      if (sourceUri) {
        await FileSystem.deleteAsync(sourceUri, { idempotent: true });
      }

      pushEvidence("discarded", "임시 녹음을 폐기했습니다.", {
        phase: "idle"
      });
      await clearRecorderRuntimeState();
      setRecoverySnapshot(null);
      await relaxAudioMode();
      setTransportState("idle");
      transportStateRef.current = "idle";
      setPipelineState("idle");
      setError(null);
      setActiveSession(
        createPreviewSession({
          title: draftTitle.trim() || "새 회의",
          mode,
          projectKey: draftProjectKey.trim() || "general"
        })
      );
      phaseHistoryRef.current = ["idle"];
      evidenceLogRef.current = [];
      backgroundTransitionCountRef.current = 0;
      setPhase("idle");
      pushLog("임시 녹음을 폐기했습니다.");
      await refreshInputs();
    } catch (discardError) {
      setTransportState("error");
      transportStateRef.current = "error";
      setError(discardError instanceof Error ? discardError.message : "녹음 폐기에 실패했습니다.");
    }
  }

  async function queueLocalRecording() {
    const targetEntry = lastSavedEntry;

    if (!targetEntry) {
      setError("먼저 로컬 저장을 마쳐야 업로드 큐에 넣을 수 있습니다.");
      return;
    }

    try {
      setError(null);
      setPipelineState("queueing");
      pushEvidence("queue_requested", "저장된 원본 오디오를 서버 업로드 큐에 넣습니다.", {
        phase: "completed",
        input: targetEntry.selectedInput
      });
      pushLog("서버 세션을 만들고 Soniox 업로드를 시작합니다.");
      const serverSession = await createMobileProcessingSession({
        title: targetEntry.session.title,
        mode: targetEntry.session.mode,
        projectKey: targetEntry.session.projectKey
      });
      const fileName =
        targetEntry.session.localAudioPath.split("/").pop() ?? `${serverSession.id}.m4a`;
      const upload = await uploadMobileSourceAudio({
        sessionId: serverSession.id,
        fileUri: targetEntry.session.localAudioPath,
        fileName
      });

      await enqueueSessionFromFileId({
        sessionId: serverSession.id,
        fileId: upload.fileId
      });

      const updatedEntries = await updateLocalRecordingLedgerEntry({
        sessionId: targetEntry.session.id,
        patch: {
          uploadState: "queued",
          remoteSessionId: serverSession.id,
          remoteFileId: upload.fileId,
          uploadQueuedAt: new Date().toISOString()
        }
      });

      setRecentRecordings(updatedEntries);
      setLastSavedEntry(
        updatedEntries.find((entry) => entry.session.id === targetEntry.session.id) ?? targetEntry
      );
      setPipelineState("queued");
      pushEvidence("queue_accepted", `서버 세션 ${serverSession.id} 를 큐에 넣었습니다.`, {
        phase: "completed",
        input: targetEntry.selectedInput
      });
      pushLog(`서버 세션 ${serverSession.id} 를 큐에 넣었습니다.`);
    } catch (queueError) {
      setPipelineState("error");
      setError(queueError instanceof Error ? queueError.message : "업로드 큐 등록에 실패했습니다.");
      pushEvidence("queue_failed", "업로드 큐 등록에 실패했습니다.", {
        phase: "failed",
        input: targetEntry.selectedInput
      });
      pushLog("업로드 큐 등록에 실패했습니다.");
    }
  }

  const recorderSnapshot = buildRecorderDomainSnapshot({
    phase,
    session: activeSession,
    targetDurationMinutes: targetRecordingMinutes
  });
  const runtimeSummarySource =
    recoverySnapshot != null
      ? recoverySnapshot
      : {
          backgroundTransitionCount:
            lastSavedEntry?.backgroundTransitionCount ?? backgroundTransitionCountRef.current,
          lastKnownAppState:
            lastSavedEntry?.lastKnownAppState ?? appStateRef.current,
          selectedInput:
            lastSavedEntry?.selectedInput ?? resolveSelectedInputSelection(),
          evidenceLog: lastSavedEntry?.evidenceLog ?? evidenceLogRef.current
        };
  const survivalSummary = buildRecorderSurvivalSummary(runtimeSummarySource);

  return {
    draftTitle,
    setDraftTitle,
    draftProjectKey,
    setDraftProjectKey,
    mode,
    setMode,
    permission,
    permissionLabel,
    transportState,
    phase,
    recorderState,
    recorderSnapshot,
    activeSession,
    availableInputs,
    selectedInputUid,
    selectInput,
    refreshInputs,
    recentRecordings,
    lastSavedEntry,
    recoverySnapshot,
    survivalSummary,
    operationLog,
    error,
    pipelineState,
    recorderRootPath: getRecorderRootPath(),
    runtimeStatePath: getRecorderRuntimeStatePath(),
    lastKnownAppState: runtimeSummarySource.lastKnownAppState,
    backgroundTransitionCount: runtimeSummarySource.backgroundTransitionCount,
    canStart: transportState === "idle" || transportState === "saved",
    canPause: transportState === "recording",
    canResume: transportState === "paused",
    canSave: transportState === "recording" || transportState === "paused",
    canDiscard:
      transportState === "recording" ||
      transportState === "paused" ||
      transportState === "saved" ||
      transportState === "error",
    canQueueUpload: transportState === "saved" && lastSavedEntry?.uploadState !== "queued",
    estimatedTwoHourSizeMb: twoHourEstimateMb,
    startRecording,
    pauseRecording,
    resumeRecording,
    saveRecording,
    discardRecording,
    queueLocalRecording
  };
}
