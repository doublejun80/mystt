import { describe, expect, it } from "vitest";

import { formatTranscriptForNotesPrompt } from "./openai";

describe("formatTranscriptForNotesPrompt", () => {
  it("includes segment id, time range, speaker, confidence, and language", () => {
    const promptTranscript = formatTranscriptForNotesPrompt({
      sessionId: "sess_1",
      mode: "meeting",
      text: "이번 구매 검토는 예산과 도입 일정 중심으로 보겠습니다.",
      durationMs: 12_000,
      speakers: ["Speaker 1"],
      lowConfidenceMoments: [],
      segments: [
        {
          id: "seg_0001",
          startMs: 0,
          endMs: 12_000,
          speaker: "Speaker 1",
          language: "ko",
          confidence: 0.91,
          text: "이번 구매 검토는 예산과 도입 일정 중심으로 보겠습니다."
        }
      ]
    });

    expect(promptTranscript).toContain(
      "[seg_0001 | 00:00-00:12 | Speaker 1 | conf=0.91 | lang=ko]"
    );
    expect(promptTranscript).toContain("이번 구매 검토는 예산과 도입 일정 중심으로 보겠습니다.");
  });
});
