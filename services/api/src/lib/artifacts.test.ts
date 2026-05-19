import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSessionRecord } from "@mystt/audio-core";

import {
  renderCleanTranscriptMarkdown,
  renderSessionNotesDocx,
  renderEmailPreviewHtml,
  renderSessionNotesHtml
} from "./artifacts";

describe("artifact renderers", () => {
  const session = createSessionRecord({
    id: "sess_test",
    title: "Launch Sync",
    mode: "meeting"
  });

  it("renders transcript markdown", () => {
    const markdown = renderCleanTranscriptMarkdown({
      session,
      transcript: {
        sessionId: session.id,
        mode: "meeting",
        text: "hello world",
        durationMs: 5_000,
        speakers: ["Mina"],
        lowConfidenceMoments: [],
        segments: [
          {
            id: "seg_1",
            speaker: "Mina",
            startMs: 0,
            endMs: 5_000,
            text: "발 송 해 주 었 죠. B J 는 2 0 0 8 년"
          }
        ]
      }
    });

    expect(markdown).toContain("# Launch Sync");
    expect(markdown).toContain("[00:00-00:05] 발송해주었죠. BJ는 2008년");
    expect(markdown).not.toContain("발 송");
  });

  it("renders notes, docx, and email html", async () => {
    const notes = {
      mode: "meeting" as const,
      title: "Launch Sync",
      summary: "We locked the launch plan.",
      decisions: [
        {
          decision: "Launch on Friday",
          rationale: null,
          evidence: {
            speaker: "Mina",
            quote: "Let's launch Friday",
            timestampRange: "00:10-00:15"
          }
        }
      ],
      actionItems: [
        {
          task: "Prepare QA list",
          owner: "Alex",
          dueDate: "2026-04-10",
          evidence: {
            speaker: "Alex",
            quote: "I'll send the QA list",
            timestampRange: "00:20-00:24"
          }
        }
      ],
      risks: [],
      openQuestions: [],
      nextAgenda: [],
      speakerHighlights: []
    };

    expect(renderSessionNotesHtml({ session, notes })).toContain("Launch on Friday");
    expect(renderEmailPreviewHtml({ session, notes })).toContain("Prepare QA list");
    const docx = await renderSessionNotesDocx({ session, notes });
    expect(docx.byteLength).toBeGreaterThan(1000);
    expect(docx.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("renders v2 meeting notes as report-ready HTML and DOCX artifacts", async () => {
    const notes = {
      schemaVersion: "meeting_notes_v2" as const,
      mode: "meeting" as const,
      templateType: "purchase_review" as const,
      title: "구매 검토 회의",
      summary: "예산과 도입 일정을 중심으로 구매 타당성을 검토했다.",
      oneLineConclusion:
        "null:: 구매는 추진하되 보안 검토와 예산 승인 확인이 필요하다.",
      executiveSummary: [
        "구매 필요성은 대체로 확인되었다.",
        "예산 승인 상태는 추가 확인이 필요하다.",
        "보안 검토가 계약 전 선행되어야 한다.",
        "파일럿 일정은 다음 주 초안 공유가 필요하다.",
        "담당자와 기한 일부는 명확하지 않다."
      ],
      detailedSummary:
        "이번 구매 검토 회의에서는 신규 도구 도입 필요성과 예산, 보안 검토, 파일럿 일정을 함께 논의했다. 참석자들은 도입 필요성에는 공감했으나 예산 승인 상태와 보안 검토 완료 여부가 계약 진행의 주요 조건이라고 보았다.",
      reportSummary: {
        title: "구매 추진 조건과 선행 확인 사항",
        introduction:
          "이번 회의는 신규 도구 구매 필요성과 계약 전 선행 조건을 검토하기 위해 진행되었다.",
        keyPoints: [
          "null:: 00:00-00:05 근거: seg_0001 도구 도입 필요성은 확인되었지만 예산 승인 상태는 추가 확인이 필요하다.",
          "보안 검토는 계약 전에 완료되어야 하는 핵심 조건으로 논의되었다.",
          "파일럿 일정은 다음 주 초안 공유 후 다시 조정하기로 했다."
        ],
        conclusion:
          "구매는 추진하되 보안 검토와 예산 승인 확인을 먼저 마무리해야 한다."
      },
      keywords: ["구매", "예산", "보안 검토", "파일럿"],
      topicTimeline: [
        {
          timelineId: "timeline_001",
          startMs: 0,
          endMs: 42_000,
          title: "구매 필요성과 승인 조건",
          discussion:
            "도구 도입 필요성, 예산 승인 상태, 보안 검토 필요성을 차례로 논의했다.",
          outcome: "구매는 추진하되 보안 검토와 예산 확인을 선행한다.",
          relatedSpeakers: ["1", "2"],
          evidenceRefs: [
            {
              segmentId: "seg_0001",
              startMs: 0,
              endMs: 12_000,
              speaker: "1",
              quote: "구매는 추진하되 보안 검토가 필요합니다."
            }
          ]
        }
      ],
      topicSummaries: [
        {
          topicId: "topic_001",
          title: "구매 필요성과 승인 조건",
          startMs: 0,
          endMs: 42_000,
          summaryBullets: [
            "도입 필요성은 확인되었다.",
            "예산 승인과 보안 검토가 선행 조건이다."
          ],
          relatedSpeakers: ["1", "2"],
          importance: "high" as const,
          evidenceRefs: [
            {
              segmentId: "seg_0001",
              startMs: 0,
              endMs: 12_000,
              speaker: "1",
              quote: "구매는 추진하되 보안 검토가 필요합니다."
            }
          ]
        }
      ],
      decisions: [
        {
          decision: "보안 검토 완료 후 구매를 계속 검토한다.",
          rationale: "계약 전 보안 리스크를 먼저 확인해야 한다.",
          status: "confirmed" as const,
          decidedBy: "Mina",
          evidence: {
            speaker: "1",
            quote: "보안 검토가 필요합니다.",
            timestampRange: "00:00-00:12"
          },
          evidenceRefs: [
            {
              segmentId: "seg_0001",
              startMs: 0,
              endMs: 12_000,
              speaker: "1",
              quote: "보안 검토가 필요합니다."
            }
          ]
        }
      ],
      actionItems: [
        {
          task: "보안 검토 체크리스트 공유",
          owner: "Alex",
          dueDate: ":null",
          ownerStatus: "explicit" as const,
          dueStatus: "needs_confirmation" as const,
          priority: "high" as const,
          status: "todo" as const,
          evidence: {
            speaker: "2",
            quote: "체크리스트는 제가 공유하겠습니다.",
            timestampRange: "00:20-00:28"
          },
          evidenceRefs: [
            {
              segmentId: "seg_0002",
              startMs: 20_000,
              endMs: 28_000,
              speaker: "2",
              quote: "체크리스트는 제가 공유하겠습니다."
            }
          ]
        }
      ],
      openIssues: [
        {
          content: "예산 승인자가 명확하지 않다.",
          issueType: "approval_owner_unclear",
          severity: "medium" as const,
          suggestedNextAction: "구매 요청서 승인 라인을 확인한다.",
          evidenceRefs: [
            {
              segmentId: "seg_0003",
              startMs: 30_000,
              endMs: 36_000,
              speaker: "1",
              quote: "승인 라인은 다시 확인해야 합니다."
            }
          ]
        }
      ],
      risks: [
        {
          content: "보안 검토가 늦어지면 구매 일정이 밀릴 수 있다.",
          riskType: "schedule",
          severity: "high" as const,
          mitigation: "보안팀 검토 일정을 먼저 확보한다.",
          evidenceRefs: [
            {
              segmentId: "seg_0004",
              startMs: 36_000,
              endMs: 42_000,
              speaker: "2",
              quote: "보안팀 일정이 늦으면 계약도 밀립니다."
            }
          ]
        }
      ],
      reviewFlags: [
        {
          flagType: "needs_confirmation",
          message:
            "severity=medium priority: high seg_0002의 conf=0.41 lang=ko 보안 체크리스트 공유 기한이 명시되지 않아 확인이 필요하다. [evidence: , ] [evidenceRefs: seg_0002]",
          severity: "medium" as const,
          relatedSegmentIds: ["seg_0002"]
        }
      ],
      reportMarkdown: "## 한 줄 결론\n구매는 추진하되 보안 검토와 예산 승인이 필요합니다."
    };

    const html = renderSessionNotesHtml({ session, notes });
    expect(html).toContain("한 줄 결론");
    expect(html).toContain("회의 배경");
    expect(html).toContain("핵심 내용");
    expect(html).toContain("주제 흐름");
    expect(html).toContain("구매는 추진하되 보안 검토");
    expect(html).toContain("주제별 요약");
    expect(html).not.toContain("시간대별");
    expect(html).not.toContain("00:00-00:42");
    expect(html).not.toContain("00:00-00:05");
    expect(html).not.toContain("00:00-00:12");
    expect(html).not.toContain("00:20-00:28");
    expect(html).not.toContain("근거:");
    expect(html).not.toContain("원문 근거");
    expect(html).not.toContain("보안팀 일정이 늦으면 계약도 밀립니다.");
    expect(html).not.toContain("seg_0001");
    expect(html).not.toContain("seg_0002");
    expect(html).not.toContain("seg_0003");
    expect(html).not.toContain("seg_0004");
    expect(html).not.toContain("conf=");
    expect(html).not.toContain("lang=");
    expect(html).not.toContain("evidence:");
    expect(html).not.toContain("null::");
    expect(html).not.toContain(":null");
    expect(html).not.toContain("관련 화자");
    expect(html).not.toContain("Priority:");
    expect(html).not.toContain("severity=");
    expect(html).not.toContain("priority:");
    expect(html).not.toContain(">high<");
    expect(html).not.toContain(">medium<");
    expect(renderEmailPreviewHtml({ session, notes })).toContain("보안 검토 체크리스트 공유");
    expect(renderEmailPreviewHtml({ session, notes })).not.toContain("null::");
    expect(renderEmailPreviewHtml({ session, notes })).not.toContain(":null");
    const docx = await renderSessionNotesDocx({ session, notes });
    expect(docx.byteLength).toBeGreaterThan(1000);
    expect(docx.subarray(0, 2).toString("utf8")).toBe("PK");
    const tempDir = mkdtempSync(join(tmpdir(), "mystt-notes-"));
    try {
      const docxPath = join(tempDir, "notes.docx");
      writeFileSync(docxPath, docx);
      const documentXml = execFileSync("unzip", ["-p", docxPath, "word/document.xml"], {
        encoding: "utf8"
      });

      expect(documentXml).not.toContain("관련 화자");
      expect(documentXml).not.toContain("시간대별");
      expect(documentXml).not.toContain("00:00-00:42");
      expect(documentXml).not.toContain("00:00-00:05");
      expect(documentXml).not.toContain("00:00-00:12");
      expect(documentXml).not.toContain("00:20-00:28");
      expect(documentXml).not.toContain("근거:");
      expect(documentXml).not.toContain("원문 근거");
      expect(documentXml).not.toContain("보안팀 일정이 늦으면 계약도 밀립니다.");
      expect(documentXml).not.toContain("Priority:");
      expect(documentXml).not.toContain("severity=");
      expect(documentXml).not.toContain("priority:");
      expect(documentXml).not.toContain(">high<");
      expect(documentXml).not.toContain(">medium<");
      expect(documentXml).not.toContain("| 1 |");
      expect(documentXml).not.toContain("| 2 |");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
