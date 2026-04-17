import { describe, expect, it } from "vitest";

import { normalizeSonioxTranscript } from "./index";

describe("transcript-normalizer", () => {
  it("normalizes segments and low-confidence tokens", () => {
    const transcript = normalizeSonioxTranscript({
      mode: "meeting",
      transcript: {
        transcriptionId: "tx_1",
        sessionId: "sess_1",
        languageHints: ["ko", "en"],
        segments: [
          {
            id: "seg_1",
            speaker: "Mina",
            startMs: 0,
            endMs: 1_500,
            text: "다음 주 런칭 일정 확정합시다",
            tokens: [
              {
                text: "다음",
                startMs: 0,
                endMs: 400,
                confidence: 0.95
              },
              {
                text: "런칭",
                startMs: 400,
                endMs: 800,
                confidence: 0.6
              }
            ]
          }
        ]
      }
    });

    expect(transcript.speakers).toEqual(["Mina"]);
    expect(transcript.lowConfidenceMoments).toHaveLength(1);
  });
});

