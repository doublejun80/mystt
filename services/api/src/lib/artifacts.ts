import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from "docx";

import type { SessionRecord } from "@mystt/audio-core";
import type { SessionNotes } from "@mystt/notes-schema";
import type { NormalizedTranscript } from "@mystt/transcript-normalizer";

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

function buildListParagraphs(items: string[], emptyLabel = "None"): Paragraph[] {
  if (items.length === 0) {
    return [new Paragraph({ text: emptyLabel })];
  }

  return items.map((item) => new Paragraph({ text: `- ${item}` }));
}

function buildEvidenceLabel(input: {
  speaker?: string | null;
  quote: string;
  timestampRange: string;
}): string {
  return [
    input.speaker ?? "Unknown speaker",
    input.timestampRange,
    `"${input.quote}"`
  ].join(" | ");
}

export function renderCleanTranscriptMarkdown(input: {
  session: SessionRecord;
  transcript: NormalizedTranscript;
}): string {
  const lines = [
    `# ${input.session.title}`,
    "",
    `- Session ID: ${input.session.id}`,
    `- Mode: ${input.session.mode}`,
    `- Started At: ${input.session.startedAt}`,
    `- Project: ${input.session.projectKey ?? "general"}`,
    "",
    "## Transcript",
    ""
  ];

  for (const segment of input.transcript.segments) {
    lines.push(
      `[${formatTimestamp(segment.startMs)}-${formatTimestamp(segment.endMs)}] ${
        segment.speaker
      }: ${segment.text}`
    );
  }

  if (input.transcript.lowConfidenceMoments.length > 0) {
    lines.push("", "## Low Confidence Moments", "");
    for (const moment of input.transcript.lowConfidenceMoments) {
      lines.push(
        `- [${formatTimestamp(moment.startMs)}-${formatTimestamp(moment.endMs)}] ${
          moment.speaker ?? "Unknown speaker"
        }: ${moment.text} (${moment.confidence.toFixed(2)})`
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
  const decisions =
    notes.mode === "meeting"
      ? notes.decisions
          .map((item) => `<li>${escapeHtml(item.decision)}</li>`)
          .join("")
      : "<li>No structured decisions for this mode.</li>";
  const actionItems =
    notes.mode === "meeting"
      ? notes.actionItems
          .map(
            (item) =>
              `<li><strong>${escapeHtml(item.task)}</strong> · ${escapeHtml(
                item.owner ?? "Unassigned"
              )} · ${escapeHtml(item.dueDate ?? "No due date")}</li>`
          )
          .join("")
      : "<li>No structured action items for this mode.</li>";

  return `
    <article style="font-family: Arial, sans-serif; color: #1f2b23; line-height: 1.6;">
      <header>
        <p style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#8a6643;">${escapeHtml(
          session.mode
        )}</p>
        <h1>${escapeHtml(session.title)}</h1>
        <p>${escapeHtml(notes.summary)}</p>
      </header>
      <section>
        <h2>Decisions</h2>
        <ul>${decisions}</ul>
      </section>
      <section>
        <h2>Action Items</h2>
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

  return `
    <section style="font-family: Arial, sans-serif; color: #1f2b23; line-height: 1.6;">
      <h1>${escapeHtml(input.session.title)}</h1>
      <p>${escapeHtml(input.notes.summary)}</p>
      <h2>Action items</h2>
      <ul>
        ${
          actionItems.length > 0
            ? actionItems
                .map(
                  (item) =>
                    `<li><strong>${escapeHtml(item.task)}</strong> · ${escapeHtml(
                      item.owner ?? "Unassigned"
                    )} · ${escapeHtml(item.dueDate ?? "No due date")}</li>`
                )
                .join("")
            : "<li>None</li>"
        }
      </ul>
      <p><a href="${escapeHtml(portalUrl)}">Open portal session</a></p>
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
          text: `Mode: ${session.mode} | Session ID: ${session.id} | Started: ${session.startedAt}`
        })
      ]
    }),
    new Paragraph({
      text: "Summary",
      heading: HeadingLevel.HEADING_2
    }),
    new Paragraph({ text: notes.summary })
  ];

  if (notes.mode === "meeting") {
    children.push(
      new Paragraph({ text: "Decisions", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.decisions.length > 0
          ? notes.decisions.flatMap((item, index) => [
              new Paragraph({ text: `${index + 1}. ${item.decision}` }),
              new Paragraph({
                text: `Rationale: ${item.rationale ?? "Not captured"}`
              }),
              new Paragraph({
                text: `Evidence: ${buildEvidenceLabel(item.evidence)}`
              })
            ])
          : [new Paragraph({ text: "No structured decisions." })]
      ),
      new Paragraph({ text: "Action Items", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.actionItems.length > 0
          ? notes.actionItems.flatMap((item, index) => [
              new Paragraph({ text: `${index + 1}. ${item.task}` }),
              new Paragraph({
                text: `Owner: ${item.owner ?? "Unassigned"} | Due: ${item.dueDate ?? "No due date"}`
              }),
              new Paragraph({
                text: `Evidence: ${buildEvidenceLabel(item.evidence)}`
              })
            ])
          : [new Paragraph({ text: "No action items." })]
      ),
      new Paragraph({ text: "Risks", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.risks, "No risks captured."),
      new Paragraph({ text: "Open Questions", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.openQuestions, "No open questions."),
      new Paragraph({ text: "Next Agenda", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.nextAgenda, "No next agenda items."),
      new Paragraph({ text: "Speaker Highlights", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.speakerHighlights.length > 0
          ? notes.speakerHighlights.map(
              (item) => new Paragraph({ text: `${item.speaker}: ${item.summary}` })
            )
          : [new Paragraph({ text: "No speaker highlights." })]
      )
    );
  }

  if (notes.mode === "speech") {
    children.push(
      new Paragraph({ text: "Key Messages", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.keyMessages, "No key messages."),
      new Paragraph({ text: "Quotable Lines", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.quotableLines, "No quotable lines."),
      new Paragraph({ text: "Section Summaries", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.sectionSummaries.length > 0
          ? notes.sectionSummaries.map(
              (item) => new Paragraph({ text: `${item.section}: ${item.summary}` })
            )
          : [new Paragraph({ text: "No section summaries." })]
      ),
      new Paragraph({ text: "Audience Q&A", heading: HeadingLevel.HEADING_2 }),
      ...(
        notes.audienceQna.length > 0
          ? notes.audienceQna.flatMap((item) => [
              new Paragraph({ text: `Q: ${item.question}` }),
              new Paragraph({ text: `A: ${item.answer}` })
            ])
          : [new Paragraph({ text: "No audience Q&A." })]
      )
    );
  }

  if (notes.mode === "interview") {
    children.push(
      new Paragraph({ text: "Key Insights", heading: HeadingLevel.HEADING_2 }),
      ...buildListParagraphs(notes.keyInsights, "No key insights."),
      new Paragraph({
        text: "Question / Answer Pairs",
        heading: HeadingLevel.HEADING_2
      }),
      ...(
        notes.questionAnswerPairs.length > 0
          ? notes.questionAnswerPairs.flatMap((item) => [
              new Paragraph({ text: `Q: ${item.question}` }),
              new Paragraph({ text: `A: ${item.answer}` })
            ])
          : [new Paragraph({ text: "No question and answer pairs." })]
      ),
      new Paragraph({
        text: "Follow-up Questions",
        heading: HeadingLevel.HEADING_2
      }),
      ...buildListParagraphs(notes.followUpQuestions, "No follow-up questions."),
      new Paragraph({
        text: "Sensitive Statements",
        heading: HeadingLevel.HEADING_2
      }),
      ...buildListParagraphs(notes.sensitiveStatements, "No sensitive statements.")
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
