const seoulLocale = "ko-KR";
const seoulTimeZone = "Asia/Seoul";

const auditKindLabels: Record<string, string> = {
  "session.created": "세션 생성",
  "session.status.updated": "상태 변경",
  "session.process.enqueued": "처리 대기열 등록",
  "session.process.started": "처리 시작",
  "session.process.finished": "처리 완료",
  "session.process.failed": "처리 실패",
  "source_audio.staged": "원본 오디오 저장",
  "source_audio.stage_failed": "원본 오디오 저장 실패",
  "transcription.metadata.updated": "전사 메타데이터 갱신",
  "transcript.artifacts.saved": "전사 아티팩트 저장",
  "transcript.text.cached": "전사 텍스트 캐시",
  "notes.artifacts.saved": "노트 아티팩트 저장",
  "soniox.webhook.received": "Soniox 웹훅 수신",
  "soniox.webhook.duplicate": "중복 웹훅 무시",
  "soniox.webhook.unmatched": "미매칭 웹훅 수신"
};

const auditPayloadKeyLabels: Record<string, string> = {
  accepted: "동기 완료",
  audioUrl: "오디오 URL",
  byteLength: "바이트 길이",
  fileId: "파일 ID",
  fileName: "파일명",
  from: "이전 상태",
  jobId: "작업 ID",
  location: "저장 위치",
  mode: "모드",
  model: "모델",
  notesDocxPath: "DOCX 경로",
  queueDepth: "큐 깊이",
  readyArtifacts: "준비 아티팩트",
  segmentCount: "세그먼트 수",
  source: "입력 소스",
  sourceUrl: "원본 URL",
  status: "상태",
  textLength: "텍스트 길이",
  title: "제목",
  to: "변경 후"
};

const runtimeModeLabels: Record<string, string> = {
  remote: "원격",
  disabled: "비활성",
  "local-fallback": "로컬 대체",
  "inline-fallback": "인라인 대체"
};

const sessionStatusValueLabels: Record<string, string> = {
  draft: "초안",
  recording: "녹음 중",
  paused: "일시정지",
  uploading: "업로드 중",
  transcribing: "전사 중",
  summarizing: "요약 중",
  emailing: "메일 준비 중",
  completed: "완료",
  failed: "실패",
  queued: "대기 중",
  processing: "처리 중",
  error: "오류"
};

const sessionModeValueLabels: Record<string, string> = {
  meeting: "회의",
  speech: "발표",
  interview: "인터뷰",
  audio_url: "오디오 URL",
  file_id: "파일 ID"
};

function formatAuditValue(key: string, value: unknown) {
  if (typeof value !== "string") {
    return String(value);
  }

  if (key === "status" || key === "from" || key === "to") {
    return sessionStatusValueLabels[value] ?? value;
  }

  if (key === "mode" || key === "source") {
    return sessionModeValueLabels[value] ?? value;
  }

  return value;
}

export function formatKoreanDateTime(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = new Intl.DateTimeFormat(seoulLocale, {
    timeZone: seoulTimeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}. ${values.month}. ${values.day}. ${values.dayPeriod ?? ""} ${values.hour}:${values.minute}:${values.second}`.trim();
}

export function formatKoreanTime(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = new Intl.DateTimeFormat(seoulLocale, {
    timeZone: seoulTimeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.dayPeriod ?? ""} ${values.hour}:${values.minute}:${values.second}`.trim();
}

export function formatKoreanCompactDateTime(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = new Intl.DateTimeFormat(seoulLocale, {
    timeZone: seoulTimeZone,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.month}/${values.day} ${values.dayPeriod ?? ""} ${values.hour}:${values.minute}`.trim();
}

export function formatDurationClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function formatAuditLabel(kind: string) {
  return auditKindLabels[kind] ?? kind.replaceAll(".", " / ").replaceAll("_", " ");
}

export function formatRuntimeMode(mode?: string | null) {
  if (!mode) {
    return "알 수 없음";
  }

  return runtimeModeLabels[mode] ?? mode;
}

export function buildAuditPayloadPreview(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).slice(0, 2);

  if (entries.length === 0) {
    return "세부 정보 없음";
  }

  return entries
    .map(([key, value]) => `${auditPayloadKeyLabels[key] ?? key}: ${formatAuditValue(key, value)}`)
    .join(" · ");
}
