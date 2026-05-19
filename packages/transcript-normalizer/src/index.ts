import type { SessionMode } from "@mystt/audio-core";
import type {
  SonioxAsyncTranscript,
  SonioxToken
} from "@mystt/soniox-client";

const GAP_SPLIT_THRESHOLD_MS = 1_200;
const KOREAN_TOKEN_JOIN_GAP_MS = 120;
const SOFT_SEGMENT_CHAR_LIMIT = 250;
const HARD_SEGMENT_CHAR_LIMIT = 350;
const SENTENCE_END_PATTERN = /[.!?。？！…]$/u;
const NO_SPACE_BEFORE_PATTERN = /^[,.:;!?%)}\]、。，！？]/u;
const HANGUL_PATTERN = /\p{Script=Hangul}/u;
const HANGUL_ONLY_PATTERN = /^[\p{Script=Hangul}]+$/u;
const SINGLE_HANGUL_PATTERN = /^[가-힣]$/u;
const KOREAN_COUNTER_PATTERN = /^[년월일시분초회개명건원달%]/u;
const KOREAN_NO_SPACE_BEFORE_CORE_PATTERN =
  /^(?:은|는|이|가|을|를|에|엔|에는|에서|에게|께|한테|로|으로|와|과|의|도|만|부터|까지|처럼|보다|라고|이라고|하고|이며|면|서|며|고|지만|는데|니까|거나|죠|요|다|까|나|네|네요|습니다|습니까|입니다|입니까|인가요|였다|이었다|했다|한다|된다|됩니다|했어요|였어요|이에요|예요|잖아요|거든요|겠죠|겠네요|해|해요|해서|하여|하면|하면서|하는|했던|한|할|함|된|되는|되어|되고|돼|돼요|준|주는|던|었|였|겠|밖에|마다|조차|마저)$/u;
const KOREAN_RUN_CONTINUATION_CORE_PATTERN = /^(?:해|하|었|였|겠)$/u;

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

function normalizeSpeaker(speaker?: string): string {
  return speaker?.trim() || "Unknown speaker";
}

