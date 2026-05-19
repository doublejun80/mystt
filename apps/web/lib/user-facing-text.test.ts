import { describe, expect, it } from "vitest";

import {
  cleanTranscriptDisplayText,
  cleanUserFacingText,
  splitUserFacingStoryParagraphs,
  splitUserFacingParagraphs
} from "./user-facing-text";

describe("user-facing-text", () => {
  it("removes internal transcript diagnostics from prose", () => {
    expect(
      cleanUserFacingText(
        "seg_0002의 conf=0.41 lang=ko 보안 체크리스트 기한 확인이 필요하다. [evidence: , ] [evidenceRefs: seg_0003]"
      )
    ).toBe("보안 체크리스트 기한 확인이 필요하다.");

    expect(cleanUserFacingText("현재 안전한 경로를 확인했습니다. []")).toBe(
      "현재 안전한 경로를 확인했습니다."
    );

    expect(
      cleanUserFacingText("null:: 초기 논의는 결제 정책 확인이었다. undefined::")
    ).toBe("초기 논의는 결제 정책 확인이었다.");

    expect(cleanUserFacingText(":null")).toBe("");
    expect(cleanUserFacingText(",")).toBe("");
  });

  it("removes generated speaker-number prefixes from user-facing prose", () => {
    expect(cleanUserFacingText("화자 1: 보안 검토를 먼저 진행합니다.")).toBe(
      "보안 검토를 먼저 진행합니다."
    );
    expect(cleanUserFacingText("Speaker 2 - 예산 승인자를 확인합니다.")).toBe(
      "예산 승인자를 확인합니다."
    );
    expect(cleanUserFacingText("2: 예산 승인 범위 확인")).toBe("2: 예산 승인 범위 확인");
  });

  it("removes internal severity and priority labels from user-facing prose", () => {
    expect(
      cleanUserFacingText(
        "severity=critical priority: P1 confidence: 0.41 language: ko evidenceRefs=seg_0001 보안 검토 지연 가능성이 있습니다."
      )
    ).toBe("보안 검토 지연 가능성이 있습니다.");
  });

  it("removes schema status placeholders from user-facing prose", () => {
    expect(cleanUserFacingText(":needs_confirmation")).toBe("");
    expect(cleanUserFacingText("-:needs_confirmation")).toBe("");
    expect(cleanUserFacingText("ownerStatus: needs_confirmation 담당 확인 필요")).toBe(
      "담당 확인 필요"
    );
  });

  it("removes timestamp evidence labels from user-facing prose", () => {
    expect(
      cleanUserFacingText(
        '00:00-00:05 · "일정은 유지합니다." 근거: seg_0001 결론은 일정 유지입니다.'
      )
    ).toBe("결론은 일정 유지입니다.");

    expect(
      cleanUserFacingText(
        "evidence_refs: seg_0002 12:10-12:18 후속 담당자를 확인합니다."
      )
    ).toBe("후속 담당자를 확인합니다.");
  });

  it("splits and cleans paragraphs", () => {
    expect(
      splitUserFacingParagraphs("회의 배경입니다.\n\nseg_0001에서 나온 결론입니다.")
    ).toEqual(["회의 배경입니다.", "나온 결론입니다."]);
  });

  it("turns a long narrative into readable story paragraphs", () => {
    expect(
      splitUserFacingStoryParagraphs(
        "초기에는 미국 직장 문화와 팀 환경의 낯섦으로 어려움을 겪었다. 팀 이동 이후 심리적 안정감을 얻고 성과를 내기 시작했다. 이후 코로나 시기에 성장 정체에 대한 불안으로 이직을 결심했다. 3개월간 코딩 인터뷰를 준비한 끝에 여러 회사에서 오퍼를 받았다."
      )
    ).toEqual([
      "초기에는 미국 직장 문화와 팀 환경의 낯섦으로 어려움을 겪었다. 팀 이동 이후 심리적 안정감을 얻고 성과를 내기 시작했다.",
      "이후 코로나 시기에 성장 정체에 대한 불안으로 이직을 결심했다. 3개월간 코딩 인터뷰를 준비한 끝에 여러 회사에서 오퍼를 받았다."
    ]);
  });

  it("repairs transcript previews with artificial Korean syllable spaces", () => {
    expect(
      cleanTranscriptDisplayText(
        "발 송 해 주 었 죠. 우 편 에는 그 가 바 라 던 돌 직 구 와 함께 B J 는 2 0 0 8 년 J ava 인터뷰를 준비했습니다."
      )
    ).toBe("발송해주었죠. 우편에는 그가 바라던 돌직구와 함께 BJ는 2008년 Java 인터뷰를 준비했습니다.");
  });

  it("preserves normally spaced Korean transcript text", () => {
    expect(
      cleanTranscriptDisplayText("초기 커리어에서는 미국 직장 문화와 팀 환경의 낯섦이 컸다.")
    ).toBe("초기 커리어에서는 미국 직장 문화와 팀 환경의 낯섦이 컸다.");
  });
});
