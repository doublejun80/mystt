"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

import {
  resolveGeneratedSessionTitleFromNotes,
  type SessionMode,
  type SessionStatus
} from "@mystt/audio-core";
import { modeLabels } from "@mystt/ui-kit";
import {
  RealtimeUtteranceBuffer,
  type RealtimeResult,
  type RealtimeToken,
  type SttSessionConfig,
  SonioxClient,
  segmentRealtimeTokens
} from "@soniox/client";

import {
  createPortalSession,
  failPortalSession,
  getSessionSourceAudioHref,
  getSessionSourceAudioPreviewHref,
  type MeetingNotesV2Record,
  type SessionNotesRecord,
  probeSonioxTempKey,
  previewSessionNotes,
  transcribeRealtimeCaptionChunk,
  updatePortalSessionTitle
} from "../lib/api";
import { resolveDesktopDownloadUrl } from "../lib/desktop-download";
import { finalizePortalRecording } from "../lib/finalize-portal-recording";
import { formatDurationClock } from "../lib/format";
import {
  buildPreferredRecordingUpload,
  buildDesktopDownloadFileName,
  buildRecordingFileName,
  shouldArchivePcmWavForUpload,
  shouldUseInlineAudioPreview
} from "../lib/recording-audio";
import { encodePcmWavBlobToMp3 } from "../lib/mp3-encoder";
import {
  cleanUserFacingText,
  splitUserFacingStoryParagraphs,
  splitUserFacingParagraphs
} from "../lib/user-facing-text";
import {
  appendLiveRecordingChunk,
  discardLiveRecordingArchive,
  finalizeLiveRecordingArchive,
  listRecoverableLiveRecordingArchives,
  prepareLiveRecordingArchive,
  setLiveRecordingArchiveMimeType,
  type RecoverableLiveRecordingArchive
} from "../lib/live-recording-archive";
import {
  PcmMicrophoneSource,
  supportsPcmMicrophoneSource
} from "../lib/pcm-microphone-source";
import {
  defaultRecorderPreferences,
  type RecorderPreferences
} from "../lib/recorder-settings";
import {
  canUseTranscriptForPreview,
  buildModeAdjustedRecorderPreferences,
  buildRecoverableArchiveStatusText,
  buildSegmentTranslationText,
  getRetiredAudioObjectUrls,
  getTranscriptGroupBy,
  getUniqueAudioObjectUrls,
  normalizeRealtimeTokenText,
  selectAutoRecoverableArchive,
  shouldAllowRecoverableArchiveUpload,
  shouldPersistStoppedRecording,
  splitRealtimeTokens,
  type AudioObjectUrlState
} from "../lib/live-recorder-behavior";
import {
  buildIOSFocusShortcutLaunchUrl,
  canRunIOSFocusShortcutAction,
  getIOSFocusShortcutBrowserSupport,
  iosFocusStartShortcutName,
  iosFocusStopShortcutName,
  isLikelyIOSDevice,
  type IOSFocusShortcutBrowserSupport
} from "../lib/ios-focus-shortcuts";

type RecorderPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "saving"
  | "processing"
  | "saved"
  | "error";

type CaptionSource = "soniox" | "openai" | "browser" | "none";
type WorkspaceView = "live" | "summary" | "transcript";

type TranscriptLine = {
  id: string;
  text: string;
  translationText?: string | null;
  speaker?: string | null;
  language?: string | null;
  tokens: RealtimeToken[];
  kind: "committed" | "live";
  source: CaptionSource;
};

type AudioInputDeviceOption = {
  deviceId: string;
  label: string;
  isVirtual: boolean;
};

type SummaryPreviewState = {
  model: string;
  notes: SessionNotesRecord;
};

function isMeetingNotesV2(notes: SessionNotesRecord): notes is MeetingNotesV2Record {
  return (
    notes.mode === "meeting" &&
    "schemaVersion" in notes &&
    notes.schemaVersion === "meeting_notes_v2"
  );
}

function getMeetingTopicReportSections(notes: MeetingNotesV2Record) {
  return (
    notes.topicTimeline?.map((item) => ({
      id: item.timelineId,
      title: cleanUserFacingText(item.title),
      discussion: cleanUserFacingText(item.discussion),
      outcome: cleanUserFacingText(item.outcome)
    })) ??
    notes.topicSummaries.map((topic) => ({
      id: topic.topicId,
      title: cleanUserFacingText(topic.title),
      discussion: cleanUserFacingText(topic.summaryBullets.join(" ")),
      outcome: null
    }))
  );
}

type ModeUiProfile = {
  titlePlaceholder: string;
  projectPlaceholder: string;
  idleMessage: string;
  liveTitle: string;
  liveCopy: string;
  liveEmpty: string;
  summaryTabLabel: string;
  summaryHeaderLabel: string;
  summaryEmpty: string;
  summaryActionLabel: string;
  transcriptTabLabel: string;
  transcriptHeaderLabel: string;
  transcriptCopy: string;
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

const sessionModes: SessionMode[] = ["meeting", "speech", "interview"];
const realtimeModel = "stt-rt-v4";
const openAIFallbackFlushMs = 2800;
const openAIFallbackCommandFlushTimeoutMs = 1200;
const archiveRecorderFlushMs = 4000;
const iosFocusShortcutStorageKey = "mystt.iosFocusShortcuts.enabled";

const modeUiProfiles: Record<SessionMode, ModeUiProfile> = {
  meeting: {
    titlePlaceholder: "예: 주간 기획 회의",
    projectPlaceholder: "예: Q3 GTM",
    idleMessage: "회의를 시작하면 이 영역에 대화가 실시간으로 차곡차곡 쌓입니다.",
    liveTitle: "실시간 회의 자막",
    liveCopy: "회의 흐름을 끊지 않으면서 결정과 할 일을 정리하기 좋게 기록합니다.",
    liveEmpty: "녹음을 시작하면 대화가 아래로 계속 쌓이고, 말한 순서대로 남습니다.",
    summaryTabLabel: "회의 요약",
    summaryHeaderLabel: "회의 요약",
    summaryEmpty: "요약을 누르면 결정, 할 일, 열린 질문을 이 큰 영역에서 바로 검토합니다.",
    summaryActionLabel: "회의 요약",
    transcriptTabLabel: "대화 수정",
    transcriptHeaderLabel: "대화 수정",
    transcriptCopy: "회의 원문을 바로 고치고, 수정본 기준으로 회의 요약을 다시 만들 수 있습니다."
  },
  speech: {
    titlePlaceholder: "예: 분기 타운홀 발표",
    projectPlaceholder: "예: Investor day",
    idleMessage: "발표를 시작하면 긴 문장 흐름까지 끊지 않고 자막으로 쌓습니다.",
    liveTitle: "실시간 발표 캡처",
    liveCopy: "한 명이 길게 말해도 흐름을 살리고, 핵심 메시지와 인용 문장을 뽑기 쉽게 잡습니다.",
    liveEmpty: "녹음을 시작하면 발표 흐름이 문단처럼 쌓이고, 긴 멈춤도 덜 잘립니다.",
    summaryTabLabel: "발표 정리",
    summaryHeaderLabel: "발표 정리",
    summaryEmpty: "정리를 누르면 핵심 메시지와 인용 문장을 이 큰 영역에서 바로 검토합니다.",
    summaryActionLabel: "발표 정리",
    transcriptTabLabel: "발표 원문",
    transcriptHeaderLabel: "발표 원문",
    transcriptCopy: "발표 원문을 다듬은 뒤 핵심 메시지와 인용 문장을 다시 정리할 수 있습니다."
  },
  interview: {
    titlePlaceholder: "예: 사용자 인터뷰 07",
    projectPlaceholder: "예: onboarding research",
    idleMessage: "인터뷰를 시작하면 질문과 답변이 섞이지 않게 자막이 순서대로 쌓입니다.",
    liveTitle: "실시간 인터뷰 기록",
    liveCopy: "질문과 답변을 나눠 보면서 핵심 인사이트와 후속 질문을 찾기 쉽게 기록합니다.",
    liveEmpty: "녹음을 시작하면 질문과 답변이 아래로 차곡차곡 쌓이고, 화자 구분이 우선 적용됩니다.",
    summaryTabLabel: "인터뷰 정리",
    summaryHeaderLabel: "인터뷰 정리",
    summaryEmpty: "정리를 누르면 핵심 인사이트와 후속 질문을 이 큰 영역에서 바로 검토합니다.",
    summaryActionLabel: "인터뷰 정리",
    transcriptTabLabel: "질문·답변 수정",
    transcriptHeaderLabel: "질문·답변 수정",
    transcriptCopy: "질문과 답변 문장을 바로 고친 뒤 인터뷰 정리를 다시 만들 수 있습니다."
  }
};

function getPortalProcessingMessage(status: SessionStatus) {
  switch (status) {
    case "transcribing":
      return "원본 음성은 저장했고 Soniox async 최종 전사를 만드는 중입니다. 긴 녹음은 수분 단위로 걸릴 수 있고 완료되면 최근 기록이 자동 갱신됩니다.";
    case "summarizing":
      return "원본 음성은 저장했고 최종 전사 기준으로 요약 노트를 만드는 중입니다.";
    case "emailing":
      return "원본 음성, 전사, 요약 노트를 저장했고 후처리를 마무리하는 중입니다.";
    default:
      return "원본 음성은 저장했고 최종 전사/노트 생성 파이프라인이 계속 진행 중입니다.";
  }
}

function isVirtualInputDeviceLabel(label: string) {
  return /jump desktop|virtual|loopback|blackhole|obs|zoomaudio|vb-audio|cable output/i.test(
    label
  );
}

function scoreAudioInputDevice(device: AudioInputDeviceOption) {
  const label = device.label.toLowerCase();
  let score = 0;

  if (label.includes("airpods")) {
    score += 400;
  }

  if (/(earbuds|buds|headset|headphone|bluetooth)/i.test(label)) {
    score += 250;
  }

  if (/(microphone|mic)/i.test(label)) {
    score += 100;
  }

  if (label.includes("macbook") || label.includes("built-in")) {
    score += 50;
  }

  if (device.deviceId === "default") {
    score -= 20;
  }

  if (device.isVirtual) {
    score -= 500;
  }

  return score;
}

function choosePreferredAudioInput(devices: AudioInputDeviceOption[]) {
  return [...devices].sort((left, right) => {
    const scoreDiff = scoreAudioInputDevice(right) - scoreAudioInputDevice(left);

    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return left.label.localeCompare(right.label, "ko");
  })[0];
}

function choosePreferredConcreteAudioInput(devices: AudioInputDeviceOption[]) {
  const nonDefault = devices.filter((device) => device.deviceId !== "default");
  const nonVirtual = nonDefault.filter((device) => !device.isVirtual);

  if (nonVirtual.length > 0) {
    return choosePreferredAudioInput(nonVirtual);
  }

  if (nonDefault.length > 0) {
    return choosePreferredAudioInput(nonDefault);
  }

  return choosePreferredAudioInput(devices);
}

function resolveCaptureInput(
  devices: AudioInputDeviceOption[],
  selectedDeviceId: string
) {
  const selected = devices.find((device) => device.deviceId === selectedDeviceId);

  if (selected && selected.deviceId !== "default" && !selected.isVirtual) {
    return selected;
  }

  const preferredConcrete = choosePreferredConcreteAudioInput(devices);

  if (preferredConcrete) {
    return preferredConcrete;
  }

  return selected ?? choosePreferredAudioInput(devices);
}

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  const recognitionWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

  return (
    recognitionWindow.SpeechRecognition ??
    recognitionWindow.webkitSpeechRecognition ??
    null
  );
}

function buildTranscriptText(lines: TranscriptLine[]) {
  return lines
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTranscriptLineSignature(line: TranscriptLine) {
  const range = getLineRange(line);

  return [
    line.source,
    line.speaker ?? "",
    line.language ?? "",
    range?.startMs ?? "na",
    range?.endMs ?? "na",
    line.text
  ].join("|");
}

function supportsRealtimeCaption() {
  return supportsPcmMicrophoneSource();
}

function supportsBrowserCaption() {
  return Boolean(getSpeechRecognitionConstructor());
}

function supportsArchiveRecorder() {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined";
}

function getPreferredArchiveMimeType() {
  if (!supportsArchiveRecorder()) {
    return null;
  }

  const prefersAppleFriendlyArchive =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

  const candidates = prefersAppleFriendlyArchive
    ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

  for (const candidate of candidates) {
    if (typeof MediaRecorder.isTypeSupported !== "function") {
      return candidate;
    }

    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

function canPreviewAudioMimeType(mimeType: string) {
  if (!mimeType || typeof document === "undefined") {
    return false;
  }

  const audio = document.createElement("audio");
  return audio.canPlayType(mimeType).replace("no", "").trim().length > 0;
}

function resolveBrowserAudioDurationMs(blob: Blob) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return Promise.resolve<number | null>(null);
  }

  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement("audio");
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 2_000);

    function cleanup() {
      window.clearTimeout(timeout);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    }

    audio.preload = "metadata";
    audio.addEventListener(
      "loadedmetadata",
      () => {
        const durationMs =
          Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration * 1000
            : null;
        cleanup();
        resolve(durationMs);
      },
      { once: true }
    );
    audio.addEventListener(
      "error",
      () => {
        cleanup();
        resolve(null);
      },
      { once: true }
    );
    audio.src = url;
  });
}

