import { describe, expect, it } from "vitest";

import type { RealtimeToken } from "@soniox/client";

import {
  buildModeAdjustedRecorderPreferences,
  buildRecoverableArchiveStatusText,
  buildSegmentTranslationText,
  canUseTranscriptForPreview,
  getRetiredAudioObjectUrls,
  getTranscriptGroupBy,
  normalizeRealtimeTokenText,
  selectAutoRecoverableArchive,
  shouldAllowRecoverableArchiveUpload,
  shouldPersistStoppedRecording,
  splitRealtimeTokens
} from "./live-recorder-behavior";
import { defaultRecorderPreferences } from "./recorder-settings";

function buildToken(
  text: string,
  overrides: Partial<RealtimeToken> = {}
): RealtimeToken {
  return {
    text,
    confidence: 0.9,
    is_final: true,
    start_ms: 0,
    end_ms: 0,
    ...overrides
  };
}

describe("live-recorder-behavior", () => {
  it("keeps source tokens separate from translated tokens", () => {
    const tokens = [
      buildToken("Hello ", { start_ms: 0, end_ms: 400, language: "en" }),
      buildToken("world", { start_ms: 401, end_ms: 900, language: "en" }),
      buildToken("안녕 ", {
        start_ms: 0,
        end_ms: 400,
        language: "ko",
        translation_status: "translation"
      }),
      buildToken("세상", {
        start_ms: 401,
        end_ms: 900,
        language: "ko",
        translation_status: "translation"
      })
    ];

    const { sourceTokens, translatedTokens } = splitRealtimeTokens(tokens);

    expect(sourceTokens.map((token) => token.text)).toEqual(["Hello ", "world"]);
    expect(translatedTokens.map((token) => token.text)).toEqual(["안녕 ", "세상"]);
  });

  it("builds a translated helper line from overlapping translated tokens", () => {
    const sourceTokens = [
      buildToken("Hello ", { start_ms: 0, end_ms: 400, language: "en" }),
      buildToken("world", { start_ms: 401, end_ms: 900, language: "en" })
    ];
    const translatedTokens = [
      buildToken("안녕 ", {
        start_ms: 0,
        end_ms: 400,
        language: "ko",
        translation_status: "translation"
      }),
      buildToken("세상", {
        start_ms: 401,
        end_ms: 900,
        language: "ko",
        translation_status: "translation"
      }),
      buildToken("무시", {
        start_ms: 2000,
        end_ms: 2200,
        language: "ko",
        translation_status: "translation"
      })
    ];

    expect(buildSegmentTranslationText(sourceTokens, translatedTokens)).toBe("안녕 세상");
  });

  it("repairs artificial syllable spaces in realtime transcript text", () => {
    expect(
      normalizeRealtimeTokenText([
        buildToken("발 "),
        buildToken("송 "),
        buildToken("해 "),
        buildToken("주 "),
        buildToken("었 "),
        buildToken("죠. "),
        buildToken("B "),
        buildToken("J "),
        buildToken("는")
      ])
    ).toBe("발송해주었죠. BJ는");
  });

  it("does not split transcript groups by language anymore", () => {
    expect(
      getTranscriptGroupBy({
        enableSpeakerDiarization: true
      })
    ).toEqual(["speaker"]);
    expect(
      getTranscriptGroupBy({
        enableSpeakerDiarization: false
      })
    ).toEqual([]);
  });

  it("waits longer before auto-finalizing meeting mode by default", () => {
    expect(
      buildModeAdjustedRecorderPreferences(defaultRecorderPreferences, "meeting")
        .endpointDelayMs
    ).toBe(1800);

    expect(
      buildModeAdjustedRecorderPreferences(
        {
          ...defaultRecorderPreferences,
          endpointDelayMs: 3000
        },
        "meeting"
      ).endpointDelayMs
    ).toBe(3000);
  });

  it("retires only object URLs that disappeared from recorder URL state", () => {
    expect(
      getRetiredAudioObjectUrls(
        {
          audioUrl: "blob:preview",
          audioDownloadUrl: "blob:download"
        },
        {
          audioUrl: "blob:preview-next",
          audioDownloadUrl: "blob:download"
        }
      )
    ).toEqual(["blob:preview"]);

    expect(
      getRetiredAudioObjectUrls(
        {
          audioUrl: "blob:shared",
          audioDownloadUrl: "blob:shared"
        },
        {
          audioUrl: null,
          audioDownloadUrl: "blob:shared"
        }
      )
    ).toEqual([]);
  });

  it("persists stopped source audio even when realtime transcript is too short for preview", () => {
    expect(
      canUseTranscriptForPreview("짧음", {
        minimumTranscriptChars: 20
      })
    ).toBe(false);

    expect(
      shouldPersistStoppedRecording({
        canonicalUploadBlobAvailable: true,
        realtimeTranscript: "짧음",
        minimumTranscriptChars: 20
      })
    ).toBe(true);
  });

  it("allows recovery upload only for complete contiguous IndexedDB archives", () => {
    expect(
      shouldAllowRecoverableArchiveUpload({
        sessionId: "complete",
        mimeType: "audio/webm",
        createdAt: "2026-05-17T10:00:00.000Z",
        chunkCount: 2,
        lastSequence: 1,
        isComplete: true
      })
    ).toBe(true);

    expect(
      shouldAllowRecoverableArchiveUpload({
        sessionId: "gapped",
        mimeType: "audio/webm",
        createdAt: "2026-05-17T10:00:00.000Z",
        chunkCount: 2,
        lastSequence: 3,
        isComplete: false
      })
    ).toBe(false);

    expect(
      buildRecoverableArchiveStatusText({
        sessionId: "gapped",
        mimeType: "audio/webm",
        createdAt: "2026-05-17T10:00:00.000Z",
        chunkCount: 2,
        lastSequence: 3,
        isComplete: false
      })
    ).toContain("업로드하지 않습니다");
  });

  it("rejects malformed recovery archive summaries before upload", () => {
    expect(
      shouldAllowRecoverableArchiveUpload({
        sessionId: "malformed",
        mimeType: "audio/webm",
        createdAt: "2026-05-17T10:00:00.000Z",
        chunkCount: 1.5,
        lastSequence: 0.5,
        isComplete: true
      })
    ).toBe(false);
  });

  it("selects one complete archive for automatic recovery upload only when the recorder is idle", () => {
    const completeArchive = {
      sessionId: "complete",
      mimeType: "audio/webm",
      createdAt: "2026-05-17T10:00:00.000Z",
      chunkCount: 3,
      lastSequence: 2,
      isComplete: true
    };

    expect(
      selectAutoRecoverableArchive({
        archives: [
          {
            sessionId: "gapped",
            mimeType: "audio/webm",
            createdAt: "2026-05-17T09:00:00.000Z",
            chunkCount: 3,
            lastSequence: 4,
            isComplete: false
          },
          completeArchive
        ],
        phase: "idle",
        recoveringArchiveSessionId: null,
        attemptedSessionIds: new Set()
      })
    ).toEqual(completeArchive);

    expect(
      selectAutoRecoverableArchive({
        archives: [completeArchive],
        phase: "saving",
        recoveringArchiveSessionId: null,
        attemptedSessionIds: new Set()
      })
    ).toBeNull();

    expect(
      selectAutoRecoverableArchive({
        archives: [completeArchive],
        phase: "idle",
        recoveringArchiveSessionId: null,
        attemptedSessionIds: new Set(["complete"])
      })
    ).toBeNull();
  });
});
