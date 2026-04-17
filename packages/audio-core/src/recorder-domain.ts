import {
  buildRollingChunkPlan,
  createSessionRecord,
  deriveOperationalChecklist,
  type SessionMode,
  type SessionRecord,
  type SessionStatus
} from "./session-core";

export const recorderPhases = [
  "idle",
  "arming",
  "recording_foreground",
  "recording_background",
  "chunk_flushing",
  "uploading",
  "awaiting_transcript",
  "summarizing",
  "emailing",
  "completed",
  "failed"
] as const;

export type RecorderPhase = (typeof recorderPhases)[number];
export type RecorderSurface = "foreground" | "background" | "handoff" | "review";

export interface RecorderMachineState {
  phase: RecorderPhase;
  surface: RecorderSurface;
  canRecord: boolean;
  canUpload: boolean;
  canContinueBackground: boolean;
  nextPhase: RecorderPhase;
  label: string;
  description: string;
}

export interface UploadQueueItem {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  estimatedSizeMb: number;
  status: "queued" | "uploading" | "uploaded" | "failed";
  attempts: number;
}

export const recorderEvidenceKinds = [
  "permission",
  "input_selected",
  "recording_started",
  "app_state",
  "pause",
  "resume",
  "saved",
  "queue_requested",
  "queue_accepted",
  "queue_failed",
  "discarded",
  "error"
] as const;

export type RecorderEvidenceKind = (typeof recorderEvidenceKinds)[number];

export interface RecorderInputSelection {
  uid: string;
  label: string;
  type: string;
}

export interface RecorderEvidenceEvent {
  at: string;
  kind: RecorderEvidenceKind;
  message: string;
  phase: RecorderPhase;
  appState?: string;
  input?: RecorderInputSelection | null;
}

export interface RecorderRuntimeState {
  session: SessionRecord;
  transportState: "idle" | "recording" | "paused" | "saving" | "saved" | "error";
  phase: RecorderPhase;
  selectedInput: RecorderInputSelection | null;
  lastKnownAppState: string;
  backgroundTransitionCount: number;
  updatedAt: string;
  operationLog: string[];
  phaseHistory: RecorderPhase[];
  evidenceLog: RecorderEvidenceEvent[];
}

export interface RecorderSurvivalSummary {
  headline: string;
  detail: string;
  backgroundTransitionCount: number;
  lastKnownAppState: string;
  selectedInputLabel: string;
  recentEvidence: string[];
  requiresRealDeviceProof: boolean;
}

export interface PlatformExpectation {
  platform: "ios" | "android" | "desktop";
  headline: string;
  requiredCapabilities: string[];
  operationalNotes: string[];
}

export interface NativeScaffoldFile {
  path: string;
  purpose: string;
  requiredEntries: string[];
}

export interface RecorderDomainSnapshot {
  session: SessionRecord;
  machine: RecorderMachineState;
  uploadQueue: UploadQueueItem[];
  chunkPlan: Array<{ index: number; startMs: number; endMs: number }>;
  checklist: string[];
  platformExpectations: PlatformExpectation[];
  nativeScaffolds: NativeScaffoldFile[];
  progressSummary: string[];
  readyToShip: boolean;
}

const phaseMeta: Record<
  RecorderPhase,
  {
    surface: RecorderSurface;
    canRecord: boolean;
    canUpload: boolean;
    canContinueBackground: boolean;
    label: string;
    description: string;
  }
