import type { SessionMode, SessionStatus } from "@mystt/audio-core";

export const colorTokens = {
  ink: "#10231d",
  paper: "#f5f0e6",
  surface: "#fffaf2",
  line: "#d7c8b3",
  accent: "#e86a33",
  accentSoft: "#ffe1c8",
  moss: "#5f7a61",
  plum: "#6d425d"
} as const;

export const modeLabels: Record<SessionMode, string> = {
  meeting: "회의",
  speech: "발표",
  interview: "인터뷰"
};

export const statusLabels: Record<SessionStatus, string> = {
  draft: "초안",
  recording: "녹음 중",
  paused: "일시정지",
  uploading: "업로드 중",
  transcribing: "전사 중",
  summarizing: "요약 중",
  emailing: "메일 준비 중",
  completed: "완료",
  failed: "실패"
};

export function statusTone(status: SessionStatus): "warm" | "cool" | "alert" {
  if (status === "failed") {
    return "alert";
  }

  if (status === "completed") {
    return "cool";
  }

  return "warm";
}
