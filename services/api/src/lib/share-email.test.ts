import { describe, expect, it } from "vitest";

import { createSessionRecord } from "@mystt/audio-core";

import { buildShareEmailDraft } from "./share-email";

describe("buildShareEmailDraft", () => {
  it("removes internal null and evidence markers from mail summaries", async () => {
    const session = {
      ...createSessionRecord({
        id: "sess_mail_cleanup",
        title: "메일 정리",
        mode: "meeting",
        startedAt: "2026-05-10T00:00:00.000Z"
      }),
      status: "completed" as const
    };
    const draft = await buildShareEmailDraft({
      portalBaseUrl: "https://mystt.example",
      selection: {
        includeSummary: true,
        includeDetails: false,
        includeAudio: false
      },
      snapshot: {
        session,
        notes: {
          model: "gpt-5.4-mini",
          createdAt: "2026-05-10T00:01:00.000Z",
          notes: {
            mode: "meeting" as const,
            title: "메일 정리",
            summary:
              "severity=high priority: medium null:: 00:00-00:05 근거: seg_0001 결론은 일정 유지입니다. [evidence: , ] []",
            decisions: [
              {
                decision:
                  "undefined:: evidence_refs: seg_0001 00:06-00:09 출시 일정은 유지한다. [evidenceRefs: seg_0001]",
                rationale: null,
                evidence: {
                  speaker: null,
                  quote: "일정은 유지합니다.",
                  timestampRange: "00:00-00:05"
                }
              }
            ],
            actionItems: [
              {
                task: "후속 일정 확인",
                owner: "Mina",
                dueDate: ":null",
                evidence: {
                  speaker: null,
                  quote: "일정은 다시 보죠.",
                  timestampRange: "00:06-00:09"
                }
              }
            ],
            risks: [],
            openQuestions: [],
            nextAgenda: [],
            speakerHighlights: []
          }
        }
      }
    });

    expect(draft.text).toContain("결론은 일정 유지입니다.");
    expect(draft.text).toContain("출시 일정은 유지한다.");
    expect(draft.text).not.toContain("null::");
    expect(draft.text).not.toContain("undefined::");
    expect(draft.text).not.toContain(":null");
    expect(draft.text).not.toContain("00:00-00:05");
    expect(draft.text).not.toContain("00:06-00:09");
    expect(draft.text).not.toContain("근거:");
    expect(draft.text).not.toContain("evidence");
    expect(draft.text).not.toContain("severity");
    expect(draft.text).not.toContain("priority");
    expect(draft.text).not.toContain("[]");
    expect(draft.html).not.toContain("null::");
    expect(draft.html).not.toContain("00:00-00:05");
    expect(draft.html).not.toContain("00:06-00:09");
    expect(draft.html).not.toContain("근거:");
    expect(draft.html).not.toContain("evidence");
    expect(draft.html).not.toContain("severity");
    expect(draft.html).not.toContain("priority");
  });

  it("uses the v2 one-line conclusion as the share email summary lead", async () => {
    const session = {
      ...createSessionRecord({
        id: "sess_mail_v2",
        title: "메일 v2",
        mode: "meeting",
        startedAt: "2026-05-10T00:00:00.000Z"
      }),
      status: "completed" as const
    };
    const draft = await buildShareEmailDraft({
      portalBaseUrl: "https://mystt.example",
      selection: {
        includeSummary: true,
        includeDetails: false,
        includeAudio: false
      },
      snapshot: {
        session,
        notes: {
          model: "gpt-5.4-mini",
          createdAt: "2026-05-10T00:01:00.000Z",
          notes: {
            schemaVersion: "meeting_notes_v2",
            mode: "meeting",
            templateType: "general_meeting",
            title: "메일 v2",
            summary: "구버전 요약 문장",
            oneLineConclusion: "최신 한 줄 결론",
            executiveSummary: [],
            detailedSummary: "",
            reportSummary: null,
            keywords: [],
            topicTimeline: [],
            topicSummaries: [],
            decisions: [],
            actionItems: [],
            openIssues: [],
            risks: [],
            reviewFlags: [],
            reportMarkdown: ""
          } as never
        }
      }
    });

    expect(draft.text).toContain("최신 한 줄 결론");
    expect(draft.text).not.toContain("구버전 요약 문장");
  });
});