> = {
  idle: {
    surface: "foreground",
    canRecord: false,
    canUpload: false,
    canContinueBackground: false,
    label: "Idle",
    description: "앱이 세션을 기다리는 초기 상태입니다."
  },
  arming: {
    surface: "foreground",
    canRecord: false,
    canUpload: false,
    canContinueBackground: false,
    label: "Arming",
    description: "마이크 권한과 background capture 조건을 준비합니다."
  },
  recording_foreground: {
    surface: "foreground",
    canRecord: true,
    canUpload: false,
    canContinueBackground: true,
    label: "Recording foreground",
    description: "앱이 보이는 상태에서 원본 오디오를 로컬에 저장합니다."
  },
  recording_background: {
    surface: "background",
    canRecord: true,
    canUpload: false,
    canContinueBackground: true,
    label: "Recording background",
    description: "화면이 꺼져도 녹음이 유지되는 실제 제품 핵심 구간입니다."
  },
  chunk_flushing: {
    surface: "handoff",
    canRecord: true,
    canUpload: true,
    canContinueBackground: true,
    label: "Chunk flushing",
    description: "롤링 chunk를 닫고 해시를 계산한 뒤 업로드 대기열에 넣습니다."
  },
  uploading: {
    surface: "handoff",
    canRecord: true,
    canUpload: true,
    canContinueBackground: true,
    label: "Uploading",
    description: "로컬 원본과 chunk를 서버로 전송하고 재시도를 관리합니다."
  },
  awaiting_transcript: {
    surface: "handoff",
    canRecord: false,
    canUpload: true,
    canContinueBackground: false,
    label: "Awaiting transcript",
    description: "Soniox async transcript를 기다리는 상태입니다."
  },
  summarizing: {
    surface: "review",
    canRecord: false,
    canUpload: false,
    canContinueBackground: false,
    label: "Summarizing",
    description: "전사본을 구조화된 회의록으로 바꾸는 단계입니다."
  },
  emailing: {
    surface: "review",
    canRecord: false,
    canUpload: false,
    canContinueBackground: false,
    label: "Emailing",
    description: "메일 발송과 포털 링크 확인 단계입니다."
  },
  completed: {
    surface: "review",
    canRecord: false,
    canUpload: false,
    canContinueBackground: false,
    label: "Completed",
    description: "세션 산출물이 모두 정리된 상태입니다."
  },
  failed: {
    surface: "review",
    canRecord: false,
    canUpload: false,
    canContinueBackground: false,
    label: "Failed",
    description: "업로드, 전사, 요약, 메일 중 하나에서 복구가 필요한 상태입니다."
  }
};

const platformExpectations: PlatformExpectation[] = [
  {
    platform: "ios",
    headline: "UIBackgroundModes audio",
    requiredCapabilities: [
      "Microphone permission prompt",
      "Background audio enabled",
      "Local audio file persistence",
      "Background URLSession upload handoff"
    ],
    operationalNotes: [
      "화면이 꺼져도 녹음이 끊기지 않아야 합니다.",
      "잠금 상태에서 chunk flush와 upload queue가 살아 있어야 합니다."
    ]
  },
  {
    platform: "android",
    headline: "Foreground service microphone",
    requiredCapabilities: [
      "RECORD_AUDIO permission",
      "FOREGROUND_SERVICE_MICROPHONE service type",
      "Wake lock / battery optimization awareness",
      "Chunk rotation while service stays active"
    ],
    operationalNotes: [
      "서비스는 foreground에서 시작해 background capture를 이어가야 합니다.",
      "재부팅 또는 앱 복귀 후 마지막 chunk와 큐 상태를 재구성해야 합니다."
    ]
  },
  {
    platform: "desktop",
    headline: "Desktop shell recorder adapter",
    requiredCapabilities: [
      "App lifetime longer than browser tab",
      "Local file persistence before upload",
      "OS sleep / lid-close policy handling",
      "Recorder adapter shared with portal shell"
    ],
    operationalNotes: [
      "데스크톱 셸은 포털 launcher를 넘어 recorder adapter를 붙일 준비가 필요합니다.",
      "OS 절전 또는 덮개 닫힘 정책은 별도 전원 관리 레인으로 점검해야 합니다."
    ]
  }
];

const nativeScaffolds: NativeScaffoldFile[] = [
  {
    path: "native/ios/Info.plist.scaffold.plist",
    purpose: "iOS background audio and microphone manifest expectations",
    requiredEntries: ["UIBackgroundModes", "NSMicrophoneUsageDescription"]
  },
  {
    path: "native/android/AndroidManifest.scaffold.xml",
    purpose: "Android microphone foreground service expectations",
    requiredEntries: ["RECORD_AUDIO", "FOREGROUND_SERVICE_MICROPHONE", "WAKE_LOCK"]
  },
  {
    path: "desktop/src-tauri/src/lib.rs",
    purpose: "Desktop recorder-capable Tauri shell integration point",
    requiredEntries: ["recorder adapter command", "power assertion / keep awake plan"]
  }
];

const phaseOrder = recorderPhases;

function phaseIndex(phase: RecorderPhase): number {
  return phaseOrder.indexOf(phase);
}

export function nextRecorderPhase(phase: RecorderPhase): RecorderPhase {
  const current = phaseIndex(phase);
  return phaseOrder[(current + 1) % phaseOrder.length] ?? "idle";
}

