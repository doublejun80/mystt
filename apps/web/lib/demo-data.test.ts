import { describe, expect, it } from "vitest";

import { createSessionRecord, type SessionRecord } from "@mystt/audio-core";

import type { MeetingNotesV2Record } from "./api";
import { decorateSessionRecord } from "./demo-data";

function buildSession(title: string): SessionRecord {
  return {
    ...createSessionRecord({
      id: "session_1",
      mode: "meeting",
      title,
      languageHints: ["ko"],
      localAudioPath: "",
      startedAt: "2026-05-23T00:00:00.000Z"
    }),
    status: "completed",
    artifacts: []
  };
}

function buildNotes(): MeetingNotesV2Record {
  return {
    schemaVersion: "meeting_notes_v2",
    mode: "meeting",
    title: "빠른 녹음 2026. 5. 23. 오후 7:12:30",
    summary: "변경계약 협상 내용을 정리했다.",
    templateType: "purchase_review",
    oneLineConclusion: "변경계약 협상 조건과 구매 절차를 확인했다.",
    executiveSummary: [
      "변경계약 범위를 확인했다.",
      "견적 요청 흐름을 점검했다.",
      "BP 평가 기준을 논의했다.",
      "구매오더 이후 전자서명을 진행하기로 했다.",
      "확인 필요 항목을 남겼다."
    ],
    detailedSummary: "변경계약 협상 조건과 구매 절차를 중심으로 논의했다.",
    reportSummary: {
      title: "고객사 변경계약 협상 회의",
      introduction: "변경계약 범위와 구매 절차를 점검하기 위한 회의였다.",
      keyPoints: [
        "견적 요청과 등록 흐름을 확인했다.",
        "BP 평가와 구매 결재 절차를 논의했다.",
        "전자서명 전 확인 사항을 정리했다."
      ],
      conclusion: "변경계약 진행 전 확인 사항을 마무리해야 한다."
    },
    keywords: ["변경계약", "견적", "구매"],
    topicTimeline: null,
    topicSummaries: [],
    decisions: [],
    actionItems: [],
    openIssues: [],
    risks: [],
    reviewFlags: [],
    reportMarkdown: "## 한 줄 결론\n변경계약 협상 조건을 정리했다."
  };
}

describe("decorateSessionRecord", () => {
  it("shows generated report titles for existing sessions with automatic recording titles", () => {
    const decorated = decorateSessionRecord(
      buildSession("빠른 녹음 2026. 5. 23. 오후 7:12:30"),
      buildNotes()
    );

    expect(decorated.title).toBe("고객사 변경계약 협상 회의");
  });

  it("keeps manually edited titles even when notes have a report title", () => {
    const decorated = decorateSessionRecord(
      buildSession("사용자가 입력한 제목"),
      buildNotes()
    );

    expect(decorated.title).toBe("사용자가 입력한 제목");
  });
});
