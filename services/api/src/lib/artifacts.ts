import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from "docx";

import type { SessionRecord } from "@mystt/audio-core";
import type { MeetingNotesV2, SessionNotes } from "@mystt/notes-schema";
import {
  restoreReadableTranscriptSpacing,
  type NormalizedTranscript
} from "@mystt/transcript-normalizer";

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanUserText(value: string): string {
  const cleaned = value
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

  return cleaned;
}

function cleanTranscriptText(value: string): string {
  return restoreReadableTranscriptSpacing(cleanUserText(value));
}

function escapeUserHtml(value: string): string {
  return escapeHtml(cleanUserText(value));
}

function cleanOptionalUserText(value: string | null | undefined, fallback: string): string {
  return cleanUserText(value ?? "") || fallback;
}

function formatSessionMode(mode: string) {
  return mode === "meeting" ? "회의" : mode === "speech" ? "발표" : mode === "interview" ? "인터뷰" : mode;
}

function formatKoreanDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(date);
}

function formatTemplateType(value: string) {
  const labels: Record<string, string> = {
    general_meeting: "일반 회의",
    purchase_review: "구매 검토",
    sales_meeting: "영업 회의",
    user_interview: "사용자 인터뷰",
    support_call: "지원 상담"
  };

  return labels[value] ?? "회의록";
}

function buildListParagraphs(items: string[], emptyLabel = "없음"): Paragraph[] {
  if (items.length === 0) {
    return [new Paragraph({ text: emptyLabel })];
  }

  return items.map((item) => new Paragraph({ text: `- ${cleanUserText(item)}` }));
}

function isMeetingNotesV2(notes: SessionNotes): notes is MeetingNotesV2 {
  return (
    notes.mode === "meeting" &&
    "schemaVersion" in notes &&
    notes.schemaVersion === "meeting_notes_v2"
  );
}