export function phaseToSessionStatus(phase: RecorderPhase): SessionStatus {
  switch (phase) {
    case "idle":
    case "arming":
      return "draft";
    case "recording_foreground":
    case "recording_background":
      return "recording";
    case "chunk_flushing":
    case "uploading":
      return "uploading";
    case "awaiting_transcript":
      return "transcribing";
    case "summarizing":
      return "summarizing";
    case "emailing":
      return "emailing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

export function buildRecorderMachineState(phase: RecorderPhase): RecorderMachineState {
  const meta = phaseMeta[phase];
  return {
    phase,
    surface: meta.surface,
    canRecord: meta.canRecord,
    canUpload: meta.canUpload,
    canContinueBackground: meta.canContinueBackground,
    nextPhase: nextRecorderPhase(phase),
    label: meta.label,
    description: meta.description
  };
}

export function buildUploadQueue(
  chunkPlan: Array<{ index: number; startMs: number; endMs: number }>,
  phase: RecorderPhase
): UploadQueueItem[] {
  return chunkPlan.map((chunk, index) => {
    const isActiveUpload = phase === "uploading" && index === 0;
    const isCompleted =
      phase === "summarizing" || phase === "emailing" || phase === "completed";
    const isFailed = phase === "failed";

    return {
      id: `chunk-${chunk.index}`,
      label: `chunk-${chunk.index.toString().padStart(2, "0")}`,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      estimatedSizeMb: Math.max(4, Math.round(((chunk.endMs - chunk.startMs) / 60_000) * 8)),
      status: isFailed ? "failed" : isActiveUpload ? "uploading" : isCompleted ? "uploaded" : "queued",
      attempts: isActiveUpload || isCompleted || index === 0 ? 1 : 0
    };
  });
}

export function createMobileRecorderSession(mode: SessionMode = "meeting") {
  return createSessionRecord({
    id: `sess_mobile_${mode}`,
    title: "APAC weekly sync",
    mode,
    projectKey: "apac"
  });
}

export function buildRecorderSurvivalSummary(
  runtimeState: Pick<
    RecorderRuntimeState,
    "backgroundTransitionCount" | "lastKnownAppState" | "selectedInput" | "evidenceLog"
  > | null
): RecorderSurvivalSummary {
  const backgroundTransitionCount = runtimeState?.backgroundTransitionCount ?? 0;
  const selectedInputLabel = runtimeState?.selectedInput?.label ?? "기본 마이크";
  const recentEvidence = runtimeState?.evidenceLog.slice(0, 3).map((event) => event.message) ?? [];

  if (backgroundTransitionCount > 0) {
    return {
      headline: "백그라운드 전환 흔적이 남았습니다.",
      detail:
        "앱 상태 전환은 기록됐지만, 출시는 잠금 화면 120분 실기기 증거가 확보될 때만 가능합니다.",
      backgroundTransitionCount,
      lastKnownAppState: runtimeState?.lastKnownAppState ?? "active",
      selectedInputLabel,
      recentEvidence,
      requiresRealDeviceProof: true
    };
  }

  return {
    headline: "아직 잠금 화면 생존 증거가 부족합니다.",
    detail:
      "녹음 중 background 진입과 복귀 흔적을 남기고, 120분 잠금 화면 검증을 별도로 확보해야 합니다.",
    backgroundTransitionCount,
    lastKnownAppState: runtimeState?.lastKnownAppState ?? "active",
    selectedInputLabel,
    recentEvidence,
    requiresRealDeviceProof: true
  };
}

export function buildRecorderDomainSnapshot(input: {
  phase: RecorderPhase;
  session: SessionRecord;
  targetDurationMinutes?: number;
}): RecorderDomainSnapshot {
  const session = {
    ...input.session,
    status: phaseToSessionStatus(input.phase)
  };
  const targetDurationMinutes = input.targetDurationMinutes ?? 120;
  const chunkPlan = buildRollingChunkPlan(targetDurationMinutes, session.profile.chunkMinutes);
  const uploadQueue = buildUploadQueue(chunkPlan, input.phase);
  const machine = buildRecorderMachineState(input.phase);
  const checklist = deriveOperationalChecklist(session);
  const readyToShip =
    input.phase === "completed" &&
    uploadQueue.every((item) => item.status === "uploaded") &&
    checklist.length > 0;

  return {
    session,
    machine,
    uploadQueue,
    chunkPlan,
    checklist,
    platformExpectations,
    nativeScaffolds,
    progressSummary: [
      `Background capable: ${machine.canContinueBackground ? "yes" : "no"}`,
      `Upload queue depth: ${uploadQueue.filter((item) => item.status !== "uploaded").length}`,
      `Target duration: ${targetDurationMinutes}m`,
      `Next phase: ${machine.nextPhase}`
    ],
    readyToShip
  };
}