async function getMicrophonePermissionState() {
  if (typeof navigator === "undefined") {
    return "확인 불가";
  }

  const permissions = navigator.permissions;

  if (!permissions?.query) {
    return "브라우저 확인 필요";
  }

  try {
    const result = await permissions.query({
      name: "microphone" as PermissionName
    });

    switch (result.state) {
      case "granted":
        return "허용";
      case "denied":
        return "차단";
      case "prompt":
        return "대기";
      default:
        return "확인 불가";
    }
  } catch {
    return "브라우저 확인 필요";
  }
}

function toTranscriptLine(
  tokens: RealtimeToken[],
  kind: TranscriptLine["kind"],
  idSuffix: string,
  source: CaptionSource,
  translationText?: string | null
): TranscriptLine | null {
  const text = normalizeRealtimeTokenText(tokens);

  if (!text) {
    return null;
  }

  return {
    id: `${idSuffix}-${Math.random().toString(36).slice(2, 9)}`,
    text,
    translationText: translationText?.trim() || null,
    speaker: tokens[0]?.speaker ?? null,
    language: tokens[0]?.language ?? null,
    tokens,
    kind,
    source
  };
}

function createBrowserTranscriptLine(
  text: string,
  kind: TranscriptLine["kind"]
): TranscriptLine | null {
  return createFallbackTranscriptLine(text, kind, "browser");
}

function createFallbackTranscriptLine(
  text: string,
  kind: TranscriptLine["kind"],
  source: Extract<CaptionSource, "openai" | "browser">
): TranscriptLine | null {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  return {
    id: `browser-${kind}-${Math.random().toString(36).slice(2, 9)}`,
    text: normalized,
    speaker: null,
    language: "ko",
    tokens: [],
    kind,
    source
  };
}

function createManualTranscriptLine(text: string): TranscriptLine | null {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  return {
    id: "manual-transcript",
    text: normalized,
    speaker: null,
    language: "ko",
    tokens: [],
    kind: "committed",
    source: "soniox"
  };
}

function formatCaptionSourceLabel(source: CaptionSource) {
  switch (source) {
    case "soniox":
      return "Soniox";
    case "openai":
      return "OpenAI 보조";
    case "browser":
      return "브라우저 보조";
    default:
      return "없음";
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

function getLineRange(line: TranscriptLine) {
  const timedTokens = line.tokens.filter(
    (token) =>
      typeof token.start_ms === "number" && typeof token.end_ms === "number"
  );

  if (timedTokens.length === 0) {
    return null;
  }

  return {
    startMs: timedTokens[0]?.start_ms ?? 0,
    endMs: timedTokens[timedTokens.length - 1]?.end_ms ?? 0
  };
}

function buildJumpLabel(startMs: number, endMs: number) {
  const start = formatDurationClock(Math.floor(startMs / 1000));
  const end = formatDurationClock(Math.floor(endMs / 1000));
  return `${start} - ${end}`;
}

function parseContextTerms(raw: string) {
  return [...new Set(
    raw
      .split(/[\n,]/)
      .map((term) => term.trim())
      .filter(Boolean)
  )].slice(0, 64);
}

function buildContextTerms(
  preferences: RecorderPreferences,
  title: string,
  projectKey: string,
  mode: SessionMode
) {
  return [...new Set(
    [
      "mystt",
      title.trim(),
      projectKey.trim(),
      modeLabels[mode],
      ...parseContextTerms(preferences.contextTermsText)
    ].filter(Boolean)
  )];
}

function isTauriShell() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window ||
      new URLSearchParams(window.location.search).get("desktop_shell") === "1")
  );
}

function shouldPreferStableBrowserAudioBlob() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent;
  const platform = navigator.platform;

  return (
    /Android|Mobile|Whale|CriOS|FxiOS|EdgiOS|iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    navigator.maxTouchPoints > 1
  );
}

function toRealtimeConfig(
  liveSessionId: string,
  mode: SessionMode,
  title: string,
  projectKey: string,
  preferences: RecorderPreferences,
  sampleRate: number
): SttSessionConfig {
  const contextTerms = buildContextTerms(preferences, title, projectKey, mode);

  return {
    model: realtimeModel,
    audio_format: "pcm_s16le",
    sample_rate: sampleRate,
    num_channels: 1,
    client_reference_id: liveSessionId,
    language_hints: preferences.enableMixedLanguage ? ["ko", "en"] : ["ko"],
    language_hints_strict: !preferences.enableMixedLanguage,
    enable_speaker_diarization: preferences.enableSpeakerDiarization,
    enable_language_identification: preferences.enableMixedLanguage,
    enable_endpoint_detection: true,
    max_endpoint_delay_ms: preferences.endpointDelayMs,
    context: {
      general: [
        { key: "product", value: "mystt" },
        { key: "mode", value: mode },
        ...(projectKey.trim()
          ? [{ key: "project", value: projectKey.trim() }]
          : [])
      ],
      terms: contextTerms
    },
    ...(preferences.enableLiveTranslation
      ? {
          translation: {
            type: "one_way" as const,
            target_language: "ko"
          }
        }
      : {})
  };
}

