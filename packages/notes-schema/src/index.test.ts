import { describe, expect, it } from "vitest";

import {
  getNotesPrompt,
  getNotesSchemaForMode,
  type MeetingNotesV2
} from "./index";

describe("notes-schema", () => {
  it("parses meeting_notes_v2 with unclear and needs_confirmation states", () => {
    const parsed = getNotesSchemaForMode("meeting").parse({
      schemaVersion: "meeting_notes_v2",
      mode: "meeting",
      templateType: "purchase_review",
      title: "런칭 회의",
      summary: "핵심 일정과 오너를 정리했다.",
      oneLineConclusion: "출시 일정은 유지하되 QA 리스크 확인이 필요하다.",
      executiveSummary: [
        "4월 30일 출시 목표는 유지한다.",
        "QA 범위는 결제와 로그인 회귀 테스트를 우선한다.",
        "디자인 잔여 이슈는 이번 주 내 확인한다.",
        "운영 공지는 출시 전날 배포한다.",
        "일부 담당자와 기한은 추가 확인이 필요하다."
      ],
      detailedSummary:
        "이번 회의에서는 4월 말 출시 일정을 기준으로 QA 범위, 운영 공지, 디자인 잔여 이슈를 점검했다. 출시일 자체는 유지하는 방향이나 결제 회귀 테스트 범위와 담당자 확정이 필요하다는 점이 확인되었다.",
      reportSummary: {
        title: "출시 일정 유지와 QA 리스크 관리",
        introduction:
          "이번 회의는 4월 말 출시 목표를 기준으로 QA 범위와 운영 준비 상태를 점검하기 위해 진행되었다.",
        keyPoints: [
          "출시 일정은 유지하되 결제와 로그인 회귀 테스트를 우선 검증한다.",
          "디자인 잔여 이슈와 운영 공지는 출시 전 확인이 필요하다.",
          "담당자와 기한이 명확하지 않은 항목은 별도 확인해야 한다."
        ],
        conclusion:
          "출시 방향은 유지하되 QA 범위와 담당자 확인을 선행해야 한다."
      },
      keywords: ["출시", "QA", "결제", "운영 공지"],
      topicTimeline: [
        {
          timelineId: "timeline_001",
          startMs: 0,
          endMs: 38_000,
          title: "출시 일정과 QA 범위",
          discussion:
            "출시일 유지 여부와 결제, 로그인 회귀 테스트를 중심으로 QA 범위를 논의했다.",
          outcome: "4월 30일 출시 목표는 유지하고 QA 범위를 추가 확인한다.",
          relatedSpeakers: ["Mina", "Alex"],
          evidenceRefs: [
            {
              segmentId: "seg_0001",
              startMs: 0,
              endMs: 12_000,
              speaker: "Mina",
              quote: "4월 30일 일정은 유지하는 것으로 보겠습니다."
            }
          ]
        }
      ],
      topicSummaries: [
        {
          topicId: "topic_001",
          title: "출시 일정과 QA 범위",
          startMs: 0,
          endMs: 38_000,
          summaryBullets: [
            "출시일은 4월 30일을 기준으로 유지한다.",
            "QA는 결제와 로그인 회귀 테스트를 우선한다."
          ],
          relatedSpeakers: ["Mina", "Alex"],
          importance: "high",
          evidenceRefs: [
            {
              segmentId: "seg_0001",
              startMs: 0,
              endMs: 12_000,
              speaker: "Mina",
              quote: "4월 30일 일정은 유지하는 것으로 보겠습니다."
            }
          ]
        }
      ],
      decisions: [
        {
          decision: "4월 30일 출시",
          rationale: null,
          status: "unclear",
          decidedBy: null,
          evidence: {
            speaker: "Mina",
            quote: "4월 30일로 갑시다",
            timestampRange: "12:10-12:18"
          },
          evidenceRefs: [
            {
              segmentId: "seg_0001",
              startMs: 0,
              endMs: 12_000,
              speaker: "Mina",
              quote: "4월 30일 일정은 유지"
            }
          ]
        }
      ],
      actionItems: [
        {
          task: "결제 회귀 테스트 범위 확인",
          owner: null,
          dueDate: null,
          ownerStatus: "needs_confirmation",
          dueStatus: "needs_confirmation",
          priority: "high",
          status: "needs_confirmation",
          evidence: {
            speaker: "Alex",
            quote: "결제 쪽은 범위를 다시 봐야 합니다",
            timestampRange: "12:20-12:24"
          },
          evidenceRefs: [
            {
              segmentId: "seg_0002",
              startMs: 20_000,
              endMs: 24_000,
              speaker: "Alex",
              quote: "결제 쪽은 범위를 다시 봐야 합니다"
            }
          ]
        }
      ],
      openIssues: [
        {
          content: "결제 회귀 테스트 담당자가 명확하지 않다.",
          issueType: "owner_unclear",
          severity: "medium",
          suggestedNextAction: "QA 리드에게 담당자를 확인한다.",
          evidenceRefs: [
            {
              segmentId: "seg_0002",
              startMs: 20_000,
              endMs: 24_000,
              speaker: "Alex",
              quote: "범위를 다시 봐야 합니다"
            }
          ]
        }
      ],
      risks: [
        {
          content: "결제 회귀 테스트 범위가 늦게 확정되면 출시 검증이 지연될 수 있다.",
          riskType: "schedule",
          severity: "medium",
          mitigation: "QA 범위를 당일 확정하고 체크리스트로 관리한다.",
          evidenceRefs: [
            {
              segmentId: "seg_0002",
              startMs: 20_000,
              endMs: 24_000,
              speaker: "Alex",
              quote: "결제 쪽은 범위를 다시 봐야 합니다"
            }
          ]
        }
      ],
      reviewFlags: [
        {
          flagType: "low_confidence",
          message: "결제 범위 관련 발화 신뢰도가 낮아 확인이 필요하다.",
          severity: "medium",
          relatedSegmentIds: ["seg_0002"]
        }
      ],
      reportMarkdown: "## 회의 결론\n출시 일정은 유지하되 QA 범위 확인이 필요합니다."
    }) as MeetingNotesV2;

    expect(parsed.schemaVersion).toBe("meeting_notes_v2");
    expect((parsed as any).reportSummary.title).toBe(
      "출시 일정 유지와 QA 리스크 관리"
    );
    expect((parsed as any).topicTimeline[0]?.title).toBe("출시 일정과 QA 범위");
    expect(parsed.decisions[0]?.status).toBe("unclear");
    expect(parsed.actionItems[0]?.ownerStatus).toBe("needs_confirmation");
  });

  it("builds a strict v2 prompt", () => {
    expect(getNotesPrompt("meeting")).toContain("Return valid JSON only.");
    expect(getNotesPrompt("meeting")).toContain("meeting_notes_v2");
    expect(getNotesPrompt("meeting")).toContain("needs_confirmation");
    expect(getNotesPrompt("meeting")).toContain("segment id");
    expect(getNotesPrompt("meeting")).toContain("reportSummary");
    expect(getNotesPrompt("meeting")).toContain("topicTimeline");
    expect(getNotesPrompt("meeting")).toContain("Do not include raw segment ids");
    expect(getNotesPrompt("meeting")).toContain(
      "Keep timestamps and evidence quotes only in JSON metadata fields"
    );
    expect(getNotesPrompt("meeting")).toContain("Do not write literal null");
  });
});
