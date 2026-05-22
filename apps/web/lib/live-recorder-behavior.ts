import type { SessionMode } from "@mystt/audio-core";
import type { RealtimeToken, SegmentGroupKey } from "@soniox/client";

import {
  defaultRecorderPreferences,
  type RecorderPreferences
} from "./recorder-settings";
import { cleanTranscriptDisplayText } from "./user-facing-text";

export function normalizeRealtimeTokenText(tokens: RealtimeToken[]) {
  return cleanTranscriptDisplayText(tokens.map((token) => token.text).join(""));
}

export function splitRealtimeTokens(tokens: RealtimeToken[]) {
  return {
    sourceTokens: tokens.filter((token) => token.translation_status !== "translation"),
    translatedTokens: tokens.filter(
      (token) => token.translation_status === "translation"
    )
  };
}

function hasTimedRange(tokens: RealtimeToken[]) {
  return tokens.some(
    (token) =>
      typeof token.start_ms === "number" && typeof token.end_ms === "number"
  );
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
) {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function buildSegmentTranslationText(
  segmentTokens: RealtimeToken[],
  translatedTokens: RealtimeToken[]
) {
  if (segmentTokens.length === 0 || translatedTokens.length === 0) {
    return null;
  }

  if (!hasTimedRange(segmentTokens) || !hasTimedRange(translatedTokens)) {
    return null;
  }

  const startMs =
    segmentTokens.find((token) => typeof token.start_ms === "number")?.start_ms ?? null;
  const endMs =
    [...segmentTokens]
      .reverse()
      .find((token) => typeof token.end_ms === "number")?.end_ms ?? null;

  if (startMs === null || endMs === null) {
    return null;
  }

  const overlapped = translatedTokens.filter((token) => {
    if (typeof token.start_ms !== "number" || typeof token.end_ms !== "number") {
      return false;
    }

    return rangesOverlap(startMs, endMs, token.start_ms, token.end_ms);
  });

  const text = normalizeRealtimeTokenText(overlapped);
  return text || null;
}

export function getTranscriptGroupBy(
  preferences: Pick<RecorderPreferences, "enableSpeakerDiarization">
): SegmentGroupKey[] {
  return preferences.enableSpeakerDiarization ? ["speaker"] : [];
}

export type AudioObjectUrlState = {
  audioUrl: string | null;
  audioDownloadUrl: string | null;
};

export type RecoverableArchiveLike = {
  sessionId: string;
  mimeType: string;
  createdAt: string;
  chunkCount: number;
  lastSequence: number;
  isComplete: boolean;
};

export type AutoRecoverableArchivePhase =
  | "idle"
  | "requesting"
  | "recording"
  | "saving"
  | "processing"
  | "saved"
  | "error";

export function getUniqueAudioObjectUrls(state: AudioObjectUrlState) {
  return [
    ...new Set(
      [state.audioUrl, state.audioDownloadUrl].filter(
        (url): url is string => Boolean(url?.startsWith("blob:"))
      )
    )
  ];
}

export function getRetiredAudioObjectUrls(
  previous: AudioObjectUrlState,
  next: AudioObjectUrlState
) {
  const nextUrls = new Set(getUniqueAudioObjectUrls(next));

  return getUniqueAudioObjectUrls(previous).filter((url) => !nextUrls.has(url));
}

export function canUseTranscriptForPreview(
  transcript: string,
  options?: {
    minimumTranscriptChars?: number;
  }
) {
  const minimumTranscriptChars = options?.minimumTranscriptChars ?? 20;

  return transcript.replace(/\s+/g, "").length >= minimumTranscriptChars;
}

export function shouldPersistStoppedRecording({
  canonicalUploadBlobAvailable
}: {
  canonicalUploadBlobAvailable: boolean;
  realtimeTranscript: string;
  minimumTranscriptChars?: number;
}) {
  return canonicalUploadBlobAvailable;
}

export function shouldAllowRecoverableArchiveUpload(
  archive: RecoverableArchiveLike
) {
  return (
    archive.isComplete &&
    Number.isSafeInteger(archive.chunkCount) &&
    Number.isSafeInteger(archive.lastSequence) &&
    archive.chunkCount > 0 &&
    archive.lastSequence === archive.chunkCount - 1
  );
}

export function selectAutoRecoverableArchive(input: {
  archives: RecoverableArchiveLike[];
  phase: AutoRecoverableArchivePhase;
  recoveringArchiveSessionId: string | null;
  attemptedSessionIds: ReadonlySet<string>;
}) {
  if (
    input.recoveringArchiveSessionId ||
    (input.phase !== "idle" && input.phase !== "saved" && input.phase !== "error")
  ) {
    return null;
  }

  return (
    input.archives.find(
      (archive) =>
        !input.attemptedSessionIds.has(archive.sessionId) &&
        shouldAllowRecoverableArchiveUpload(archive)
    ) ?? null
  );
}

export function buildRecoverableArchiveStatusText(
  archive: RecoverableArchiveLike
) {
  if (shouldAllowRecoverableArchiveUpload(archive)) {
    return `${archive.chunkCount}개 조각이 이어져 있어 업로드할 수 있습니다.`;
  }

  return `${archive.chunkCount}개 조각 중 순서가 비어 있어 업로드하지 않습니다. 원본 보존을 위해 폐기 전 확인하세요.`;
}

export function buildModeAdjustedRecorderPreferences(
  preferences: RecorderPreferences,
  mode: SessionMode
): RecorderPreferences {
  switch (mode) {
    case "meeting":
      return {
        ...preferences,
        enableSpeakerDiarization: true,
        // Meeting mode should wait a little longer before finalizing a line so
        // mid-thought pauses do not get chopped into tiny transcript cards.
        endpointDelayMs:
          preferences.endpointDelayMs === defaultRecorderPreferences.endpointDelayMs
            ? 1800
            : preferences.endpointDelayMs
      };
    case "speech":
      return {
        ...preferences,
        enableSpeakerDiarization: false,
        endpointDelayMs:
          preferences.endpointDelayMs === defaultRecorderPreferences.endpointDelayMs
            ? 2200
            : preferences.endpointDelayMs
      };
    case "interview":
      return {
        ...preferences,
        enableSpeakerDiarization: true,
        highlightLowConfidence: true,
        endpointDelayMs:
          preferences.endpointDelayMs === defaultRecorderPreferences.endpointDelayMs
            ? 1800
            : preferences.endpointDelayMs
      };
  }
}