function stripTokenCore(value: string): string {
  return value
    .trim()
    .replace(/^[("'“‘]+/u, "")
    .replace(/[.,:;!?%)}\]、。，！？…"'”’]+$/u, "");
}

function isHangulCore(value: string): boolean {
  const core = stripTokenCore(value);
  return HANGUL_ONLY_PATTERN.test(core);
}

function isSingleHangulCore(value: string): boolean {
  return SINGLE_HANGUL_PATTERN.test(stripTokenCore(value));
}

function endsWithSentencePunctuation(value: string): boolean {
  return /[.!?。？！…]["'”’)]*$/u.test(value.trim());
}

function shouldJoinAsciiFragment(currentText: string, nextText: string): boolean {
  const previousRun = currentText.match(/[A-Za-z0-9]+$/u)?.[0];
  const nextCore = stripTokenCore(nextText);

  if (!previousRun || !/^[A-Za-z0-9]+$/u.test(nextCore)) {
    return false;
  }

  if (/^\d+$/u.test(previousRun) && /^\d+$/u.test(nextCore)) {
    return true;
  }

  if (/^\d+$/u.test(previousRun) && /^[A-Z]$/u.test(nextCore)) {
    return true;
  }

  if (/^[A-Za-z]$/u.test(previousRun)) {
    return nextCore.length === 1 || /^[a-z]{2,}$/u.test(nextCore);
  }

  return /^[A-Z0-9]{2,4}$/u.test(previousRun) && /^[A-Z0-9]$/u.test(nextCore);
}

function shouldBlockExplicitAsciiBoundary(input: {
  currentText: string;
  nextText: string;
  hasExplicitLeadingSpace?: boolean;
}): boolean {
  if (!input.hasExplicitLeadingSpace) {
    return false;
  }

  const previousRun = input.currentText.match(/[A-Za-z0-9]+$/u)?.[0];
  const nextCore = stripTokenCore(input.nextText);

  if (!previousRun || !/^[A-Za-z0-9]+$/u.test(nextCore)) {
    return false;
  }

  return !(/^\d+$/u.test(previousRun) && /^[A-Z]$/u.test(nextCore));
}

function shouldJoinKoreanToken(input: {
  currentText: string;
  previousTokenText?: string;
  nextText: string;
  gapMs?: number;
  hasExplicitLeadingSpace?: boolean;
}): boolean {
  const nextCore = stripTokenCore(input.nextText);

  if (!HANGUL_PATTERN.test(nextCore)) {
    return false;
  }

  if (/\d$/u.test(input.currentText) && KOREAN_COUNTER_PATTERN.test(nextCore)) {
    return true;
  }

  if (
    /[A-Za-z0-9]$/u.test(input.currentText) &&
    KOREAN_NO_SPACE_BEFORE_CORE_PATTERN.test(nextCore)
  ) {
    return true;
  }

  if (input.hasExplicitLeadingSpace) {
    return false;
  }

  if (endsWithSentencePunctuation(input.currentText)) {
    return false;
  }

  const previousCore = stripTokenCore(
    input.previousTokenText ?? input.currentText.match(/\S+$/u)?.[0] ?? ""
  );

  if (!HANGUL_ONLY_PATTERN.test(previousCore)) {
    return false;
  }

  if (KOREAN_NO_SPACE_BEFORE_CORE_PATTERN.test(nextCore)) {
    return true;
  }

  if (!isSingleHangulCore(previousCore) || !isSingleHangulCore(nextCore)) {
    return (
      input.gapMs !== undefined &&
      input.gapMs <= KOREAN_TOKEN_JOIN_GAP_MS &&
      ((previousCore.length <= 2 && isSingleHangulCore(nextCore)) ||
        (isSingleHangulCore(previousCore) && nextCore.length <= 2))
    );
  }

  return input.gapMs === undefined || input.gapMs <= KOREAN_TOKEN_JOIN_GAP_MS;
}

function shouldJoinWithoutSpace(input: {
  currentText: string;
  nextText: string;
  previousTokenText?: string;
  gapMs?: number;
  hasExplicitLeadingSpace?: boolean;
}): boolean {
  if (NO_SPACE_BEFORE_PATTERN.test(input.nextText)) {
    return true;
  }

  if (shouldBlockExplicitAsciiBoundary(input)) {
    return false;
  }

  if (shouldJoinAsciiFragment(input.currentText, input.nextText)) {
    return true;
  }

  return shouldJoinKoreanToken(input);
}

function toReadableText(
  currentText: string,
  nextText: string,
  context: {
    previousTokenText?: string;
    gapMs?: number;
    hasExplicitLeadingSpace?: boolean;
  } = {}
): string {
  const trimmedNext = nextText.trim();

  if (!trimmedNext) {
    return currentText;
  }

  if (!currentText) {
    return trimmedNext;
  }

  if (
    shouldJoinWithoutSpace({
      currentText,
      nextText: trimmedNext,
      previousTokenText: context.previousTokenText,
      gapMs: context.gapMs,
      hasExplicitLeadingSpace: context.hasExplicitLeadingSpace
    })
  ) {
    return `${currentText}${trimmedNext}`;
  }

  return `${currentText} ${trimmedNext}`;
}

function hasArtificialHangulSpacing(value: string): boolean {
  const hangulChars = value.match(/[가-힣]/gu)?.length ?? 0;
  const spacedHangulPairs = value.match(/[가-힣]\s+(?=[가-힣])/gu)?.length ?? 0;

  return hangulChars >= 4 && spacedHangulPairs >= 3 && spacedHangulPairs / hangulChars >= 0.2;
}

function restoreArtificialHangulSpacing(value: string): string {
  if (!hasArtificialHangulSpacing(value)) {
    return value;
  }

  const output: string[] = [];
  let lastSourceCore = "";
  let lastSourceWasSuffix = false;
  let currentHangulRun = false;

  for (const token of value.split(/\s+/).filter(Boolean)) {
    const tokenCore = stripTokenCore(token);
    const tokenIsHangul = HANGUL_ONLY_PATTERN.test(tokenCore);
    const tokenIsSuffix = KOREAN_NO_SPACE_BEFORE_CORE_PATTERN.test(tokenCore);
    const shouldJoin: boolean =
      output.length > 0 &&
      !endsWithSentencePunctuation(output[output.length - 1] ?? "") &&
      tokenIsHangul &&
      HANGUL_ONLY_PATTERN.test(lastSourceCore) &&
      (tokenIsSuffix ||
        (currentHangulRun && SINGLE_HANGUL_PATTERN.test(tokenCore)) ||
        (!lastSourceWasSuffix &&
          SINGLE_HANGUL_PATTERN.test(lastSourceCore) &&
          SINGLE_HANGUL_PATTERN.test(tokenCore)));

    if (shouldJoin) {
      output[output.length - 1] = `${output[output.length - 1]}${token}`;
    } else {
      output.push(token);
    }

    lastSourceCore = tokenCore;
    lastSourceWasSuffix = tokenIsSuffix;
    currentHangulRun =
      tokenIsHangul &&
      (!tokenIsSuffix || KOREAN_RUN_CONTINUATION_CORE_PATTERN.test(tokenCore)) &&
      (SINGLE_HANGUL_PATTERN.test(tokenCore) ||
        (shouldJoin && currentHangulRun));
  }

  return output.join(" ");
}

function restoreAsciiFragmentSpacing(value: string): string {
  let current = value;
  let previous = "";

  while (current !== previous) {
    previous = current;
    current = current
      .replace(/(\d)\s+(?=\d)/gu, "$1")
      .replace(/(\d)\s+(?=[년월일시분초회개명건원달%])/gu, "$1")
      .replace(/\b(\d{1,3})\s+(?=[A-Z]\b)/gu, "$1")
      .replace(/\b([A-Z])\s+(?=[A-Z]\b)/gu, "$1")
      .replace(/\b([A-Z]{2,4})\s+(?=\d\b)/gu, "$1")
      .replace(/\b([A-Z]\d)\s+(?=[A-Z]\b)/gu, "$1")
      .replace(/\b([A-Z])\s+(?=[a-z]{2,}\b)/gu, "$1")
      .replace(
        /\b([A-Za-z0-9]+)\s+(?=(?:은|는|이|가|을|를|에|와|과|도|의)(?:\s|$|[.,:;!?)]))/gu,
        "$1"
      );
  }

  return current;
}

export function restoreReadableTranscriptSpacing(value: string): string {
  return restoreAsciiFragmentSpacing(restoreArtificialHangulSpacing(value))
    .replace(/\s+([,.:;!?%)}\]、。，！？])/gu, "$1")
    .replace(/([.!?。？！…])(?=\S)/gu, "$1 ")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function confidenceAverage(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function stableSegmentId(index: number): string {
  return `seg_${String(index + 1).padStart(4, "0")}`;
}

function sourceTokens(transcript: SonioxAsyncTranscript): SonioxToken[] {
  if (transcript.tokens && transcript.tokens.length > 0) {
    return transcript.tokens;
  }

  return transcript.segments.flatMap((segment) => {
    if (segment.tokens && segment.tokens.length > 0) {
      return segment.tokens.map((token) => ({
        ...token,
        speaker: token.speaker ?? segment.speaker,
        language: token.language ?? segment.language,
        confidence: token.confidence ?? segment.confidence
      }));
    }

    return [
      {
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speaker: segment.speaker,
        language: segment.language,
        confidence: segment.confidence
      }
    ];
  });
}

interface SegmentAccumulator {
  speaker: string;
  language?: string;
  startMs: number;
  endMs: number;
  text: string;
  lastTokenText: string;
  confidenceValues: number[];
}

function shouldStartNewSegment(input: {
  current: SegmentAccumulator;
  token: SonioxToken;
  tokenSpeaker: string;
  projectedText: string;
}): boolean {
  if (input.current.speaker !== input.tokenSpeaker) {
    return true;
  }

  if (input.token.startMs - input.current.endMs > GAP_SPLIT_THRESHOLD_MS) {
    return true;
  }

  if (input.projectedText.length > HARD_SEGMENT_CHAR_LIMIT) {
    return true;
  }

  return (
    input.current.text.length >= SOFT_SEGMENT_CHAR_LIMIT &&
    SENTENCE_END_PATTERN.test(input.current.text)
  );
}

function finalizeSegment(
  current: SegmentAccumulator,
  index: number
): NormalizedSegment {
  return {
    id: stableSegmentId(index),
    speaker: current.speaker,
    language: current.language,
    startMs: current.startMs,
    endMs: current.endMs,
    text: current.text.trim(),
    confidence: confidenceAverage(current.confidenceValues)
  };
}

function groupTokensIntoSegments(tokens: SonioxToken[]): NormalizedSegment[] {
  const segments: NormalizedSegment[] = [];
  let current: SegmentAccumulator | undefined;
  let pendingExplicitSpace = false;

  for (const token of tokens) {
    const tokenText = token.text.trim();

    if (!tokenText) {
      if (/\s/u.test(token.text)) {
        pendingExplicitSpace = true;
      }
      continue;
    }

    const hasExplicitLeadingSpace = pendingExplicitSpace || /^\s/u.test(token.text);
    pendingExplicitSpace = false;

    const tokenSpeaker = normalizeSpeaker(token.speaker);

    if (!current) {
      current = {
        speaker: tokenSpeaker,
        language: token.language,
        startMs: token.startMs,
        endMs: token.endMs,
        text: tokenText,
        lastTokenText: tokenText,
        confidenceValues: token.confidence === undefined ? [] : [token.confidence]
      };
      continue;
    }

    const projectedText = toReadableText(current.text, tokenText, {
      previousTokenText: current.lastTokenText,
      gapMs: token.startMs - current.endMs,
      hasExplicitLeadingSpace
    });

    if (
      shouldStartNewSegment({
        current,
        token,
        tokenSpeaker,
        projectedText
      })
    ) {
      segments.push(finalizeSegment(current, segments.length));
      current = {
        speaker: tokenSpeaker,
        language: token.language,
        startMs: token.startMs,
        endMs: token.endMs,
        text: tokenText,
        lastTokenText: tokenText,
        confidenceValues: token.confidence === undefined ? [] : [token.confidence]
      };
      continue;
    }

    current = {
      ...current,
      language: current.language ?? token.language,
      endMs: Math.max(current.endMs, token.endMs),
      text: projectedText,
      lastTokenText: tokenText,
      confidenceValues:
        token.confidence === undefined
          ? current.confidenceValues
          : [...current.confidenceValues, token.confidence]
    };
  }

  if (current) {
    segments.push(finalizeSegment(current, segments.length));
  }

  return segments;
}

export function normalizeSonioxTranscript(input: {
  transcript: SonioxAsyncTranscript;
  mode: SessionMode;
  lowConfidenceThreshold?: number;
}): NormalizedTranscript {
  const threshold = input.lowConfidenceThreshold ?? 0.75;
  const tokens = sourceTokens(input.transcript);
  const segments = groupTokensIntoSegments(tokens);

  const lowConfidenceMoments = tokens.flatMap((token) => {
    if ((token.confidence ?? 1) >= threshold) {
      return [];
    }

    return [
      {
        speaker: normalizeSpeaker(token.speaker),
        text: token.text,
        startMs: token.startMs,
        endMs: token.endMs,
        confidence: token.confidence ?? 0
      }
    ] satisfies LowConfidenceMoment[];
  });

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
