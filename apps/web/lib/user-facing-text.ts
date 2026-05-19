const HANGUL_ONLY_PATTERN = /^[\p{Script=Hangul}]+$/u;
const SINGLE_HANGUL_PATTERN = /^[가-힣]$/u;
const KOREAN_NO_SPACE_BEFORE_CORE_PATTERN =
  /^(?:은|는|이|가|을|를|에|엔|에는|에서|에게|께|한테|로|으로|와|과|의|도|만|부터|까지|처럼|보다|라고|이라고|하고|이며|면|서|며|고|지만|는데|니까|거나|죠|요|다|까|나|네|네요|습니다|습니까|입니다|입니까|인가요|였다|이었다|했다|한다|된다|됩니다|했어요|였어요|이에요|예요|잖아요|거든요|겠죠|겠네요|해|해요|해서|하여|하면|하면서|하는|했던|한|할|함|된|되는|되어|되고|돼|돼요|준|주는|던|었|였|겠|밖에|마다|조차|마저)$/u;
const KOREAN_RUN_CONTINUATION_CORE_PATTERN = /^(?:해|하|었|였|겠)$/u;

function stripTokenCore(value: string): string {
  return value
    .trim()
    .replace(/^[("'“‘]+/u, "")
    .replace(/[.,:;!?%)}\]、。，！？…"'”’]+$/u, "");
}

function endsWithSentencePunctuation(value: string): boolean {
  return /[.!?。？！…]["'”’)]*$/u.test(value.trim());
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

function restoreReadableTranscriptSpacing(value: string): string {
  return restoreAsciiFragmentSpacing(restoreArtificialHangulSpacing(value))
    .replace(/\s+([,.:;!?%)}\]、。，！？])/gu, "$1")
    .replace(/([.!?。？！…])(?=\S)/gu, "$1 ")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function cleanUserFacingText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/^\s*(?:(?:화자|speaker)\s*)\d+\s*[:：-]\s*/i, "")
    .replace(/\b(?:null|undefined)\s*::\s*/gi, "")
    .replace(/(^|[\s([{,;])(?:null|undefined)\s*:\s*/gi, "$1")
    .replace(/(^|[\s([{,;])[:：]\s*(?:null|undefined)\b/gi, "$1")
    .replace(/\s*[\[(]\s*evidence(?:Refs?)?\s*:[^\])]*[\])]/gi, "")
    .replace(
      /\b\d{1,2}:\d{2}(?::\d{2})?\s*[-–~]\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[·|:]\s*)?(?:"[^"]*"|“[^”]*”|'[^']*')?/g,
      " "
    )
    .replace(
      /(^|[\s([{,;])(?:근거|증거|evidence(?:[_\s-]?refs?)?|source(?:\s+quote)?|quote)\s*[:：=]\s*(?:seg[-_]\d+\s*)?/gi,
      "$1"
    )
    .replace(/\bsegment(?:[_\s-]?id)?\s*[:=]?\s*seg[-_]\d+\s*/gi, "")
    .replace(/\bevidenceRefs?\s*=\s*\S+\s*/gi, "")
    .replace(/\s*\[\s*\]/g, "")
    .replace(/\s*\((?:seg[-_]\d+\s*,?\s*)+\)/gi, "")
    .replace(/\bseg[-_]\d+\s*(?:의|에서|에)?\s*/gi, "")
    .replace(/\b(?:conf|confidence)\s*[:=]\s*\S+\s*/gi, "")
    .replace(/\blang(?:uage)?\s*[:=]\s*\S+\s*/gi, "")
    .replace(/\b(?:severity|priority)\s*[:=]\s*(?:high|medium|low|critical|urgent|p\d+)\b\s*/gi, "")
    .replace(
      /(^|[\s([{,;])(?:ownerStatus|dueStatus|status)\s*[:=]\s*(?:needs_confirmation|unclear|confirmed|inferred|explicit|todo|in_progress|done)\b\s*/gi,
      "$1"
    )
    .replace(
      /(^|[\s([{,;])[-–—]?\s*[:：]?\s*(?:needs_confirmation|unclear|confirmed|inferred|explicit|todo|in_progress|done)\b\s*/gi,
      "$1"
    )
    .replace(/^[\s,.;:，。；：-]+$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function cleanTranscriptDisplayText(value: string | null | undefined) {
  return restoreReadableTranscriptSpacing(cleanUserFacingText(value));
}

export function splitUserFacingParagraphs(value: string | null | undefined) {
  return (value ?? "")
    .split(/\n{2,}|\r?\n/)
    .map((paragraph) => cleanUserFacingText(paragraph.trim()))
    .filter(Boolean);
}

function splitSentences(value: string) {
  return (
    value.match(/[^.!?。！？]+[.!?。！？]+(?:["'”’])?|[^.!?。！？]+$/g) ?? [value]
  )
    .map((sentence) => cleanUserFacingText(sentence))
    .filter(Boolean);
}

export function splitUserFacingStoryParagraphs(value: string | null | undefined) {
  return splitUserFacingParagraphs(value).flatMap((paragraph) => {
    const sentences = splitSentences(paragraph);

    if (sentences.length <= 1) {
      return sentences;
    }

    const grouped: string[] = [];
    let current: string[] = [];
    let currentLength = 0;

    for (const sentence of sentences) {
      current.push(sentence);
      currentLength += sentence.length;

      if (current.length >= 2 || currentLength >= 180) {
        grouped.push(current.join(" "));
        current = [];
        currentLength = 0;
      }
    }

    if (current.length > 0) {
      grouped.push(current.join(" "));
    }

    return grouped;
  });
}