function renderParagraphsHtml(value: string): string {
  return value
    .split(/\n{2,}|\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeUserHtml(paragraph)}</p>`)
    .join("");
}

function renderReportSummaryHtml(notes: MeetingNotesV2): string {
  if (!notes.reportSummary) {
    return renderParagraphsHtml(notes.detailedSummary);
  }

  return `
    <section>
      <h3>${escapeUserHtml(notes.reportSummary.title)}</h3>
      <h4>회의 배경</h4>
      ${renderParagraphsHtml(notes.reportSummary.introduction)}
      <h4>핵심 내용</h4>
      <ul>${notes.reportSummary.keyPoints
        .map((point) => `<li>${escapeUserHtml(point)}</li>`)
        .join("")}</ul>
      <h4>결론</h4>
      ${renderParagraphsHtml(notes.reportSummary.conclusion)}
    </section>
  `.trim();
}

function getTopicReportSections(notes: MeetingNotesV2) {
  if (notes.topicTimeline && notes.topicTimeline.length > 0) {
    return notes.topicTimeline.map((item) => ({
      id: item.timelineId,
      title: item.title,
      paragraphs: [
        item.discussion,
        item.outcome ? `결과/남은 쟁점: ${item.outcome}` : null
      ].filter((paragraph): paragraph is string => Boolean(paragraph))
    }));
  }

  return notes.topicSummaries.map((topic) => ({
    id: topic.topicId,
    title: topic.title,
    paragraphs: topic.summaryBullets
  }));
}

function renderMeetingNotesV2Html(input: {
  session: SessionRecord;
  notes: MeetingNotesV2;
}): string {
  const { session, notes } = input;

  return `
    <article style="font-family: Arial, sans-serif; color: #1f2b23; line-height: 1.6;">
      <header>
        <p style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#8a6643;">${escapeHtml(
          formatTemplateType(notes.templateType)
        )}</p>
        <h1>${escapeUserHtml(session.title)}</h1>
      </header>
      <section>
        <h2>한 줄 결론</h2>
        <p>${escapeUserHtml(notes.oneLineConclusion)}</p>
      </section>
      <section>
        <h2>상세 보고용 요약</h2>
        ${renderReportSummaryHtml(notes)}
      </section>
      <section>
        <h2>결정사항</h2>
        ${notes.decisions
          .map(
            (decision) => `
              <section>
                <h3>${escapeUserHtml(decision.decision)}</h3>
                ${decision.rationale ? `<p>${escapeUserHtml(decision.rationale)}</p>` : ""}
              </section>`
          )
          .join("") || "<p>결정사항이 없습니다.</p>"}
      </section>
      <section>
        <h2>액션아이템</h2>
        ${notes.actionItems
          .map(
            (item) => `
              <section>
                <h3>${escapeUserHtml(item.task)}</h3>
                <p>담당: ${escapeHtml(
                  cleanOptionalUserText(item.owner, "확인 필요")
                )} · 기한: ${escapeHtml(
                  cleanOptionalUserText(item.dueDate, "확인 필요")
                )}</p>
              </section>`
          )
          .join("") || "<p>액션아이템이 없습니다.</p>"}
      </section>
      <section>
        <h2>미결사항</h2>
        ${notes.openIssues
          .map(
            (issue) => `
              <section>
                <h3>${escapeUserHtml(issue.content)}</h3>
                <p>다음 조치: ${escapeUserHtml(issue.suggestedNextAction)}</p>
              </section>`
          )
          .join("") || "<p>미결사항이 없습니다.</p>"}
      </section>
      <section>
        <h2>리스크</h2>
        ${notes.risks
          .map(
            (risk) => `
              <section>
                <h3>${escapeUserHtml(risk.content)}</h3>
                <p>완화책: ${escapeUserHtml(risk.mitigation)}</p>
              </section>`
          )
          .join("") || "<p>리스크가 없습니다.</p>"}
      </section>
      <section>
        <h2>확인 필요 항목</h2>
        ${notes.reviewFlags
          .map(
            (flag) => `
              <p>${escapeUserHtml(flag.message)}</p>`
          )
          .join("") || "<p>확인 필요 항목이 없습니다.</p>"}
      </section>
      <section>
        <h2>주제별 요약</h2>
        ${getTopicReportSections(notes)
          .map(
            (topic) => `
              <section>
                <h3>${escapeUserHtml(topic.title)}</h3>
                ${topic.paragraphs
                  .map((paragraph) => `<p>${escapeUserHtml(paragraph)}</p>`)
                  .join("")}
              </section>`
          )
          .join("") || "<p>주제별 요약이 없습니다.</p>"}
      </section>
    </article>
  `.trim();
}

export function renderCleanTranscriptMarkdown(input: {
  session: SessionRecord;
  transcript: NormalizedTranscript;
}): string {
  const lines = [
    `# ${input.session.title}`,
    "",
    `- 세션 ID: ${input.session.id}`,
    `- 모드: ${formatSessionMode(input.session.mode)}`,
    `- 시작 시각: ${formatKoreanDateTime(input.session.startedAt)}`,
    `- 프로젝트: ${input.session.projectKey ?? "general"}`,
    "",
    "## 전사",
    ""
  ];

  for (const segment of input.transcript.segments) {
    lines.push(
      `[${formatTimestamp(segment.startMs)}-${formatTimestamp(segment.endMs)}] ${
        cleanTranscriptText(segment.text)
      }`
    );
  }

  if (input.transcript.lowConfidenceMoments.length > 0) {
    lines.push("", "## 낮은 신뢰도 구간", "");
    for (const moment of input.transcript.lowConfidenceMoments) {
      lines.push(
        `- [${formatTimestamp(moment.startMs)}-${formatTimestamp(moment.endMs)}] ${
          cleanTranscriptText(moment.text)
        } (${moment.confidence.toFixed(2)})`
      );
    }
  }

  return lines.join("\n");
}

