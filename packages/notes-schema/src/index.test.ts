import { describe, expect, it } from "vitest";

import { getNotesPrompt, getNotesSchemaForMode } from "./index";

describe("notes-schema", () => {
  it("parses meeting notes", () => {
    const parsed = getNotesSchemaForMode("meeting").parse({
      mode: "meeting",
      title: "런칭 회의",
      summary: "핵심 일정과 오너를 정리했다.",
      decisions: [
        {
          decision: "4월 30일 출시",
          rationale: null,
          evidence: {
            speaker: "Mina",
            quote: "4월 30일로 갑시다",
            timestampRange: "12:10-12:18"
          }
        }
      ],
      actionItems: [],
      risks: [],
      openQuestions: [],
      nextAgenda: [],
      speakerHighlights: []
    });

    expect(parsed.mode).toBe("meeting");
  });

  it("builds a strict prompt", () => {
    expect(getNotesPrompt("meeting")).toContain("Return valid JSON only.");
  });
});

