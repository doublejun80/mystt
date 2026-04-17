import type { SessionMode } from "@mystt/audio-core";
import type {
  SonioxAsyncTranscript,
  SonioxSegment,
  SonioxToken
} from "@mystt/soniox-client";

export interface LowConfidenceMoment {
  speaker?: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface NormalizedSegment {
  id: string;
  speaker: string;
  language?: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

export interface NormalizedTranscript {
  sessionId: string;
  mode: SessionMode;
  text: string;
  segments: NormalizedSegment[];
  speakers: string[];
  lowConfidenceMoments: LowConfidenceMoment[];
  durationMs: number;
}

function tokenToSegment(token: SonioxToken, index: number): SonioxSegment {
  return {
    id: `token-segment-${index}`,
    speaker: token.speaker,
    language: token.language,
    startMs: token.startMs,
    endMs: token.endMs,
    text: token.text,
    confidence: token.confidence,
    tokens: [token]
  };
}

function segmentSpeaker(segment: SonioxSegment): string {
  return segment.speaker?.trim() || "Unknown speaker";
}

export function normalizeSonioxTranscript(input: {
  transcript: SonioxAsyncTranscript;
  mode: SessionMode;
  lowConfidenceThreshold?: number;
}): NormalizedTranscript {
  const threshold = input.lowConfidenceThreshold ?? 0.75;
  const sourceSegments =
    input.transcript.segments.length > 0
      ? input.transcript.segments
      : (input.transcript.tokens ?? []).map(tokenToSegment);

  const segments = sourceSegments.map((segment) => ({
    id: segment.id,
    speaker: segmentSpeaker(segment),
    language: segment.language,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text.trim(),
    confidence: segment.confidence
  }));

  const lowConfidenceMoments = sourceSegments.flatMap((segment) =>
    (segment.tokens ?? []).flatMap((token) => {
      if ((token.confidence ?? 1) >= threshold) {
        return [];
      }

      return [
        {
          speaker: segmentSpeaker(segment),
          text: token.text,
          startMs: token.startMs,
          endMs: token.endMs,
          confidence: token.confidence ?? 0
        }
      ] satisfies LowConfidenceMoment[];
    })
  );

  return {
    sessionId: input.transcript.sessionId,
    mode: input.mode,
    text: segments.map((segment) => segment.text).join(" ").trim(),
    segments,
    speakers: [...new Set(segments.map((segment) => segment.speaker))],
    lowConfidenceMoments,
    durationMs: segments.at(-1)?.endMs ?? 0
  };
}