export function renderSessionNotesHtml(input: {
  session: SessionRecord;
  notes: SessionNotes;
}): string {
  const { session, notes } = input;

  if (isMeetingNotesV2(notes)) {
    return renderMeetingNotesV2Html({ session, notes });
  }

  const decisions =
    notes.mode === "meeting"
      ? notes.decisions
          .map((item) => `<li>${escapeUserHtml(item.decision)}</li>`)
          .join("")
      : "<li>이 모드에는 구조화된 결정사항이 없습니다.</li>";
  const actionItems =
    notes.mode === "meeting"
      ? notes.actionItems
          .map(
            (item) =>
              `<li><strong>${escapeUserHtml(item.task)}</strong> · ${escapeHtml(
                cleanOptionalUserText(item.owner, "미지정")
              )} · ${escapeHtml(cleanOptionalUserText(item.dueDate, "기한 없음"))}</li>`
          )
          .join("")
      : "<li>이 모드에는 구조화된 액션아이템이 없습니다.</li>";

  return `
    <article style="font-family: Arial, sans-serif; color: #1f2b23; line-height: 1.6;">
      <header>
        <p style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#8a6643;">${escapeHtml(
          formatSessionMode(session.mode)
        )}</p>
        <h1>${escapeUserHtml(session.title)}</h1>
        <p>${escapeUserHtml(notes.summary)}</p>
      </header>
      <section>
        <h2>결정사항</h2>
        <ul>${decisions}</ul>
      </section>
      <section>
        <h2>액션아이템</h2>
        <ul>${actionItems}</ul>
      </section>
    </article>
  `.trim();
}

export function renderEmailPreviewHtml(input: {
  session: SessionRecord;
  notes: SessionNotes;
  portalBaseUrl?: string;
}): string {
  const portalBaseUrl = input.portalBaseUrl ?? "https://app.localhost";
  const portalUrl = `${portalBaseUrl}/sessions/${input.session.id}`;
  const actionItems =
    input.notes.mode === "meeting"
      ? input.notes.actionItems
      : [];
  const summary = isMeetingNotesV2(input.notes)
    ? input.notes.oneLineConclusion
    : input.notes.summary;

  return `
    <section style="font-family: Arial, sans-serif; color: #1f2b23; line-height: 1.6;">
      <h1>${escapeUserHtml(input.session.title)}</h1>
      <p>${escapeUserHtml(summary)}</p>
      <h2>액션아이템</h2>
      <ul>
        ${
          actionItems.length > 0
            ? actionItems
                .map(
                  (item) =>
                    `<li><strong>${escapeUserHtml(item.task)}</strong> · ${escapeHtml(
                      cleanOptionalUserText(item.owner, "미지정")
                    )} · ${escapeHtml(cleanOptionalUserText(item.dueDate, "기한 없음"))}</li>`
                )
                .join("")
            : "<li>없음</li>"
        }
      </ul>
      <p><a href="${escapeHtml(portalUrl)}">포털에서 열기</a></p>
    </section>
  `.trim();
}