export function LiveRecorder({
  preferences = defaultRecorderPreferences,
  onSaved
}: {
  preferences?: RecorderPreferences;
  onSaved?: (sessionId: string) => void;
}) {
  const initialModeProfile = modeUiProfiles.meeting;
  const [title, setTitle] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [mode, setMode] = useState<SessionMode>("meeting");
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [message, setMessage] = useState(
    initialModeProfile.idleMessage
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [liveLines, setLiveLines] = useState<TranscriptLine[]>([]);
  const [browserLines, setBrowserLines] = useState<TranscriptLine[]>([]);
  const [browserLiveLine, setBrowserLiveLine] = useState<TranscriptLine | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDownloadUrl, setAudioDownloadUrl] = useState<string | null>(null);
  const [audioDownloadName, setAudioDownloadName] = useState("mystt-recording.audio");
  const [audioPreviewNote, setAudioPreviewNote] = useState<string | null>(null);
  const [screenAwakeStatus, setScreenAwakeStatus] = useState<
    "idle" | "active" | "unsupported" | "released" | "error"
  >("idle");
  const [desktopDownloadsDir, setDesktopDownloadsDir] = useState<string | null>(null);
  const [lastSavedSessionId, setLastSavedSessionId] = useState<string | null>(null);
  const [, setSupportsLiveCaption] = useState<boolean | null>(null);
  const [supportsBrowserFallback, setSupportsBrowserFallback] = useState<boolean | null>(null);
  const [secureContextState, setSecureContextState] = useState<"secure" | "insecure" | "unknown">(
    "unknown"
  );
  const [captionSource, setCaptionSource] = useState<CaptionSource>("none");
  const [recordingState, setRecordingState] = useState("idle");
  const [isPaused, setIsPaused] = useState(false);
  const [archivePersistenceMode, setArchivePersistenceMode] = useState("대기");
  const [tokenCount, setTokenCount] = useState(0);
  const [openAIChunkCount, setOpenAIChunkCount] = useState(0);
  const [lastRealtimeError, setLastRealtimeError] = useState<string | null>(null);
  const [pcmChunkCount, setPcmChunkCount] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [inputPeak, setInputPeak] = useState(0);
  const [micPermissionState, setMicPermissionState] = useState("확인 중");
  const [micTrackState, setMicTrackState] = useState("missing");
  const [micMuted, setMicMuted] = useState(false);
  const [micLabel, setMicLabel] = useState("");
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDeviceOption[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState("");
  const [summaryPreview, setSummaryPreview] = useState<SummaryPreviewState | null>(null);
  const [summaryPending, setSummaryPending] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("live");
  const [editedTranscript, setEditedTranscript] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isIOSFocusShortcutEnabled, setIsIOSFocusShortcutEnabled] = useState(false);
  const [isLikelyIOSFocusDevice, setIsLikelyIOSFocusDevice] = useState(false);
  const [iosFocusShortcutSupport, setIOSFocusShortcutSupport] =
    useState<IOSFocusShortcutBrowserSupport | null>(null);
  const [recoverableArchives, setRecoverableArchives] = useState<
    RecoverableLiveRecordingArchive[]
  >([]);
  const [recoveringArchiveSessionId, setRecoveringArchiveSessionId] = useState<
    string | null
  >(null);

  const recordingRef = useRef<ReturnType<SonioxClient["realtime"]["record"]> | null>(
    null
  );
  const pcmSourceRef = useRef<PcmMicrophoneSource | null>(null);
  const utteranceBufferRef = useRef(
    new RealtimeUtteranceBuffer({
      final_only: true
    })
  );
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const browserFallbackTimerRef = useRef<number | null>(null);
  const openAIFallbackTimerRef = useRef<number | null>(null);
  const openAIFallbackInFlightRef = useRef(false);
  const liveSessionIdRef = useRef<string | null>(null);
  const archiveRecorderRef = useRef<MediaRecorder | null>(null);
  const archiveChunksRef = useRef<Blob[]>([]);
  const archiveBlobPromiseRef = useRef<Promise<Blob | null> | null>(null);
  const archiveBlobResolveRef = useRef<((blob: Blob | null) => void) | null>(null);
  const archiveMimeTypeRef = useRef("");
  const archiveSessionIdRef = useRef<string | null>(null);
  const finalizedArchiveSessionIdRef = useRef<string | null>(null);
  const autoRecoveryAttemptedSessionIdsRef = useRef(new Set<string>());
  const archiveSequenceRef = useRef(0);
  const archiveWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const archiveModeRef = useRef<"indexeddb" | "memory">("memory");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  const tokenCountRef = useRef(0);
  const activePreferencesRef = useRef(preferences);
  const sessionPreferencesRef = useRef(preferences);
  const captionSourceRef = useRef<CaptionSource>("none");
  const transcriptLinesRef = useRef<TranscriptLine[]>([]);
  const liveLinesRef = useRef<TranscriptLine[]>([]);
  const browserLinesRef = useRef<TranscriptLine[]>([]);
  const browserLiveTextRef = useRef("");
  const liveTranscriptScrollRef = useRef<HTMLDivElement | null>(null);
  const committedLineKeysRef = useRef(new Set<string>());
  const manualInputSelectionRef = useRef(false);
  const selectedInputDeviceIdRef = useRef("");
  const audioObjectUrlsRef = useRef<AudioObjectUrlState>({
    audioUrl: null,
    audioDownloadUrl: null
  });

  const activeModeProfile = modeUiProfiles[mode];
  const effectivePreferences = buildModeAdjustedRecorderPreferences(preferences, mode);
  const isEmbeddedDesktopShell =
    isTauriShell() && typeof window !== "undefined" && window.parent !== window;

  activePreferencesRef.current = effectivePreferences;
  captionSourceRef.current = captionSource;
  tokenCountRef.current = tokenCount;
  selectedInputDeviceIdRef.current = selectedInputDeviceId;

  async function requestScreenWakeLock() {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setScreenAwakeStatus("unsupported");
      return;
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setScreenAwakeStatus("active");
      wakeLockRef.current.addEventListener("release", () => {
        if (wakeLockRef.current?.released) {
          wakeLockRef.current = null;
          setScreenAwakeStatus("released");
        }
      });
    } catch {
      wakeLockRef.current = null;
      setScreenAwakeStatus("error");
    }
  }

  async function releaseScreenWakeLock() {
    const wakeLock = wakeLockRef.current;
    wakeLockRef.current = null;

    if (!wakeLock || wakeLock.released) {
      setScreenAwakeStatus("idle");
      return;
    }

    await wakeLock.release().catch(() => undefined);
    setScreenAwakeStatus("idle");
  }

  useEffect(() => {
    if (phase === "idle") {
      setMessage(activeModeProfile.idleMessage);
    }
  }, [activeModeProfile.idleMessage, phase]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (
        document.visibilityState === "visible" &&
        phase === "recording" &&
        !wakeLockRef.current
      ) {
        void requestScreenWakeLock();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [phase]);

  useEffect(
    () => () => {
      void releaseScreenWakeLock();
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    setShowDiagnostics(new URLSearchParams(window.location.search).get("debug") === "1");

    const isiOSDevice = isLikelyIOSDevice(
      window.navigator.userAgent,
      window.navigator.platform,
      window.navigator.maxTouchPoints
    );
    const focusShortcutSupport = isiOSDevice
      ? getIOSFocusShortcutBrowserSupport(window.navigator.userAgent, {
          hasChromeRuntime: "chrome" in window,
          vendor: window.navigator.vendor
        })
      : null;
    setIsLikelyIOSFocusDevice(isiOSDevice);
    setIOSFocusShortcutSupport(focusShortcutSupport);

    const storedFocusShortcutSetting = window.localStorage.getItem(
      iosFocusShortcutStorageKey
    );
    setIsIOSFocusShortcutEnabled(
      Boolean(
        focusShortcutSupport?.canUseFocusShortcutRoundTrip &&
          storedFocusShortcutSetting === "1"
      )
    );

    const handleDesktopMessage = (event: MessageEvent) => {
      const payload =
        event.data && typeof event.data === "object"
          ? (event.data as {
              type?: string;
              downloadsDir?: string;
            })
          : null;

      if (payload?.type === "mystt.desktop.shell-status" && payload.downloadsDir) {
        setDesktopDownloadsDir(payload.downloadsDir);
      }
    };

    window.addEventListener("message", handleDesktopMessage);
    return () => window.removeEventListener("message", handleDesktopMessage);
  }, []);

  useEffect(() => {
    void refreshRecoverableArchives();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      iosFocusShortcutStorageKey,
      isIOSFocusShortcutEnabled ? "1" : "0"
    );
  }, [isIOSFocusShortcutEnabled]);

  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) {
      return undefined;
    }

    const handleDesktopDownloadMessage = (event: MessageEvent) => {
      const payload =
        event.data && typeof event.data === "object"
          ? (event.data as {
              type?: string;
              path?: string;
              message?: string;
            })
          : null;

      if (payload?.type === "mystt.desktop.download-complete") {
        setMessage(
          payload.path
            ? `방금 녹음한 파일을 ${payload.path} 에 저장했습니다.`
            : "방금 녹음한 파일을 앱 다운로드 폴더에 저장했습니다."
        );
      }

      if (payload?.type === "mystt.desktop.download-failed") {
        setMessage(payload.message ?? "앱 다운로드 폴더 저장에 실패했습니다.");
      }
    };

    window.addEventListener("message", handleDesktopDownloadMessage);
    return () => window.removeEventListener("message", handleDesktopDownloadMessage);
  }, []);

  async function refreshAudioInputDevices() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label?.trim() || `마이크 ${index + 1}`,
          isVirtual: isVirtualInputDeviceLabel(device.label ?? "")
        }));

      setAudioInputDevices(inputs);

      if (inputs.length === 0) {
        return;
      }

      const hasSelected = inputs.some(
        (device) => device.deviceId === selectedInputDeviceIdRef.current
      );

      if (!manualInputSelectionRef.current || !hasSelected) {
        const preferred = choosePreferredConcreteAudioInput(inputs);

        if (preferred && preferred.deviceId !== selectedInputDeviceIdRef.current) {
          setSelectedInputDeviceId(preferred.deviceId);
        }
      }
    } catch {
      // Ignore device enumeration failures and keep the current device state.
    }
  }

  async function refreshRecoverableArchives() {
    try {
      const archives = await listRecoverableLiveRecordingArchives();
      setRecoverableArchives(archives ?? []);
    } catch (error) {
      setLastRealtimeError(
        error instanceof Error
          ? `로컬 복구 목록 확인 실패: ${error.message}`
          : "로컬 복구 목록 확인에 실패했습니다."
      );
    }
  }

  useEffect(() => {
    setSupportsLiveCaption(supportsRealtimeCaption());
    setSupportsBrowserFallback(supportsBrowserCaption());
    setSecureContextState(
      typeof window !== "undefined"
        ? window.isSecureContext
          ? "secure"
          : "insecure"
        : "unknown"
    );
    void getMicrophonePermissionState().then((state) => {
      setMicPermissionState(state);
      void refreshAudioInputDevices();
    });

    const mediaDevices = navigator.mediaDevices;

    if (!mediaDevices) {
      return;
    }

    const handleDeviceChange = () => {
      void refreshAudioInputDevices();
    };

    mediaDevices.addEventListener?.("devicechange", handleDeviceChange);

    return () => {
      mediaDevices.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") {
      return;
    }

    const interval = window.setInterval(() => {
      const startedAt = startedAtRef.current ?? Date.now();
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      for (const url of getUniqueAudioObjectUrls(audioObjectUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    const nextAudioObjectUrls = {
      audioUrl,
      audioDownloadUrl
    };

    for (const url of getRetiredAudioObjectUrls(
      audioObjectUrlsRef.current,
      nextAudioObjectUrls
    )) {
      URL.revokeObjectURL(url);
    }

    audioObjectUrlsRef.current = nextAudioObjectUrls;
  }, [audioDownloadUrl, audioUrl]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      recordingRef.current?.cancel();
      pcmSourceRef.current?.stop();
      void preserveArchiveRecorderForRecovery();
      recognitionRef.current?.abort();

      if (browserFallbackTimerRef.current) {
        window.clearTimeout(browserFallbackTimerRef.current);
        browserFallbackTimerRef.current = null;
      }

      if (openAIFallbackTimerRef.current) {
        window.clearInterval(openAIFallbackTimerRef.current);
        openAIFallbackTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const archive = selectAutoRecoverableArchive({
      archives: recoverableArchives,
      phase,
      recoveringArchiveSessionId,
      attemptedSessionIds: autoRecoveryAttemptedSessionIdsRef.current
    });

    if (!archive) {
      return;
    }

    autoRecoveryAttemptedSessionIdsRef.current.add(archive.sessionId);
    setMessage("검증되지 않은 로컬 복구 archive를 자동으로 다시 업로드합니다.");
    void uploadRecoverableArchive(archive);
  }, [recoverableArchives, phase, recoveringArchiveSessionId]);

  function resetArchiveRecorderState() {
    archiveRecorderRef.current = null;
    archiveChunksRef.current = [];
    archiveBlobPromiseRef.current = null;
    archiveBlobResolveRef.current = null;
    archiveMimeTypeRef.current = "";
    archiveSessionIdRef.current = null;
    archiveSequenceRef.current = 0;
    archiveWriteQueueRef.current = Promise.resolve();
    archiveModeRef.current = "memory";
    setArchivePersistenceMode("대기");
  }

  async function startArchiveRecorder(sessionId: string, stream: MediaStream) {
    if (!supportsArchiveRecorder()) {
      return;
    }

    resetArchiveRecorderState();
    finalizedArchiveSessionIdRef.current = null;

    const mimeType = getPreferredArchiveMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    archiveMimeTypeRef.current = recorder.mimeType || mimeType || "audio/webm";
    archiveSessionIdRef.current = sessionId;
    archiveBlobPromiseRef.current = new Promise((resolve) => {
      archiveBlobResolveRef.current = resolve;
    });
    archiveModeRef.current = "memory";
    setArchivePersistenceMode("메모리 fallback");

    try {
      const prepared = await prepareLiveRecordingArchive(
        sessionId,
        archiveMimeTypeRef.current
      );

      if (prepared) {
        archiveModeRef.current = "indexeddb";
        setArchivePersistenceMode("IndexedDB");
      }
    } catch (error) {
      setLastRealtimeError(
        error instanceof Error
          ? `로컬 오디오 보존 준비 실패: ${error.message}`
          : "로컬 오디오 보존 준비에 실패했습니다."
      );
    }

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        const nextMimeType = event.data.type?.trim();

        if (archiveModeRef.current === "indexeddb" && archiveSessionIdRef.current) {
          const currentSessionId = archiveSessionIdRef.current;
          const sequence = archiveSequenceRef.current;
          archiveSequenceRef.current += 1;
          archiveWriteQueueRef.current = archiveWriteQueueRef.current
            .then(async () => {
              if (nextMimeType && nextMimeType !== archiveMimeTypeRef.current) {
                archiveMimeTypeRef.current = nextMimeType;
                await setLiveRecordingArchiveMimeType(currentSessionId, nextMimeType);
              }
              await appendLiveRecordingChunk(currentSessionId, sequence, event.data);
            })
            .catch(() => {
              archiveModeRef.current = "memory";
              setArchivePersistenceMode("메모리 fallback");
              archiveChunksRef.current.push(event.data);
            });
          return;
        }

        if (nextMimeType) {
          archiveMimeTypeRef.current = nextMimeType;
        }

        archiveChunksRef.current.push(event.data);
      }
    });

    recorder.addEventListener(
      "stop",
      () => {
        const blob =
          archiveChunksRef.current.length > 0
            ? new Blob(archiveChunksRef.current, {
                type: archiveMimeTypeRef.current || "audio/webm"
              })
            : null;

        archiveRecorderRef.current = null;
        archiveChunksRef.current = [];
        archiveBlobResolveRef.current?.(blob);
        archiveBlobResolveRef.current = null;
      },
      { once: true }
    );

    recorder.start(archiveRecorderFlushMs);
    archiveRecorderRef.current = recorder;
  }

  async function stopArchiveRecorder() {
    const recorder = archiveRecorderRef.current;
    const stopped = archiveBlobPromiseRef.current;
    const archiveSessionId = archiveSessionIdRef.current;

    if (!recorder) {
      return null;
    }

    if (recorder.state !== "inactive") {
      try {
        recorder.requestData();
      } catch {
        // Ignore best-effort data flush failures.
      }

      try {
        recorder.stop();
      } catch {
        // Ignore stop failures and fall through to any resolved stop promise.
      }
    }

    const memoryBlob = stopped ? await stopped : null;
    await archiveWriteQueueRef.current;
    archiveBlobPromiseRef.current = null;

    if (archiveModeRef.current === "indexeddb" && archiveSessionId) {
      const indexedDbBlob = await finalizeLiveRecordingArchive(archiveSessionId);

      if (indexedDbBlob) {
        finalizedArchiveSessionIdRef.current = archiveSessionId;
        resetArchiveRecorderState();
        return indexedDbBlob;
      }

      setLastRealtimeError(
        "로컬 오디오 보존 청크가 불완전해 잘린 메모리 조각 업로드를 막았습니다."
      );
      resetArchiveRecorderState();
      return null;
    }

    resetArchiveRecorderState();
    return memoryBlob;
  }

  async function discardArchiveRecorder() {
    const archiveSessionId = archiveSessionIdRef.current;

    try {
      archiveRecorderRef.current?.stop();
    } catch {
      // Ignore stop failures during discard.
    }

    await archiveWriteQueueRef.current.catch(() => undefined);

    if (archiveSessionId) {
      await discardLiveRecordingArchive(archiveSessionId).catch(() => undefined);
    }

    resetArchiveRecorderState();
  }

  async function preserveArchiveRecorderForRecovery() {
    try {
      const recorder = archiveRecorderRef.current;
      const stopped = archiveBlobPromiseRef.current;

      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.requestData();
        } catch {
          // Ignore best-effort data flush failures while leaving IndexedDB chunks intact.
        }

        try {
          recorder.stop();
        } catch {
          // Ignore stop failures during page teardown; recovery will use written chunks.
        }
      }

      await stopped?.catch(() => null);
      await archiveWriteQueueRef.current.catch(() => undefined);
    } finally {
      resetArchiveRecorderState();
    }
  }

  async function discardVerifiedLocalArchive(sessionId: string) {
    try {
      await discardLiveRecordingArchive(sessionId);
      await refreshRecoverableArchives();
    } catch (error) {
      setLastRealtimeError(
        error instanceof Error
          ? `검증 완료된 로컬 archive 정리 실패: ${error.message}`
          : "검증 완료된 로컬 archive 정리에 실패했습니다."
      );
    }
  }

  async function discardFinalizedArchiveAfterVerifiedUpload() {
    const finalizedArchiveSessionId = finalizedArchiveSessionIdRef.current;

    if (!finalizedArchiveSessionId) {
      return;
    }

    await discardVerifiedLocalArchive(finalizedArchiveSessionId);
    finalizedArchiveSessionIdRef.current = null;
  }

  function setCommittedLines(nextLines: TranscriptLine[]) {
    transcriptLinesRef.current = nextLines;
    committedLineKeysRef.current = new Set(
      nextLines.map((line) => buildTranscriptLineSignature(line))
    );
    setTranscriptLines(nextLines);
  }

  function appendCommittedLines(nextLines: TranscriptLine[]) {
    if (nextLines.length === 0) {
      return;
    }

    const uniqueLines = nextLines.filter((line) => {
      const signature = buildTranscriptLineSignature(line);

      if (committedLineKeysRef.current.has(signature)) {
        return false;
      }

      committedLineKeysRef.current.add(signature);
      return true;
    });

    if (uniqueLines.length === 0) {
      return;
    }

    setCommittedLines([...transcriptLinesRef.current, ...uniqueLines]);
  }

  function setLiveCaptionLines(nextLines: TranscriptLine[]) {
    liveLinesRef.current = nextLines;
    setLiveLines(nextLines);
  }

  function setFallbackLines(nextLines: TranscriptLine[]) {
    browserLinesRef.current = nextLines;
    setBrowserLines(nextLines);
  }

  function resetUtteranceBuffer() {
    const groupBy = getTranscriptGroupBy(sessionPreferencesRef.current);

    utteranceBufferRef.current = new RealtimeUtteranceBuffer({
      ...(groupBy.length > 0 ? { group_by: groupBy } : {}),
      final_only: true
    });
  }

  function appendStableSegments(
    segments: Array<{ tokens: RealtimeToken[] }>,
    translatedTokens: RealtimeToken[]
  ) {
    if (segments.length === 0) {
      return;
    }

    appendCommittedLines(
      segments
        .map((segment, index) =>
          toTranscriptLine(
            segment.tokens,
            "committed",
            `stable-${Date.now()}-${index}`,
            "soniox",
            sessionPreferencesRef.current.enableLiveTranslation
              ? buildSegmentTranslationText(segment.tokens, translatedTokens)
              : null
          )
        )
        .filter((line): line is TranscriptLine => Boolean(line))
    );
  }

  function commitCurrentLiveLines() {
    if (liveLinesRef.current.length === 0) {
      return;
    }

    appendCommittedLines(
      liveLinesRef.current.map((line, index) => ({
        ...line,
        id: `live-commit-${Date.now()}-${index}`,
        kind: "committed"
      }))
    );
  }

  function appendUtteranceTranscript() {
    const utterance = utteranceBufferRef.current.markEndpoint();

    if (!utterance) {
      commitCurrentLiveLines();
      setLiveCaptionLines([]);
      return;
    }

    const line = toTranscriptLine(
      utterance.tokens,
      "committed",
      `utterance-${Date.now()}`,
      "soniox"
    );

    if (!line && utterance.text.trim()) {
      appendCommittedLines([
        {
          id: `utterance-text-${Date.now()}`,
          text: utterance.text.trim(),
          speaker: utterance.speaker ?? null,
          language: utterance.language ?? null,
          tokens: [],
          kind: "committed",
          source: "soniox"
        }
      ]);
    } else if (line) {
      appendCommittedLines([line]);
    }

    setLiveCaptionLines([]);
  }

  function appendFallbackLine(
    text: string,
    source: Extract<CaptionSource, "openai" | "browser">
  ) {
    const line = createFallbackTranscriptLine(text, "committed", source);

    if (!line) {
      return;
    }

    const lastLine = browserLinesRef.current[browserLinesRef.current.length - 1];

    if (lastLine?.text === line.text && lastLine.source === line.source) {
      return;
    }

    setFallbackLines([...browserLinesRef.current, line]);

    if (captionSourceRef.current !== "soniox") {
      setCaptionSource(source);
    }
  }

  function resetTranscriptView() {
    transcriptLinesRef.current = [];
    liveLinesRef.current = [];
    browserLinesRef.current = [];
    browserLiveTextRef.current = "";
    committedLineKeysRef.current.clear();
    pcmSourceRef.current?.clearPending();
    resetUtteranceBuffer();
    setTranscriptLines([]);
    setLiveLines([]);
    setBrowserLines([]);
    setBrowserLiveLine(null);
    setOpenAIChunkCount(0);
  }

  function stopBrowserFallback() {
    if (browserFallbackTimerRef.current) {
      window.clearTimeout(browserFallbackTimerRef.current);
      browserFallbackTimerRef.current = null;
    }

    recognitionRef.current?.stop();
    recognitionRef.current = null;
    browserLiveTextRef.current = "";
    setBrowserLiveLine(null);
  }

  function clearOpenAIFallbackTimer() {
    if (openAIFallbackTimerRef.current) {
      window.clearInterval(openAIFallbackTimerRef.current);
      openAIFallbackTimerRef.current = null;
    }
  }

  function stopOpenAIFallback() {
    clearOpenAIFallbackTimer();

    pcmSourceRef.current?.clearPending();
    openAIFallbackInFlightRef.current = false;
    setOpenAIChunkCount(0);
  }

  async function startOpenAIFallback(runId: number, liveSessionId: string) {
    if (!pcmSourceRef.current || runIdRef.current !== runId) {
      return;
    }

    if (typeof window !== "undefined" && !openAIFallbackTimerRef.current) {
      openAIFallbackTimerRef.current = window.setInterval(() => {
        if (runIdRef.current === runId && liveSessionIdRef.current === liveSessionId) {
          void flushOpenAIFallback(runId, liveSessionId);
        }
      }, openAIFallbackFlushMs);
    }

    setMessage(
      "Soniox 응답이 늦어 OpenAI 보조 자막을 함께 시작했습니다."
    );
  }

  async function flushOpenAIFallback(
    runId: number,
    liveSessionId: string,
    force = false
  ) {
    if (!force && captionSourceRef.current === "soniox") {
      pcmSourceRef.current?.clearPending();
      return;
    }

    if (openAIFallbackInFlightRef.current) {
      return;
    }

    const chunkBlob = pcmSourceRef.current?.consumePendingWavBlob({
      force,
      minBytes: 32_000,
      maxBytes: 160_000
    });

    if (!chunkBlob) {
      return;
    }

    openAIFallbackInFlightRef.current = true;
    setOpenAIChunkCount((current) => current + 1);

    try {
      const prompt = buildTranscriptText(browserLinesRef.current).slice(-160);
      const response = await transcribeRealtimeCaptionChunk({
        sessionId: liveSessionId,
        chunkId: `${liveSessionId}-${Date.now()}`,
        mimeType: chunkBlob.type || "audio/wav",
        audioBase64: arrayBufferToBase64(await chunkBlob.arrayBuffer()),
        language: "ko",
        prompt: prompt || undefined
      });

      if (runIdRef.current !== runId) {
        return;
      }

      if (response.text.replace(/\s+/g, "").length > 0) {
        appendFallbackLine(response.text, "openai");
        setLastRealtimeError((current) =>
          current?.startsWith("OpenAI 보조 자막") ? null : current
        );

        if (captionSourceRef.current !== "soniox") {
          setMessage(
            "OpenAI 보조 자막으로 실시간 문장을 올리는 중입니다. Soniox가 붙으면 자동으로 전환합니다."
          );
        }
      }
    } catch (error) {
      if (runIdRef.current === runId) {
        setLastRealtimeError(
          error instanceof Error
            ? `OpenAI 보조 자막: ${error.message}`
            : "OpenAI 보조 자막 요청에 실패했습니다."
        );
      }
    } finally {
      openAIFallbackInFlightRef.current = false;
    }
  }

  async function flushOpenAIFallbackForCommand(
    runId: number,
    liveSessionId: string,
    timeoutMs = openAIFallbackCommandFlushTimeoutMs
  ) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      await Promise.race([
        flushOpenAIFallback(runId, liveSessionId, true),
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  function handleRealtimeResult(result: RealtimeResult) {
    const appliedPreferences = sessionPreferencesRef.current;
    const { sourceTokens, translatedTokens } = splitRealtimeTokens(result.tokens);

    if (sourceTokens.length === 0) {
      return;
    }

    stopOpenAIFallback();
    setCaptionSource("soniox");

    const groupedResult: RealtimeResult = {
      ...result,
      tokens: sourceTokens
    };
    const stableSegments = utteranceBufferRef.current.addResult(groupedResult);
    appendStableSegments(stableSegments, translatedTokens);

    const groupBy = getTranscriptGroupBy(appliedPreferences);

    const activeSegments = segmentRealtimeTokens(
      sourceTokens.filter((token) => !token.is_final),
      {
        ...(groupBy.length > 0 ? { group_by: groupBy } : {}),
        final_only: false
      }
    );

    setLiveCaptionLines(
      activeSegments
        .map((segment, index) =>
          toTranscriptLine(
            segment.tokens,
            "live",
            `live-${Date.now()}-${index}`,
            "soniox",
            appliedPreferences.enableLiveTranslation
              ? buildSegmentTranslationText(segment.tokens, translatedTokens)
              : null
          )
        )
        .filter((line): line is TranscriptLine => Boolean(line))
    );
  }

  async function startRecording() {
    if (phase === "recording" || phase === "requesting" || phase === "saving") {
      return;
    }

    setAudioUrl(null);
    setAudioDownloadUrl(null);
    setAudioDownloadName("mystt-recording.audio");
    setAudioPreviewNote(null);

    stopBrowserFallback();
    stopOpenAIFallback();
    sessionPreferencesRef.current = activePreferencesRef.current;
    resetTranscriptView();
    setPhase("requesting");
    setMessage("Soniox 실시간 자막과 마이크를 연결하는 중입니다.");
    setElapsedSeconds(0);
    setLastSavedSessionId(null);
    setCaptionSource("none");
    setRecordingState("starting");
    setIsPaused(false);
    setArchivePersistenceMode("대기");
    setTokenCount(0);
    setOpenAIChunkCount(0);
    setPcmChunkCount(0);
    setInputLevel(0);
    setInputPeak(0);
    setLastRealtimeError(null);
    setSummaryPreview(null);
    setEditedTranscript("");
    setWorkspaceView("live");
    resetUtteranceBuffer();
    resetArchiveRecorderState();

    if (!supportsRealtimeCaption() && shouldWarnAboutInsecureContext) {
      setPhase("error");
      setMessage("이 주소에서는 모바일 브라우저 마이크가 막힙니다. HTTPS 주소로 다시 열어 주세요.");
      return;
    }

    void requestScreenWakeLock();

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    startedAtRef.current = Date.now();
    const liveSessionId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `live-${Date.now()}`;
    liveSessionIdRef.current = liveSessionId;

    try {
      const requestedInput = audioInputDevices.find(
        (device) => device.deviceId === selectedInputDeviceIdRef.current
      );
      const captureInput = resolveCaptureInput(
        audioInputDevices,
        selectedInputDeviceIdRef.current
      );

      if (captureInput && captureInput.deviceId !== selectedInputDeviceIdRef.current) {
        setSelectedInputDeviceId(captureInput.deviceId);
      }

      const pcmSource = new PcmMicrophoneSource({
        archiveAudio: shouldArchivePcmWavForUpload({
          isDesktopShell: isTauriShell(),
          supportsArchiveRecorder: supportsArchiveRecorder(),
          prefersStableBrowserBlob: shouldPreferStableBrowserAudioBlob()
        }),
        constraints: captureInput?.deviceId
          ? {
              deviceId: {
                exact: captureInput.deviceId
              }
            }
          : undefined,
        onDebug: (debug) => {
          if (runIdRef.current !== runId) {
            return;
          }

          setPcmChunkCount(debug.chunkCount);
          setInputLevel(Math.round(debug.rms * 1000) / 1000);
          setInputPeak(Math.round(debug.peak * 1000) / 1000);
        },
        onTrackState: (trackState) => {
          if (runIdRef.current !== runId) {
            return;
          }

          setMicMuted(trackState.muted);
          setMicTrackState(trackState.readyState);
          setMicLabel(trackState.label || captureInput?.label || "");

          if (
            captureInput &&
            !captureInput.isVirtual &&
            isVirtualInputDeviceLabel(trackState.label)
          ) {
            setLastRealtimeError(
              `선택한 ${captureInput.label} 대신 ${trackState.label} 가 실제 입력으로 잡혔습니다. 가상 장치를 우회하도록 다시 선택해 주세요.`
            );
          }
        },
        onStream: (stream) => {
          if (runIdRef.current !== runId) {
            return;
          }

          void startArchiveRecorder(liveSessionId, stream).catch((error) => {
            setLastRealtimeError(
              error instanceof Error
                ? `압축 아카이브 시작 실패: ${error.message}`
                : "압축 아카이브 시작에 실패했습니다."
            );
          });
        }
      });
      const sampleRate = await pcmSource.prepare();
      pcmSourceRef.current = pcmSource;
      setMicPermissionState("요청 중");

      if (captureInput?.isVirtual) {
        setLastRealtimeError(
          `현재 ${captureInput.label} 가상 장치를 쓰고 있습니다. 실제 마이크 장치로 자동 전환하지 못했습니다.`
        );
      } else if (
        requestedInput &&
        captureInput &&
        requestedInput.deviceId !== captureInput.deviceId
      ) {
        setLastRealtimeError(
          `${requestedInput.label} 대신 ${captureInput.label}로 녹음을 시작했습니다. 시스템 기본값이 아니라 실제 장치를 우선 사용합니다.`
        );
      }

      const client = new SonioxClient({
        api_key: async () => {
          const tempKey = await probeSonioxTempKey(liveSessionId);
          return tempKey.apiKey;
        }
      });

      const recording = client.realtime.record({
        ...toRealtimeConfig(
          liveSessionId,
          mode,
          title,
          projectKey,
          sessionPreferencesRef.current,
          sampleRate
        ),
        source: pcmSource
      });

      recordingRef.current = recording;

      recording.on("connected", () => {
        if (runIdRef.current !== runId) {
          return;
        }

        setMicPermissionState("허용");
        void refreshAudioInputDevices();
        setMessage("실시간 자막 연결 완료. 바로 말하면 자막이 올라옵니다.");
      });
      recording.on("state_change", ({ new_state }) => {
        if (runIdRef.current !== runId) {
          return;
        }

        setRecordingState(new_state);
        if (new_state === "paused") {
          setIsPaused(true);
        }

        if (new_state === "recording") {
          setIsPaused(false);
        }
      });
      recording.on("token", () => {
        if (runIdRef.current !== runId) {
          return;
        }

        setTokenCount((current) => current + 1);
      });
      recording.on("result", (result) => {
        if (runIdRef.current !== runId) {
          return;
        }

        handleRealtimeResult(result);
      });
      recording.on("endpoint", () => {
        if (runIdRef.current !== runId) {
          return;
        }

        appendUtteranceTranscript();
      });
      recording.on("finalized", () => {
        if (runIdRef.current !== runId) {
          return;
        }

        appendUtteranceTranscript();
      });
      recording.on("finished", () => {
        if (runIdRef.current !== runId) {
          return;
        }

        appendUtteranceTranscript();
      });
      recording.on("error", (error) => {
        if (runIdRef.current !== runId) {
          return;
        }

        recordingRef.current = null;
        setRecordingState("error");
        setLastRealtimeError(error.message || "실시간 자막 연결이 끊어졌습니다.");

        if (
          browserLinesRef.current.length > 0 ||
          Boolean(pcmSourceRef.current?.hasPendingAudio()) ||
          openAIFallbackInFlightRef.current
        ) {
          setCaptionSource("openai");
          setMessage(
            "Soniox 연결이 끊겨 OpenAI 보조 자막으로 계속 기록합니다."
          );
          return;
        }

        stopBrowserFallback();
        stopOpenAIFallback();
        pcmSourceRef.current = null;
        setPhase("error");
        setMessage(error.message || "실시간 자막 연결이 끊어졌습니다.");
      });

      if (typeof window !== "undefined") {
        browserFallbackTimerRef.current = window.setTimeout(() => {
          if (
            runIdRef.current === runId &&
            liveSessionIdRef.current === liveSessionId &&
            tokenCountRef.current === 0 &&
            transcriptLinesRef.current.length === 0 &&
            liveLinesRef.current.length === 0
          ) {
            void startOpenAIFallback(runId, liveSessionId).catch((error) => {
              setLastRealtimeError(
                error instanceof Error
                  ? `OpenAI 보조 자막: ${error.message}`
                  : "OpenAI 보조 자막 시작에 실패했습니다."
              );
            });
          }
        }, 3500);
      }

      startedAtRef.current = Date.now();
      setPhase("recording");
      setMessage(
        "Soniox 실시간 자막을 연결했습니다. 바로 말하면 자막이 올라옵니다."
      );
    } catch (error) {
      stopBrowserFallback();
      stopOpenAIFallback();
      pcmSourceRef.current?.stop();
      pcmSourceRef.current = null;
      setPhase("error");
      setRecordingState("error");
      setMicPermissionState("오류");
      setLastRealtimeError(
        error instanceof Error ? error.message : "마이크를 시작하지 못했습니다."
      );
      setMessage(
        error instanceof Error
          ? error.message
          : "마이크를 시작하지 못했습니다."
      );
    }
  }

  function getEffectiveTranscript() {
    const manual = editedTranscript.replace(/\s+/g, " ").trim();

    if (manual) {
      return manual;
    }

    const sonioxTranscript = buildTranscriptText([
      ...transcriptLinesRef.current,
      ...liveLinesRef.current
    ]);
    const browserTranscript = buildTranscriptText([
      ...browserLinesRef.current,
      ...(browserLiveTextRef.current
        ? [createBrowserTranscriptLine(browserLiveTextRef.current, "live")]
        : [])
    ].filter((line): line is TranscriptLine => Boolean(line)));

    return canUseTranscriptForPreview(sonioxTranscript)
      ? sonioxTranscript
      : browserTranscript;
  }

  function openTranscriptWorkspace() {
    const transcript = getEffectiveTranscript();
    setEditedTranscript((current) => current.trim() || transcript);
    setWorkspaceView("transcript");
  }

  async function generateSummaryPreview() {
    const transcript = getEffectiveTranscript();

    if (!canUseTranscriptForPreview(transcript)) {
      setLastRealtimeError("정리하려면 조금 더 긴 대화가 필요합니다.");
      return;
    }

    setSummaryPending(true);

    try {
      const preview = await previewSessionNotes({
        mode,
        transcript,
        title: title.trim() || undefined
      });

      setSummaryPreview({
        model: preview.model,
        notes: preview.notes
      });
      setWorkspaceView("summary");
      setLastRealtimeError(null);
      setMessage(`현재 대화를 기준으로 ${activeModeProfile.summaryHeaderLabel}을 준비했습니다.`);
    } catch (error) {
      setLastRealtimeError(
        error instanceof Error ? error.message : "요약 생성에 실패했습니다."
      );
    } finally {
      setSummaryPending(false);
    }
  }

  async function updateSessionTitleFromGeneratedNotes(input: {
    sessionId: string;
    currentTitle: string;
    notes?: SessionNotesRecord;
  }) {
    const generatedTitle = resolveGeneratedSessionTitleFromNotes({
      currentTitle: input.currentTitle,
      notes: input.notes
    });

    if (!generatedTitle) {
      return;
    }

    try {
      await updatePortalSessionTitle({
        sessionId: input.sessionId,
        title: generatedTitle
      });
    } catch (error) {
      setLastRealtimeError(
        error instanceof Error
          ? `생성 제목 저장 실패: ${error.message}`
          : "생성 제목 저장에 실패했습니다."
      );
    }
  }

  async function pauseRecording() {
    if (phase !== "recording" || isPaused) {
      return;
    }

    const activeRunId = runIdRef.current;
    const liveSessionId = liveSessionIdRef.current;

    recordingRef.current?.pause();
    pcmSourceRef.current?.pause();
    clearOpenAIFallbackTimer();

    if (archiveRecorderRef.current?.state === "recording") {
      archiveRecorderRef.current.pause();
    }

    setIsPaused(true);
    setRecordingState("paused");
    setMessage(
      "일시정지했습니다. 다시 시작을 누르면 같은 Soniox 세션으로 이어집니다."
    );

    if (liveSessionId) {
      void flushOpenAIFallbackForCommand(activeRunId, liveSessionId).catch(
        () => undefined
      );
    }
  }

  function resumeRecording() {
    if (phase !== "recording" || !isPaused) {
      return;
    }

    recordingRef.current?.resume();
    pcmSourceRef.current?.resume();

    if (archiveRecorderRef.current?.state === "paused") {
      archiveRecorderRef.current.resume();
    }

    setIsPaused(false);
    setRecordingState("recording");
    setMessage("같은 세션으로 녹음을 다시 시작했습니다.");
  }

  async function stopRecording() {
    if (phase !== "recording") {
      return;
    }

    setPhase("saving");
    setIsPaused(false);
    setMessage("녹음을 저장하고 요약을 생성하는 중입니다.");
    const activeRunId = runIdRef.current;
    const liveSessionId = liveSessionIdRef.current;
    const recording = recordingRef.current;
    const pcmSource = pcmSourceRef.current;

    stopBrowserFallback();
    clearOpenAIFallbackTimer();

    let nextAudioUrl: string | null = null;
    let nextAudioDownloadUrl: string | null = null;
    let nextAudioDownloadName = "mystt-recording.audio";
    let nextAudioPreviewNote: string | null = null;
    let archiveBlob: Blob | null = null;

    try {
      [archiveBlob] = await Promise.all([
        stopArchiveRecorder(),
        recording?.stop()
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "실시간 자막 종료 중 오류가 발생했습니다."
      );
    } finally {
      pcmSource?.stop();
    }

    if (liveSessionId) {
      await flushOpenAIFallbackForCommand(activeRunId, liveSessionId);
    }

    runIdRef.current += 1;
    recordingRef.current = null;
    pcmSourceRef.current = null;
    liveSessionIdRef.current = null;
    stopOpenAIFallback();

    appendUtteranceTranscript();

    const audioBlob = pcmSource?.getWavBlob();
    const inlineAudioPreviewEnabled = shouldUseInlineAudioPreview({
      isDesktopShell: isTauriShell()
    });
    const previewBlob = inlineAudioPreviewEnabled
      ? (audioBlob && canPreviewAudioMimeType(audioBlob.type) ? audioBlob : null) ??
        (archiveBlob && canPreviewAudioMimeType(archiveBlob.type) ? archiveBlob : null)
      : null;
    const canonicalUploadBlob = await buildPreferredRecordingUpload({
      pcmWavBlob: audioBlob,
      archiveBlob,
      expectedDurationMs: startedAtRef.current
        ? Date.now() - startedAtRef.current
        : undefined,
      resolveBlobDurationMs: resolveBrowserAudioDurationMs,
      encodePcmWavToMp3: encodePcmWavBlobToMp3
    });
    const downloadableBlob = canonicalUploadBlob ?? archiveBlob ?? audioBlob;

    if (previewBlob) {
      nextAudioUrl = URL.createObjectURL(previewBlob);
      setAudioUrl(nextAudioUrl);
    }

    if (downloadableBlob) {
      nextAudioDownloadUrl =
        downloadableBlob === previewBlob && nextAudioUrl
          ? nextAudioUrl
          : URL.createObjectURL(downloadableBlob);
      nextAudioDownloadName = buildRecordingFileName({
        blob: downloadableBlob
      });
      setAudioDownloadUrl(nextAudioDownloadUrl);
      setAudioDownloadName(nextAudioDownloadName);

      if (!previewBlob && inlineAudioPreviewEnabled) {
        nextAudioPreviewNote =
          downloadableBlob.type && downloadableBlob.type !== "application/octet-stream"
            ? `${downloadableBlob.type} 포맷은 다운로드 링크로 제공합니다.`
            : "이 환경에서는 미리듣기 없이 다운로드 링크로 제공합니다.";
        setAudioPreviewNote(nextAudioPreviewNote);
      }
    }

    const transcript = getEffectiveTranscript();
    const hasTranscriptPreview = canUseTranscriptForPreview(transcript);
    const canPersistSourceAudio = shouldPersistStoppedRecording({
      canonicalUploadBlobAvailable: Boolean(canonicalUploadBlob),
      realtimeTranscript: transcript
    });

    if (!canonicalUploadBlob || !canPersistSourceAudio) {
      setPhase("error");
      setRecordingState("error");
      setMessage(
        "원본 음성 파일을 만들지 못했습니다. 다시 녹음해 주세요."
      );
      void releaseScreenWakeLock();
      return;
    }

    if (!hasTranscriptPreview) {
      setAudioPreviewNote((current) =>
        current ??
        "실시간 자막이 짧아 미리보기 노트는 생략하고 원본 음성으로 최종 전사를 진행합니다."
      );
    }

    let createdSessionId: string | null = null;
    let sourceAudioUploaded = false;
    try {
      const resolvedTitle =
        title.trim() || `빠른 녹음 ${new Date().toLocaleTimeString("ko-KR")}`;
      const created = await createPortalSession({
        title: resolvedTitle,
        mode,
        projectKey: projectKey.trim() || undefined,
        languageHints: sessionPreferencesRef.current.enableMixedLanguage
          ? ["ko", "en"]
          : ["ko"],
        realtimeOptions: {
          enableMixedLanguage: sessionPreferencesRef.current.enableMixedLanguage,
          enableSpeakerDiarization: sessionPreferencesRef.current.enableSpeakerDiarization,
          highlightLowConfidence: sessionPreferencesRef.current.highlightLowConfidence,
          enableLiveTranslation: sessionPreferencesRef.current.enableLiveTranslation,
          endpointDelayMs: sessionPreferencesRef.current.endpointDelayMs,
          contextTerms: parseContextTerms(sessionPreferencesRef.current.contextTermsText),
          inputDeviceLabel: micLabel || null
        }
      });
      createdSessionId = created.id;

      const snapshot = await finalizePortalRecording({
        sessionId: created.id,
        file: canonicalUploadBlob,
        fileName: buildRecordingFileName({
          blob: canonicalUploadBlob
        }),
        wait: true,
        onSourceAudioUploaded: async () => {
          sourceAudioUploaded = true;

          setAudioUrl(getSessionSourceAudioPreviewHref(created.id));
          setAudioDownloadUrl(getSessionSourceAudioHref(created.id, { format: "mp3" }));
          setAudioDownloadName(buildDesktopDownloadFileName(nextAudioDownloadName));
          setAudioPreviewNote(null);
          await discardFinalizedArchiveAfterVerifiedUpload();
        }
      });
      const finalizedArchiveSessionId = finalizedArchiveSessionIdRef.current;
      if (finalizedArchiveSessionId) {
        await discardVerifiedLocalArchive(finalizedArchiveSessionId);
        finalizedArchiveSessionIdRef.current = null;
      }
      await updateSessionTitleFromGeneratedNotes({
        sessionId: created.id,
        currentTitle: created.title,
        notes: snapshot.notes?.notes
      });

      setLastSavedSessionId(created.id);
      if (snapshot.notes) {
        setSummaryPreview({
          model: snapshot.notes.model,
          notes: snapshot.notes.notes
        });
        setWorkspaceView("summary");
      }

      if (snapshot.session.status === "failed") {
        throw new Error("Soniox async 최종 처리에 실패했습니다.");
      }

      setRecordingState("idle");

      if (snapshot.session.status !== "completed") {
        if (onSaved) {
          onSaved(created.id);
        }

        setPhase("processing");
        setMessage(getPortalProcessingMessage(snapshot.session.status));
        void releaseScreenWakeLock();
        return;
      }

      setPhase("saved");
      setMessage(
        captionSource === "browser" || captionSource === "openai"
          ? "보조 자막이 있어도 최종 저장은 Soniox async 최종본으로 마쳤고, 요약 노트까지 생성했습니다."
          : "녹음을 저장했고, Soniox async 최종본 기준으로 요약 노트까지 생성했습니다."
      );
      void releaseScreenWakeLock();

      if (onSaved) {
        onSaved(created.id);
      }
    } catch (error) {
      if (createdSessionId && !sourceAudioUploaded) {
        await failPortalSession({
          sessionId: createdSessionId,
          reason:
            error instanceof Error
              ? error.message
              : "Source audio upload failed before reaching processing.",
          phase: "source_audio_upload"
        }).catch(() => undefined);
      }
      if (createdSessionId && sourceAudioUploaded) {
        setLastSavedSessionId(createdSessionId);
      }
      setPhase("error");
      setRecordingState("error");
      setMessage(
        sourceAudioUploaded
          ? error instanceof Error
            ? `원본 음성은 저장했지만 최종 전사/노트 생성에 실패했습니다. ${error.message}`
            : "원본 음성은 저장했지만 최종 전사/노트 생성에 실패했습니다."
          : error instanceof Error
            ? `녹음 저장에 실패했습니다. ${error.message}`
            : "녹음 저장 또는 최종 전사/노트 생성에 실패했습니다."
      );
      if (!sourceAudioUploaded) {
        void refreshRecoverableArchives();
      }
      void releaseScreenWakeLock();
    }
  }

  async function cancelRecording() {
    if (phase !== "requesting" && phase !== "recording") {
      return;
    }

    runIdRef.current += 1;
    stopBrowserFallback();
    stopOpenAIFallback();
    recordingRef.current?.cancel();
    recordingRef.current = null;
    pcmSourceRef.current?.clear();
    pcmSourceRef.current?.stop();
    pcmSourceRef.current = null;
    await discardArchiveRecorder();

    setAudioUrl(null);
    setAudioDownloadUrl(null);
    setAudioDownloadName("mystt-recording.audio");
    setAudioPreviewNote(null);

    startedAtRef.current = null;
    resetTranscriptView();
    setElapsedSeconds(0);
    setLastSavedSessionId(null);
    setCaptionSource("none");
    setWorkspaceView("live");
    setPhase("idle");
    setMessage("현재 녹음을 취소했습니다. 다시 시작하면 새 자막 세션으로 열립니다.");
    setRecordingState("canceled");
    setIsPaused(false);
    void releaseScreenWakeLock();
    setArchivePersistenceMode("대기");
    setPcmChunkCount(0);
    setInputLevel(0);
    setInputPeak(0);
    liveSessionIdRef.current = null;
    void refreshRecoverableArchives();
  }

  function handleLatestAudioDownload(event: MouseEvent<HTMLAnchorElement>) {
    const desktopDownloadUrl =
      audioDownloadUrl && typeof window !== "undefined"
        ? resolveDesktopDownloadUrl(audioDownloadUrl, window.location.href)
        : null;

    if (!desktopDownloadUrl || !isEmbeddedDesktopShell) {
      return;
    }

    event.preventDefault();
    window.parent.postMessage(
      {
        type: "mystt.desktop.download-file",
        url: desktopDownloadUrl,
        fileName: buildDesktopDownloadFileName(audioDownloadName),
        targetFormat: audioDownloadUrl?.includes("format=mp3") ? "original" : "mp3",
        sessionTitle: title.trim() || "방금 녹음한 파일"
      },
      "*"
    );
    setMessage("방금 녹음한 파일을 앱 다운로드 폴더에 mp3로 저장하는 중입니다.");
  }

  function formatRecoverableArchiveCreatedAt(
    archive: RecoverableLiveRecordingArchive
  ) {
    const createdAt = new Date(archive.createdAt);

    if (Number.isNaN(createdAt.getTime())) {
      return archive.createdAt;
    }

    return createdAt.toLocaleString("ko-KR");
  }

  async function discardRecoverableArchive(
    archive: RecoverableLiveRecordingArchive
  ) {
    if (recoveringArchiveSessionId === archive.sessionId) {
      return;
    }

    await discardLiveRecordingArchive(archive.sessionId);
    await refreshRecoverableArchives();
    setMessage("선택한 로컬 복구 archive를 폐기했습니다.");
  }

  async function uploadRecoverableArchive(
    archive: RecoverableLiveRecordingArchive
  ) {
    if (phase === "requesting" || phase === "recording" || phase === "saving") {
      setMessage("현재 녹음 흐름이 끝난 뒤 로컬 복구 archive를 처리해 주세요.");
      return;
    }

    if (!shouldAllowRecoverableArchiveUpload(archive)) {
      setMessage(buildRecoverableArchiveStatusText(archive));
      return;
    }

    setRecoveringArchiveSessionId(archive.sessionId);
    setPhase("saving");
    setRecordingState("saving");
    setMessage("IndexedDB에 남아 있던 원본 음성을 복구해 업로드하는 중입니다.");

    let createdSessionId: string | null = null;
    let sourceAudioUploaded = false;

    try {
      const recoveredBlob = await finalizeLiveRecordingArchive(archive.sessionId);
      const recoveryPreferences = activePreferencesRef.current;

      if (!recoveredBlob) {
        throw new Error(
          "로컬 복구 archive가 불완전해 잘린 오디오 업로드를 중단했습니다."
        );
      }

      const created = await createPortalSession({
        title: `복구 녹음 ${formatRecoverableArchiveCreatedAt(archive)}`,
        mode,
        projectKey: projectKey.trim() || undefined,
        languageHints: recoveryPreferences.enableMixedLanguage
          ? ["ko", "en"]
          : ["ko"],
        realtimeOptions: {
          enableMixedLanguage: recoveryPreferences.enableMixedLanguage,
          enableSpeakerDiarization:
            recoveryPreferences.enableSpeakerDiarization,
          highlightLowConfidence:
            recoveryPreferences.highlightLowConfidence,
          enableLiveTranslation: recoveryPreferences.enableLiveTranslation,
          endpointDelayMs: recoveryPreferences.endpointDelayMs,
          contextTerms: parseContextTerms(
            recoveryPreferences.contextTermsText
          ),
          inputDeviceLabel: null
        }
      });
      createdSessionId = created.id;

      const snapshot = await finalizePortalRecording({
        sessionId: created.id,
        file: recoveredBlob,
        fileName: buildRecordingFileName({
          blob: recoveredBlob
        }),
        wait: true,
        onSourceAudioUploaded: async () => {
          sourceAudioUploaded = true;

          setAudioUrl(getSessionSourceAudioPreviewHref(created.id));
          setAudioDownloadUrl(getSessionSourceAudioHref(created.id, { format: "mp3" }));
          setAudioDownloadName("mystt-recovered-recording.mp3");
          setAudioPreviewNote(null);
          await discardVerifiedLocalArchive(archive.sessionId);
        }
      });

      await discardVerifiedLocalArchive(archive.sessionId);
      await updateSessionTitleFromGeneratedNotes({
        sessionId: created.id,
        currentTitle: created.title,
        notes: snapshot.notes?.notes
      });
      setLastSavedSessionId(created.id);

      if (snapshot.notes) {
        setSummaryPreview({
          model: snapshot.notes.model,
          notes: snapshot.notes.notes
        });
        setWorkspaceView("summary");
      }

      if (snapshot.session.status === "failed") {
        throw new Error("Soniox async 최종 처리에 실패했습니다.");
      }

      setRecordingState("idle");

      if (snapshot.session.status !== "completed") {
        if (onSaved) {
          onSaved(created.id);
        }

        setPhase("processing");
        setMessage(getPortalProcessingMessage(snapshot.session.status));
        return;
      }

      setPhase("saved");
      setMessage(
        "IndexedDB에 남아 있던 원본 음성을 업로드했고, Soniox async 최종본 기준으로 요약 노트까지 생성했습니다."
      );

      if (onSaved) {
        onSaved(created.id);
      }
    } catch (error) {
      if (createdSessionId && !sourceAudioUploaded) {
        await failPortalSession({
          sessionId: createdSessionId,
          reason:
            error instanceof Error
              ? error.message
              : "Recovered source audio upload failed before reaching processing.",
          phase: "source_audio_upload"
        }).catch(() => undefined);
      }

      if (createdSessionId && sourceAudioUploaded) {
        setLastSavedSessionId(createdSessionId);
      }

      setPhase("error");
      setRecordingState("error");
      setMessage(
        sourceAudioUploaded
          ? error instanceof Error
            ? `복구 원본 음성은 저장했지만 최종 전사/노트 생성에 실패했습니다. ${error.message}`
            : "복구 원본 음성은 저장했지만 최종 전사/노트 생성에 실패했습니다."
          : error instanceof Error
            ? `로컬 복구 archive 업로드에 실패했습니다. ${error.message}`
            : "로컬 복구 archive 업로드에 실패했습니다."
      );
    } finally {
      setRecoveringArchiveSessionId(null);
      void refreshRecoverableArchives();
    }
  }

  function runIOSFocusShortcut(kind: "start" | "stop") {
    if (typeof window === "undefined") {
      return;
    }

    const support = getIOSFocusShortcutBrowserSupport(window.navigator.userAgent, {
      hasChromeRuntime: "chrome" in window,
      vendor: window.navigator.vendor
    });
    if (!support.canUseFocusShortcutRoundTrip) {
      setMessage(support.guidance);
      return;
    }

    if (
      !canRunIOSFocusShortcutAction({
        kind,
        phase,
        enabled: isIOSFocusShortcutEnabled,
        support
      })
    ) {
      setMessage(
        kind === "start"
          ? "녹음 중에는 iPhone 집중 시작 단축어를 다시 실행하지 않습니다."
          : "iPhone 단축어가 꺼져 있습니다. 단축어를 켠 뒤 집중 해제를 눌러 주세요."
      );
      return;
    }

    const shortcutLaunchUrl = buildIOSFocusShortcutLaunchUrl(kind, support);
    if (!shortcutLaunchUrl) {
      setMessage(support.guidance);
      return;
    }

    setMessage(
      kind === "start"
        ? "iPhone 단축어로 집중 모드를 켭니다. 단축어가 끝나면 MYSTT 탭으로 돌아와 녹음을 시작하세요."
        : "iPhone 단축어로 집중 모드를 해제합니다."
    );
    window.location.assign(shortcutLaunchUrl);
  }

  const sonioxDisplayLines = [...transcriptLines, ...liveLines];
  const browserDisplayLines = [
    ...browserLines,
    ...(browserLiveLine ? [browserLiveLine] : [])
  ];
  const manualLine = createManualTranscriptLine(editedTranscript);
  const displayLines =
    manualLine
      ? [manualLine]
      : sonioxDisplayLines.length > 0
      ? sonioxDisplayLines
      : browserDisplayLines;
  const effectiveTranscript = getEffectiveTranscript();
  const transcriptText = buildTranscriptText(displayLines);

  useEffect(() => {
    if (workspaceView !== "live") {
      return;
    }

    const scrollTarget = liveTranscriptScrollRef.current;
    if (!scrollTarget) {
      return;
    }

    scrollTarget.scrollTo({
      top: scrollTarget.scrollHeight,
      behavior: "smooth"
    });
  }, [transcriptText, workspaceView]);

  const controlsDisabled =
    phase === "requesting" || phase === "recording" || phase === "saving";
  const desktopBridgeDownloadUrl =
    audioDownloadUrl && typeof window !== "undefined"
      ? resolveDesktopDownloadUrl(audioDownloadUrl, window.location.href)
      : null;
  const audioDownloadHint = isEmbeddedDesktopShell
    ? desktopBridgeDownloadUrl
      ? desktopDownloadsDir
        ? `다운로드하면 이 앱의 기본 저장 폴더인 ${desktopDownloadsDir} 에 mp3로 저장됩니다.`
        : "다운로드하면 이 앱의 기본 Downloads 폴더에 mp3로 저장됩니다."
      : "원본 업로드를 마치기 전까지는 현재 창 다운로드로 저장됩니다."
    : "다운로드하면 현재 브라우저의 기본 다운로드 폴더로 저장됩니다.";
  const shouldWarnAboutInsecureContext =
    secureContextState === "insecure" &&
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1";
  const canUseIOSFocusShortcuts =
    iosFocusShortcutSupport?.canUseFocusShortcutRoundTrip ?? false;
  const canStartIOSFocusShortcut = canRunIOSFocusShortcutAction({
    kind: "start",
    phase,
    enabled: isIOSFocusShortcutEnabled,
    support: iosFocusShortcutSupport
  });
  const canStopIOSFocusShortcut = canRunIOSFocusShortcutAction({
    kind: "stop",
    phase,
    enabled: isIOSFocusShortcutEnabled,
    support: iosFocusShortcutSupport
  });

  return (
    <section className="sectionCard recorderCard">
      <div className="sectionHead recorderHead">
        <div>
          <p className="sectionEyebrow">새 녹음</p>
          <h2 className="sectionTitleLarge">{activeModeProfile.liveTitle}</h2>
        </div>
      </div>

      {shouldWarnAboutInsecureContext ? (
        <p className="inlineError">
          지금 주소는 모바일 브라우저 마이크 권한이 막힐 수 있습니다. 핸드폰에서는 HTTPS
          주소로 열어야 녹음이 동작합니다.
        </p>
      ) : null}

      <div className="recorderTopBar">
        <label className="fieldGroup recorderFieldWide">
          <span className="fieldLabel">제목</span>
          <input
            className="textField"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={activeModeProfile.titlePlaceholder}
            disabled={controlsDisabled}
          />
        </label>

        <label className="fieldGroup recorderFieldWide">
          <span className="fieldLabel">프로젝트</span>
          <input
            className="textField"
            value={projectKey}
            onChange={(event) => setProjectKey(event.target.value)}
            placeholder={activeModeProfile.projectPlaceholder}
            disabled={controlsDisabled}
          />
        </label>

        <label className="fieldGroup recorderFieldWide">
          <span className="fieldLabel">입력 장치</span>
          <select
            className="textField"
            value={selectedInputDeviceId}
            onChange={(event) => {
              manualInputSelectionRef.current = true;
              setSelectedInputDeviceId(event.target.value);
            }}
            disabled={controlsDisabled || audioInputDevices.length === 0}
          >
            {audioInputDevices.length === 0 ? (
              <option value="">마이크 목록 확인 중</option>
            ) : null}
            {audioInputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
                {device.isVirtual ? " (가상 장치)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="fieldGroup recorderFieldMode">
          <span className="fieldLabel">모드</span>
          <div className="modeSwitch">
            {sessionModes.map((sessionMode) => (
              <button
                key={sessionMode}
                type="button"
                className={
                  sessionMode === mode
                    ? "modeButton modeButtonActive"
                    : "modeButton"
                }
                onClick={() => setMode(sessionMode)}
                disabled={controlsDisabled}
              >
                {modeLabels[sessionMode]}
              </button>
            ))}
          </div>
        </div>

      </div>

      <div className="recorderMain">
        <aside className="recordSidebar">
          <div className="recordConsole">
            {isLikelyIOSFocusDevice ? (
              <div className="focusShortcutPanel">
                <div className="focusShortcutHead">
                  <p className="recordLabel">iPhone 단축어</p>
                  <label className="focusShortcutToggle">
                    <span>{isIOSFocusShortcutEnabled ? "켬" : "끔"}</span>
                    <input
                      type="checkbox"
                      checked={isIOSFocusShortcutEnabled}
                      disabled={!canUseIOSFocusShortcuts}
                      onChange={(event) =>
                        setIsIOSFocusShortcutEnabled(event.target.checked)
                      }
                    />
                  </label>
                </div>

                {canUseIOSFocusShortcuts ? (
                  <div className="focusShortcutActions">
                    <button
                      type="button"
                      className="ghostButton"
                      onClick={() => runIOSFocusShortcut("start")}
                      disabled={!canStartIOSFocusShortcut}
                      title={`단축어: ${iosFocusStartShortcutName}`}
                    >
                      집중 시작
                    </button>
                    <button
                      type="button"
                      className="ghostButton ghostButtonSecondary"
                      onClick={() => runIOSFocusShortcut("stop")}
                      disabled={!canStopIOSFocusShortcut}
                      title={`단축어: ${iosFocusStopShortcutName}`}
                    >
                      집중 해제
                    </button>
                  </div>
                ) : (
                  <p className="recordHint focusShortcutWarning">
                    {iosFocusShortcutSupport?.guidance}
                  </p>
                )}
              </div>
            ) : null}

            {recoverableArchives.length > 0 ? (
              <div className="archiveRecoveryPanel">
                <div className="archiveRecoveryHead">
                  <p className="recordLabel">로컬 복구</p>
                  <button
                    type="button"
                    className="ghostButton ghostButtonSecondary archiveRecoveryRefresh"
                    onClick={() => void refreshRecoverableArchives()}
                    disabled={Boolean(recoveringArchiveSessionId)}
                  >
                    새로고침
                  </button>
                </div>

                <div className="archiveRecoveryList">
                  {recoverableArchives.map((archive) => {
                    const canUploadArchive =
                      shouldAllowRecoverableArchiveUpload(archive);
                    const isBusy = recoveringArchiveSessionId === archive.sessionId;

                    return (
                      <div key={archive.sessionId} className="archiveRecoveryItem">
                        <strong>{formatRecoverableArchiveCreatedAt(archive)}</strong>
                        <span>
                          {archive.mimeType || "audio"} · {archive.chunkCount}개 조각
                        </span>
                        <p>{buildRecoverableArchiveStatusText(archive)}</p>
                        <div className="archiveRecoveryActions">
                          {canUploadArchive ? (
                            <button
                              type="button"
                              className="ghostButton"
                              onClick={() => void uploadRecoverableArchive(archive)}
                              disabled={
                                Boolean(recoveringArchiveSessionId) || controlsDisabled
                              }
                            >
                              {isBusy ? "복구 중" : "복구 업로드"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="ghostButton ghostButtonSecondary"
                            onClick={() => void discardRecoverableArchive(archive)}
                            disabled={Boolean(recoveringArchiveSessionId)}
                          >
                            폐기
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div>
              <p className="recordLabel">현재 상태</p>
              <strong className="recordTimer">{formatDurationClock(elapsedSeconds)}</strong>
              <p className="recordHint">{message}</p>
              {phase === "recording" || screenAwakeStatus !== "idle" ? (
                <p className="recordHint">
                  화면 유지:{" "}
                  {screenAwakeStatus === "active"
                    ? "켜짐"
                    : screenAwakeStatus === "unsupported"
                      ? "브라우저 미지원"
                      : screenAwakeStatus === "error"
                        ? "요청 실패"
                        : screenAwakeStatus === "released"
                          ? "해제됨"
                          : "준비 중"}
                </p>
              ) : null}
            </div>
            <div className="recordActions">
              <button
                type="button"
                className="recordButton"
                onClick={() => void startRecording()}
                disabled={controlsDisabled}
              >
                <span className="recordLabelFull">
                  {phase === "requesting"
                    ? "준비 중"
                    : phase === "recording"
                      ? "녹음 중"
                      : "녹음 시작"}
                </span>
                <span className="recordLabelShort" aria-hidden="true">
                  {phase === "requesting"
                    ? "준비"
                    : phase === "recording"
                      ? "녹음"
                      : "시작"}
                </span>
              </button>
              <button
                type="button"
                className="ghostButton"
                onClick={() =>
                  isPaused ? void resumeRecording() : void pauseRecording()
                }
                disabled={phase !== "recording"}
              >
                <span className="recordLabelFull">{isPaused ? "다시 시작" : "일시정지"}</span>
                <span className="recordLabelShort" aria-hidden="true">
                  {isPaused ? "재개" : "정지"}
                </span>
              </button>
              <button
                type="button"
                className="ghostButton ghostButtonSecondary"
                onClick={() => void stopRecording()}
                disabled={phase !== "recording"}
              >
                <span className="recordLabelFull">저장하고 종료</span>
                <span className="recordLabelShort" aria-hidden="true">저장</span>
              </button>
              <button
                type="button"
                className="ghostButton ghostButtonDanger"
                onClick={() => void cancelRecording()}
                disabled={phase !== "requesting" && phase !== "recording"}
              >
                <span className="recordLabelFull">취소</span>
                <span className="recordLabelShort" aria-hidden="true">취소</span>
              </button>
            </div>

            {audioUrl || audioDownloadUrl ? (
              <div className="audioPreview audioPreviewDetailed">
                <span>방금 녹음한 파일</span>
                {audioUrl ? (
                  <audio
                    ref={audioRef}
                    controls
                    src={audioUrl}
                    onError={() => {
                      setAudioUrl(null);
                      setAudioPreviewNote(
                        "미리듣기는 생략하고 아래 다운로드 링크로 확인해 주세요."
                      );
                    }}
                  />
                ) : null}
                {audioPreviewNote ? (
                  <p className="recordHint">{audioPreviewNote}</p>
                ) : null}
                {audioDownloadUrl ? (
                  <>
                    <a
                      className="inlineLink"
                      href={audioDownloadUrl}
                      download={audioDownloadName}
                      onClick={handleLatestAudioDownload}
                    >
                      방금 녹음한 파일 다운로드
                    </a>
                    <p className="recordHint">{audioDownloadHint}</p>
                  </>
                ) : null}
              </div>
            ) : null}

            {lastSavedSessionId ? (
              <a className="inlineLink" href={`/sessions/${lastSavedSessionId}`}>
                방금 저장한 기록 보기
              </a>
            ) : null}

            {showDiagnostics ? (
              <details className="diagnosticDisclosure">
                <summary>입력 진단 보기</summary>
                <div className="diagnosticGrid">
                  <span className="diagnosticItem">연결 상태: {recordingState}</span>
                  <span className="diagnosticItem">
                    자막 소스: {formatCaptionSourceLabel(captionSource)}
                  </span>
                  <span className="diagnosticItem">토큰 수: {tokenCount}</span>
                  <span className="diagnosticItem">PCM 청크 수: {pcmChunkCount}</span>
                  <span className="diagnosticItem">
                    OpenAI 보조 청크: {openAIChunkCount}
                  </span>
                  <span className="diagnosticItem">
                    오디오 보존: {archivePersistenceMode}
                  </span>
                  <span className="diagnosticItem">
                    엔드포인트 지연: {(phase === "recording"
                      ? sessionPreferencesRef.current.endpointDelayMs
                      : effectivePreferences.endpointDelayMs)}ms
                  </span>
                  <span className="diagnosticItem">실시간 세션 한도: 300분</span>
                  <span className="diagnosticItem">입력 레벨: {inputLevel}</span>
                  <span className="diagnosticItem">입력 피크: {inputPeak}</span>
                  <span className="diagnosticItem">마이크 권한: {micPermissionState}</span>
                  <span className="diagnosticItem">
                    마이크 트랙: {micTrackState}
                    {micMuted ? " / muted" : ""}
                  </span>
                  {micLabel ? (
                    <span className="diagnosticItem">입력 장치: {micLabel}</span>
                  ) : audioInputDevices.length === 0 ? (
                    <span className="diagnosticItem">
                      입력 장치: 모바일 브라우저 기본 마이크 또는 권한 대기
                    </span>
                  ) : null}
                  <span className="diagnosticItem">
                    보안 컨텍스트: {secureContextState === "secure" ? "HTTPS/로컬허용" : secureContextState === "insecure" ? "비보안" : "확인 중"}
                  </span>
                  <span className="diagnosticItem">
                    브라우저 보조:{" "}
                    {supportsBrowserFallback === null
                      ? "확인 중"
                      : supportsBrowserFallback
                        ? "대기"
                        : "없음"}
                  </span>
                  {lastRealtimeError ? (
                    <span className="diagnosticItem diagnosticItemError">
                      마지막 오류: {lastRealtimeError}
                    </span>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </aside>

        <section className="workspaceSurface">
          <div className="workspaceHeader">
            <div>
              <p className="sectionEyebrow">작업 화면</p>
              <h3 className="sectionTitle workspaceTitle">
                {workspaceView === "live"
                  ? activeModeProfile.liveTitle
                  : workspaceView === "summary"
                    ? activeModeProfile.summaryHeaderLabel
                    : activeModeProfile.transcriptHeaderLabel}
              </h3>
              <p className="workspaceCopy">
                {workspaceView === "live"
                  ? activeModeProfile.liveCopy
                  : workspaceView === "summary"
                    ? activeModeProfile.summaryEmpty
                    : activeModeProfile.transcriptCopy}
              </p>
            </div>

            <div className="workspaceTabs" role="tablist" aria-label="녹음 작업 화면">
              <button
                type="button"
                className={
                  workspaceView === "live"
                    ? "workspaceTab workspaceTabActive"
                    : "workspaceTab"
                }
                onClick={() => setWorkspaceView("live")}
              >
                실시간 자막
              </button>
              <button
                type="button"
                className={
                  workspaceView === "summary"
                    ? "workspaceTab workspaceTabActive"
                    : "workspaceTab"
                }
                onClick={() => setWorkspaceView("summary")}
              >
                {activeModeProfile.summaryTabLabel}
              </button>
              <button
                type="button"
                className={
                  workspaceView === "transcript"
                    ? "workspaceTab workspaceTabActive"
                    : "workspaceTab"
                }
                onClick={() => openTranscriptWorkspace()}
              >
                {activeModeProfile.transcriptTabLabel}
              </button>
            </div>
          </div>

          <div className="workspaceBody">
            {workspaceView === "live" ? (
              <div className="workspaceCanvas">
                <div className="workspaceViewHeader">
                  <strong>{activeModeProfile.liveTitle}</strong>
                  <span>{transcriptText ? `${transcriptText.length}자` : "대기 중"}</span>
                </div>
                <div
                  ref={liveTranscriptScrollRef}
                  className="workspaceScroll transcriptFeed transcriptFeedPrimary"
                >
                  {displayLines.length === 0 ? (
                    <p className="emptyState workspaceEmpty">
                      {activeModeProfile.liveEmpty}
                    </p>
                  ) : null}

                  {displayLines.map((line) => {
                    const lineRange = getLineRange(line);

                    return (
                      <article
                        key={line.id}
                        className={
                          line.kind === "live"
                            ? "transcriptLine transcriptLineLive"
                            : "transcriptLine"
                        }
                      >
                        <div className="transcriptLineHeader">
                          {lineRange ? (
                            <span className="transcriptTag">
                              {buildJumpLabel(lineRange.startMs, lineRange.endMs)}
                            </span>
                          ) : null}
                          {line.language ? (
                            <span className="transcriptTag">{line.language.toUpperCase()}</span>
                          ) : null}
                          {line.translationText ? (
                            <span className="transcriptTag">번역 보조</span>
                          ) : null}
                        {line.kind === "live" ? (
                            <span className="transcriptTag">실시간</span>
                          ) : null}
                        </div>
                        <p className="transcriptText">
                          {line.tokens.length > 0 &&
                          line.tokens
                            .map((token) => token.text)
                            .join("")
                            .replace(/\s+/g, " ")
                            .trim() === line.text
                            ? line.tokens.map((token, index) => (
                                <span
                                  key={`${line.id}-${index}`}
                                  className={
                                    effectivePreferences.highlightLowConfidence &&
                                    token.confidence < 0.72
                                      ? "transcriptToken transcriptTokenLowConfidence"
                                      : "transcriptToken"
                                  }
                                >
                                  {token.text}
                                </span>
                              ))
                            : line.text}
                        </p>
                        {line.translationText ? (
                          <p className="transcriptTranslation">{line.translationText}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {workspaceView === "summary" ? (
              <div className="workspaceCanvas">
                <div className="workspaceViewHeader">
                  <strong>{activeModeProfile.summaryHeaderLabel}</strong>
                  <span>{summaryPreview ? `모델 ${summaryPreview.model}` : "대기 중"}</span>
                </div>

                {summaryPreview ? (
                  <div className="workspaceScroll summaryLayout">
	                    <section className="summaryHero">
	                      <p className="sectionEyebrow">핵심 요약</p>
	                      <div className="summaryLeadGroup">
	                        {splitUserFacingStoryParagraphs(
	                          isMeetingNotesV2(summaryPreview.notes)
	                            ? summaryPreview.notes.oneLineConclusion
	                            : summaryPreview.notes.summary
	                        ).map((paragraph) => (
	                          <p key={paragraph} className="summaryLead">
	                            {paragraph}
	                          </p>
	                        ))}
	                      </div>
	                    </section>

	                    {isMeetingNotesV2(summaryPreview.notes) &&
	                    summaryPreview.notes.reportSummary ? (
	                      <section className="summaryBlock">
	                        <strong>
	                          {cleanUserFacingText(summaryPreview.notes.reportSummary.title)}
	                        </strong>
	                        <div>
	                          <p className="sectionEyebrow">회의 배경</p>
	                          {splitUserFacingParagraphs(
	                            summaryPreview.notes.reportSummary.introduction
	                          ).map((paragraph) => (
	                            <p key={paragraph}>{paragraph}</p>
	                          ))}
	                        </div>
	                        <div>
	                          <p className="sectionEyebrow">핵심 내용</p>
	                          <ul className="compactList">
	                            {summaryPreview.notes.reportSummary.keyPoints.map((point) => (
	                              <li key={point}>{cleanUserFacingText(point)}</li>
	                            ))}
	                          </ul>
	                        </div>
	                        <div>
	                          <p className="sectionEyebrow">결론</p>
	                          {splitUserFacingParagraphs(
	                            summaryPreview.notes.reportSummary.conclusion
	                          ).map((paragraph) => (
	                            <p key={paragraph}>{paragraph}</p>
	                          ))}
	                        </div>
	                      </section>
	                    ) : null}

	                    {summaryPreview.notes.mode === "meeting" ? (
	                      <div className="summaryGrid">
                        <section className="summaryBlock">
                          <strong>결정</strong>
                          <ul className="compactList">
                            {summaryPreview.notes.decisions.map((item) => (
                              <li key={`decision-${item.decision}`}>
                                {cleanUserFacingText(item.decision)}
                              </li>
                            ))}
                          </ul>
                        </section>

                        <section className="summaryBlock">
                          <strong>액션 아이템</strong>
                          <ul className="compactList">
                            {summaryPreview.notes.actionItems.map((item) => (
                              <li key={`action-${item.task}`}>
                                {cleanUserFacingText(item.task)}
                                {item.owner ? ` · ${cleanUserFacingText(item.owner)}` : ""}
                                {item.dueDate ? ` · ${cleanUserFacingText(item.dueDate)}` : ""}
                              </li>
                            ))}
                          </ul>
                        </section>

                        {!isMeetingNotesV2(summaryPreview.notes) &&
                        summaryPreview.notes.openQuestions.length > 0 ? (
                          <section className="summaryBlock">
                            <strong>열린 질문</strong>
                            <ul className="compactList">
                              {summaryPreview.notes.openQuestions.map((item) => (
                                <li key={`question-${item}`}>{cleanUserFacingText(item)}</li>
                              ))}
                            </ul>
                          </section>
                        ) : null}

                        {!isMeetingNotesV2(summaryPreview.notes) &&
                        summaryPreview.notes.nextAgenda.length > 0 ? (
                          <section className="summaryBlock">
                            <strong>다음 안건</strong>
                            <ul className="compactList">
                              {summaryPreview.notes.nextAgenda.map((item) => (
                                <li key={`agenda-${item}`}>{cleanUserFacingText(item)}</li>
                              ))}
                            </ul>
                          </section>
                        ) : null}

                        {isMeetingNotesV2(summaryPreview.notes) &&
                        summaryPreview.notes.openIssues.length > 0 ? (
                          <section className="summaryBlock">
                            <strong>미결사항</strong>
                            <ul className="compactList">
                            {summaryPreview.notes.openIssues.map((item) => (
                              <li key={`issue-${item.content}`}>
                                  {cleanUserFacingText(item.content)}
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : null}

                        {isMeetingNotesV2(summaryPreview.notes) &&
                        summaryPreview.notes.risks.length > 0 ? (
                          <section className="summaryBlock">
                            <strong>리스크</strong>
                            <ul className="compactList">
                            {summaryPreview.notes.risks.map((item) => (
                              <li key={`risk-${item.content}`}>
                                  {cleanUserFacingText(item.content)}
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : null}
	                      </div>
	                    ) : null}

	                    {isMeetingNotesV2(summaryPreview.notes) ? (
	                      <section className="summaryBlock">
	                        <strong>주제별 요약</strong>
	                        <ul className="compactList">
	                          {getMeetingTopicReportSections(summaryPreview.notes).map((item) => (
	                            <li key={item.id}>
	                              {cleanUserFacingText(item.title)}
	                              <br />
	                              {cleanUserFacingText(item.discussion)}
	                              {item.outcome ? (
	                                <>
	                                  <br />
	                                  {`결과/남은 쟁점: ${cleanUserFacingText(item.outcome)}`}
	                                </>
	                              ) : null}
	                            </li>
	                          ))}
	                        </ul>
	                      </section>
	                    ) : null}

	                    {summaryPreview.notes.mode === "speech" ? (
                      <div className="summaryGrid">
                        <section className="summaryBlock">
                          <strong>핵심 메시지</strong>
                          <ul className="compactList">
                            {summaryPreview.notes.keyMessages.map((item) => (
                              <li key={`key-${item}`}>{cleanUserFacingText(item)}</li>
                            ))}
                          </ul>
                        </section>
                        <section className="summaryBlock">
                          <strong>인용 문장</strong>
                          <ul className="compactList">
                            {summaryPreview.notes.quotableLines.map((item) => (
                              <li key={`quote-${item}`}>{cleanUserFacingText(item)}</li>
                            ))}
                          </ul>
                        </section>
                      </div>
                    ) : null}

                    {summaryPreview.notes.mode === "interview" ? (
                      <div className="summaryGrid">
                        <section className="summaryBlock">
                          <strong>핵심 인사이트</strong>
                          <ul className="compactList">
                            {summaryPreview.notes.keyInsights.map((item) => (
                              <li key={`insight-${item}`}>{cleanUserFacingText(item)}</li>
                            ))}
                          </ul>
                        </section>
                        <section className="summaryBlock">
                          <strong>후속 질문</strong>
                          <ul className="compactList">
                            {summaryPreview.notes.followUpQuestions.map((item) => (
                              <li key={`follow-${item}`}>{cleanUserFacingText(item)}</li>
                            ))}
                          </ul>
                        </section>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="emptyState workspaceEmpty">
                    {activeModeProfile.summaryEmpty}
                  </p>
                )}
              </div>
            ) : null}

            {workspaceView === "transcript" ? (
              <div className="workspaceCanvas">
                <div className="workspaceViewHeader">
                  <strong>{activeModeProfile.transcriptHeaderLabel}</strong>
                  <span>{effectiveTranscript ? `${effectiveTranscript.length}자` : "대기 중"}</span>
                </div>
                <div className="workspaceScroll transcriptEditorPanel">
                  <p className="workspaceCopy">
                    {activeModeProfile.transcriptCopy}
                  </p>
                  <label className="fieldGroup">
                    <span className="fieldLabel">대화 기록</span>
                    <textarea
                      className="textField transcriptEditor"
                      value={editedTranscript}
                      onChange={(event) => setEditedTranscript(event.target.value)}
                      rows={18}
                    />
                  </label>
                  <div className="buttonRow">
                    <button
                      type="button"
                      className="ghostButton"
                      onClick={() => void generateSummaryPreview()}
                      disabled={summaryPending || editedTranscript.replace(/\s+/g, "").length < 20}
                    >
                      {summaryPending ? "정리 중" : `수정본으로 ${activeModeProfile.summaryActionLabel}`}
                    </button>
                    <button
                      type="button"
                      className="ghostButton ghostButtonSecondary"
                      onClick={() =>
                        setEditedTranscript(
                          buildTranscriptText([
                            ...transcriptLinesRef.current,
                            ...liveLinesRef.current,
                            ...browserLinesRef.current
                          ])
                        )
                      }
                    >
                      원본 다시 불러오기
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>

      </div>
    </section>
  );
}
