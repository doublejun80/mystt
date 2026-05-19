import { describe, expect, it } from "vitest";

import {
  normalizeSonioxTranscript,
  restoreReadableTranscriptSpacing
} from "./index";

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

  it("groups Soniox tokens into stable readable meeting segments", () => {
    const transcript = normalizeSonioxTranscript({
      mode: "meeting",
      lowConfidenceThreshold: 0.75,
      transcript: {
        transcriptionId: "tx_1",
        sessionId: "sess_1",
        languageHints: ["ko", "en"],
        segments: [],
        tokens: [
          {
            text: "이번",
            startMs: 0,
            endMs: 300,
            speaker: "Speaker 1",
            language: "ko",
            confidence: 0.9
          },
          {
            text: "구매",
            startMs: 320,
            endMs: 620,
            speaker: "Speaker 1",
            language: "ko",
            confidence: 0.8
          },
          {
            text: "검토입니다.",
            startMs: 640,
            endMs: 1_000,
            speaker: "Speaker 1",
            language: "ko",
            confidence: 0.7
          },
          {
            text: "예산은",
            startMs: 2_350,
            endMs: 2_700,
            speaker: "Speaker 1",
            language: "ko",
            confidence: 0.6
          },
          {
            text: "동의합니다.",
            startMs: 2_720,
            endMs: 3_100,
            speaker: "Speaker 2",
            language: "ko",
            confidence: 0.95
          }
        ]
      }
    });

    expect(transcript.segments).toHaveLength(3);
    expect(transcript.segments[0]).toMatchObject({
      id: "seg_0001",
      speaker: "Speaker 1",
      language: "ko",
      startMs: 0,
      endMs: 1_000,
      text: "이번 구매 검토입니다."
    });
    expect(transcript.segments[0]?.confidence).toBeCloseTo(0.8, 5);
    expect(transcript.segments[1]).toMatchObject({
      id: "seg_0002",
      speaker: "Speaker 1",
      startMs: 2_350,
      text: "예산은"
    });
    expect(transcript.segments[2]).toMatchObject({
      id: "seg_0003",
      speaker: "Speaker 2"
    });
    expect(transcript.lowConfidenceMoments.map((moment) => moment.text)).toEqual([
      "검토입니다.",
      "예산은"
    ]);
  });

  it("splits long segments at sentence boundaries before they become hard to read", () => {
    const tokens = Array.from({ length: 75 }, (_, index) => ({
      text: index === 55 ? "마무리했습니다." : `항목${index + 1}`,
      startMs: index * 100,
      endMs: index * 100 + 80,
      speaker: "Speaker 1",
      language: "ko",
      confidence: 0.9
    }));

    const transcript = normalizeSonioxTranscript({
      mode: "meeting",
      transcript: {
        transcriptionId: "tx_long",
        sessionId: "sess_long",
        languageHints: ["ko"],
        segments: [],
        tokens
      }
    });

    expect(transcript.segments.length).toBeGreaterThan(1);
    expect(transcript.segments[0]?.text.endsWith("마무리했습니다.")).toBe(true);
    expect(transcript.segments[0]?.text.length).toBeGreaterThanOrEqual(250);
    expect(transcript.segments[0]?.text.length).toBeLessThanOrEqual(350);
  });

  it("keeps Korean syllable tokens and short ASCII fragments readable", () => {
    const transcript = normalizeSonioxTranscript({
      mode: "interview",
      transcript: {
        transcriptionId: "tx_spacing",
        sessionId: "sess_spacing",
        languageHints: ["ko", "en"],
        segments: [],
        tokens: [
          { text: "발", startMs: 0, endMs: 70, speaker: "1", language: "ko" },
          { text: "송", startMs: 74, endMs: 140, speaker: "1", language: "ko" },
          { text: "해", startMs: 145, endMs: 210, speaker: "1", language: "ko" },
          { text: "주", startMs: 215, endMs: 280, speaker: "1", language: "ko" },
          { text: "었", startMs: 285, endMs: 350, speaker: "1", language: "ko" },
          { text: "죠.", startMs: 355, endMs: 430, speaker: "1", language: "ko" },
          { text: "우", startMs: 760, endMs: 830, speaker: "1", language: "ko" },
          { text: "편", startMs: 835, endMs: 900, speaker: "1", language: "ko" },
          { text: "에는", startMs: 905, endMs: 1_000, speaker: "1", language: "ko" },
          { text: "그", startMs: 1_230, endMs: 1_300, speaker: "1", language: "ko" },
          { text: "가", startMs: 1_305, endMs: 1_370, speaker: "1", language: "ko" },
          { text: "바", startMs: 1_600, endMs: 1_670, speaker: "1", language: "ko" },
          { text: "라", startMs: 1_675, endMs: 1_740, speaker: "1", language: "ko" },
          { text: "던", startMs: 1_745, endMs: 1_820, speaker: "1", language: "ko" },
          { text: "돌", startMs: 2_040, endMs: 2_110, speaker: "1", language: "ko" },
          { text: "직", startMs: 2_115, endMs: 2_180, speaker: "1", language: "ko" },
          { text: "구", startMs: 2_185, endMs: 2_250, speaker: "1", language: "ko" },
          { text: "와", startMs: 2_255, endMs: 2_320, speaker: "1", language: "ko" },
          { text: "함께", startMs: 2_560, endMs: 2_720, speaker: "1", language: "ko" },
          { text: "B", startMs: 3_000, endMs: 3_050, speaker: "1", language: "en" },
          { text: "J", startMs: 3_055, endMs: 3_100, speaker: "1", language: "en" },
          { text: "는", startMs: 3_105, endMs: 3_160, speaker: "1", language: "ko" },
          { text: "2", startMs: 3_360, endMs: 3_390, speaker: "1", language: "ko" },
          { text: "0", startMs: 3_395, endMs: 3_420, speaker: "1", language: "ko" },
          { text: "0", startMs: 3_425, endMs: 3_450, speaker: "1", language: "ko" },
          { text: "8", startMs: 3_455, endMs: 3_480, speaker: "1", language: "ko" },
          { text: "년", startMs: 3_485, endMs: 3_540, speaker: "1", language: "ko" },
          { text: "J", startMs: 3_800, endMs: 3_840, speaker: "1", language: "en" },
          { text: "ava", startMs: 3_845, endMs: 3_940, speaker: "1", language: "en" },
          { text: "인터뷰를", startMs: 4_180, endMs: 4_520, speaker: "1", language: "ko" }
        ]
      }
    });

    const text = transcript.segments[0]?.text ?? "";

    expect(text).toContain("발송해주었죠. 우편에는 그가 바라던 돌직구와 함께");
    expect(text).toContain("BJ는 2008년 Java 인터뷰를");
    expect(text).not.toContain("발 송");
    expect(text).not.toContain("B J");
    expect(text).not.toContain("2 0 0 8");
  });

  it("honors Soniox leading-space tokens as Korean word boundaries", () => {
    const transcript = normalizeSonioxTranscript({
      mode: "speech",
      transcript: {
        transcriptionId: "tx_leading_spaces",
        sessionId: "sess_leading_spaces",
        languageHints: ["ko"],
        segments: [],
        tokens: [
          { text: "가능", startMs: 0, endMs: 60, speaker: "1", language: "ko" },
          { text: "해", startMs: 180, endMs: 240, speaker: "1", language: "ko" },
          { text: "요", startMs: 300, endMs: 360, speaker: "1", language: "ko" },
          { text: ".", startMs: 420, endMs: 480, speaker: "1", language: "ko" },
          { text: " 다", startMs: 780, endMs: 840, speaker: "1", language: "ko" },
          { text: "만", startMs: 900, endMs: 960, speaker: "1", language: "ko" },
          { text: " 지", startMs: 1_080, endMs: 1_140, speaker: "1", language: "ko" },
          { text: "금", startMs: 1_200, endMs: 1_260, speaker: "1", language: "ko" },
          { text: " ", startMs: 1_560, endMs: 1_620, speaker: "1", language: "ko" },
          { text: "웨", startMs: 1_680, endMs: 1_740, speaker: "1", language: "ko" },
          { text: "이", startMs: 1_740, endMs: 1_800, speaker: "1", language: "ko" },
          { text: "브", startMs: 1_860, endMs: 1_920, speaker: "1", language: "ko" },
          { text: " 파", startMs: 2_040, endMs: 2_100, speaker: "1", language: "ko" },
          { text: "일", startMs: 2_160, endMs: 2_220, speaker: "1", language: "ko" },
          { text: "로", startMs: 2_340, endMs: 2_400, speaker: "1", language: "ko" },
          { text: " M", startMs: 2_700, endMs: 2_760, speaker: "1", language: "ko" },
          { text: "P", startMs: 2_820, endMs: 2_880, speaker: "1", language: "ko" },
          { text: "3", startMs: 3_000, endMs: 3_060, speaker: "1", language: "ko" },
          { text: " M", startMs: 3_480, endMs: 3_540, speaker: "1", language: "ko" },
          { text: "4", startMs: 3_660, endMs: 3_720, speaker: "1", language: "ko" },
          { text: "A", startMs: 3_900, endMs: 3_960, speaker: "1", language: "ko" },
          { text: "가", startMs: 4_080, endMs: 4_140, speaker: "1", language: "ko" },
          { text: " 1", startMs: 4_440, endMs: 4_500, speaker: "1", language: "ko" },
          { text: "6", startMs: 4_560, endMs: 4_620, speaker: "1", language: "ko" },
          { text: " K", startMs: 4_740, endMs: 4_800, speaker: "1", language: "ko" },
          { text: " M", startMs: 5_100, endMs: 5_160, speaker: "1", language: "ko" },
          { text: "P", startMs: 5_220, endMs: 5_280, speaker: "1", language: "ko" },
          { text: "3", startMs: 5_400, endMs: 5_460, speaker: "1", language: "ko" },
          { text: " 로", startMs: 5_580, endMs: 5_640, speaker: "1", language: "ko" }
        ]
      }
    });

    expect(transcript.text).toBe("가능해요. 다만 지금 웨이브 파일로 MP3 M4A가 16K MP3로");
  });

  it("repairs already stored text that was rendered with artificial syllable spaces", () => {
    expect(
      restoreReadableTranscriptSpacing(
        "발 송 해 주 었 죠. 우 편 에는 그 가 바 라 던 돌 직 구 와 함께 B J 는 2 0 0 8 년 J ava 인터뷰를 준비했습니다."
      )
    ).toBe("발송해주었죠. 우편에는 그가 바라던 돌직구와 함께 BJ는 2008년 Java 인터뷰를 준비했습니다.");
  });
});
