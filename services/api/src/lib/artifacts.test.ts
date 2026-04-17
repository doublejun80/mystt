import { describe, expect, it } from "vitest";

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
            text: "hello world"
          }
        ]
      }
    });

    expect(markdown).toContain("# Launch Sync");
    expect(markdown).toContain("[00:00-00:05] Mina: hello world");
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
});