export async function renderSessionNotesDocx(input: {
  session: SessionRecord;
  notes: SessionNotes;
}): Promise<Buffer> {
  const { session, notes } = input;
  const children: Paragraph[] = [
    new Paragraph({
      text: session.title,
      heading: HeadingLevel.HEADING_1
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `모드: ${formatSessionMode(session.mode)} | 세션 ID: ${session.id} | 시작 시각: ${formatKoreanDateTime(session.startedAt)}`
        })
      ]
    })
  ];

  if (!isMeetingNotesV2(notes)) {
    children.push(
      new Paragraph({
        text: "요약",
        heading: HeadingLevel.HEADING_2
      }),
      new Paragraph({ text: cleanUserText(notes.summary) })
    );
  }

  if (notes.mode === "meeting") {
    if (isMeetingNotesV2(notes)) {
      const reportSummaryParagraphs = notes.reportSummary
        ? [
            new Paragraph({
              text: notes.reportSummary.title,
              heading: HeadingLevel.HEADING_3
            }),
            new Paragraph({ text: "회의 배경", heading: HeadingLevel.HEADING_3 }),
            new Paragraph({ text: cleanUserText(notes.reportSummary.introduction) }),
            new Paragraph({ text: "핵심 내용", heading: HeadingLevel.HEADING_3 }),
            ...buildListParagraphs(notes.reportSummary.keyPoints),
            new Paragraph({ text: "결론", heading: HeadingLevel.HEADING_3 }),
            new Paragraph({ text: cleanUserText(notes.reportSummary.conclusion) })
          ]
        : [new Paragraph({ text: cleanUserText(notes.detailedSummary) })];
      const topicSections = getTopicReportSections(notes);

      children.push(
        new Paragraph({ text: "한 줄 결론", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: cleanUserText(notes.oneLineConclusion) }),
        new Paragraph({ text: "상세 보고용 요약", heading: HeadingLevel.HEADING_2 }),
        ...reportSummaryParagraphs,
        new Paragraph({ text: "결정사항", heading: HeadingLevel.HEADING_2 }),
        ...(
          notes.decisions.length > 0
            ? notes.decisions.flatMap((item, index) =>
                [
                  new Paragraph({ text: `${index + 1}. ${cleanUserText(item.decision)}` }),
                  item.rationale
                    ? new Paragraph({ text: `설명: ${cleanUserText(item.rationale)}` })
                    : null
                ].filter((paragraph): paragraph is Paragraph => Boolean(paragraph))
              )
            : [new Paragraph({ text: "구조화된 결정사항이 없습니다." })]
        ),
        new Paragraph({ text: "액션아이템", heading: HeadingLevel.HEADING_2 }),
        ...(
          notes.actionItems.length > 0
            ? notes.actionItems.flatMap((item, index) => [
                new Paragraph({ text: `${index + 1}. ${cleanUserText(item.task)}` }),
                new Paragraph({
                  text: `담당: ${cleanOptionalUserText(
                    item.owner,
                    "확인 필요"
                  )} | 기한: ${cleanOptionalUserText(item.dueDate, "확인 필요")}`
                })
              ])
            : [new Paragraph({ text: "액션아이템이 없습니다." })]
        ),
        new Paragraph({ text: "미결사항", heading: HeadingLevel.HEADING_2 }),
        ...(
          notes.openIssues.length > 0
            ? notes.openIssues.flatMap((issue, index) => [
                new Paragraph({ text: `${index + 1}. ${cleanUserText(issue.content)}` }),
                new Paragraph({
                  text: `다음 조치: ${cleanUserText(issue.suggestedNextAction)}`
                })
              ])
            : [new Paragraph({ text: "미결사항이 없습니다." })]
        ),
        new Paragraph({ text: "리스크", heading: HeadingLevel.HEADING_2 }),
        ...(
          notes.risks.length > 0
            ? notes.risks.flatMap((risk, index) => [
                new Paragraph({ text: `${index + 1}. ${cleanUserText(risk.content)}` }),
                new Paragraph({
                  text: `완화책: ${cleanUserText(risk.mitigation)}`
                })
              ])
            : [new Paragraph({ text: "리스크가 없습니다." })]
        ),
        new Paragraph({ text: "확인 필요 항목", heading: HeadingLevel.HEADING_2 }),
        ...(
          notes.reviewFlags.length > 0
            ? notes.reviewFlags.map(
                (flag) =>
                  new Paragraph({
                    text: cleanUserText(flag.message)
                  })
              )
            : [new Paragraph({ text: "확인 필요 항목이 없습니다." })]
        ),
        new Paragraph({ text: "주제별 요약", heading: HeadingLevel.HEADING_2 }),
        ...(
          topicSections.length > 0
            ? topicSections.flatMap((topic, index) => [
                new Paragraph({ text: `${index + 1}. ${cleanUserText(topic.title)}` }),
                ...topic.paragraphs.map(
                  (paragraph) => new Paragraph({ text: cleanUserText(paragraph) })
                )
              ])
            : [new Paragraph({ text: "주제별 요약이 없습니다." })]
        )
      );
    } else {
      children.push(
      new Paragraph({ text: "결정사항", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.decisions.length > 0
          ? notes.decisions.flatMap((item, index) =>
              [
                new Paragraph({ text: `${index + 1}. ${cleanUserText(item.decision)}` }),
                item.rationale
                  ? new Paragraph({ text: `설명: ${cleanUserText(item.rationale)}` })
                  : null
              ].filter((paragraph): paragraph is Paragraph => Boolean(paragraph))
            )
          : [new Paragraph({ text: "구조화된 결정사항이 없습니다." })]
      ),
      new Paragraph({ text: "액션아이템", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.actionItems.length > 0
          ? notes.actionItems.flatMap((item, index) => [
              new Paragraph({ text: `${index + 1}. ${cleanUserText(item.task)}` }),
              new Paragraph({
                text: `담당: ${cleanOptionalUserText(
                  item.owner,
                  "미지정"
                )} | 기한: ${cleanOptionalUserText(item.dueDate, "기한 없음")}`
              })
            ])
          : [new Paragraph({ text: "액션아이템이 없습니다." })]
      ),
      new Paragraph({ text: "리스크", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.risks, "리스크가 없습니다."),
      new Paragraph({ text: "열린 질문", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.openQuestions, "열린 질문이 없습니다."),
      new Paragraph({ text: "다음 안건", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.nextAgenda, "다음 안건이 없습니다."),
      new Paragraph({ text: "발화 하이라이트", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.speakerHighlights.length > 0
          ? notes.speakerHighlights.map(
              (item) => new Paragraph({ text: cleanUserText(item.summary) })
            )
          : [new Paragraph({ text: "발화 하이라이트가 없습니다." })]
      )
      );
    }
  }

  if (notes.mode === "speech") {
    children.push(
      new Paragraph({ text: "핵심 메시지", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.keyMessages, "핵심 메시지가 없습니다."),
      new Paragraph({ text: "인용할 문장", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.quotableLines, "인용할 문장이 없습니다."),
      new Paragraph({ text: "구간별 요약", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.sectionSummaries.length > 0
          ? notes.sectionSummaries.map(
              (item) => new Paragraph({ text: `${cleanUserText(item.section)}: ${cleanUserText(item.summary)}` })
            )
          : [new Paragraph({ text: "구간별 요약이 없습니다." })]
      ),
      new Paragraph({ text: "청중 질의응답", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.audienceQna.length > 0
          ? notes.audienceQna.flatMap((item) => [
              new Paragraph({ text: `질문: ${cleanUserText(item.question)}` }),
              new Paragraph({ text: `답변: ${cleanUserText(item.answer)}` })
            ])
          : [new Paragraph({ text: "청중 질의응답이 없습니다." })]
      )
    );
  }

  if (notes.mode === "interview") {
    children.push(
      new Paragraph({ text: "핵심 인사이트", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.keyInsights, "핵심 인사이트가 없습니다."),
      new Paragraph({
        text: "질문과 답변",
        heading: HeadingLevel.HEADING_2
      }),
      ...(
        notes.questionAnswerPairs.length > 0
          ? notes.questionAnswerPairs.flatMap((item) => [
              new Paragraph({ text: `질문: ${cleanUserText(item.question)}` }),
              new Paragraph({ text: `답변: ${cleanUserText(item.answer)}` })
            ])
          : [new Paragraph({ text: "질문과 답변이 없습니다." })]
      ),
      new Paragraph({
        text: "후속 질문",
        heading: HeadingLevel.HEADING_2
      }),
      ...buildListParagraphs(notes.followUpQuestions, "후속 질문이 없습니다."),
      new Paragraph({
        text: "민감한 발언",
        heading: HeadingLevel.HEADING_2
      }),
      ...buildListParagraphs(notes.sensitiveStatements, "민감한 발언이 없습니다.")
    );
  }

  const document = new Document({
    sections: [
      {
        children
      }
    ]
  });

  return Packer.toBuffer(document);
}
