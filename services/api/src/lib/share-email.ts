import { basename } from "node:path";

import type { MailMessageAttachment } from "./mail-delivery";
import { sendMailMessage } from "./mail-delivery";
import { readPersistedArtifactBuffer } from "./persistence";
import type { SessionSnapshot } from "./store";

export interface ShareEmailSelection {
  includeSummary: boolean;
  includeDetails: boolean;
  includeAudio: boolean;
}

export interface ShareEmailDraft {
  subject: string;
  text: string;
  html: string;
  attachments: MailMessageAttachment[];
  attachmentSummary: {
    transcriptAttached: boolean;
    notesAttached: boolean;
    audioAttached: boolean;
  };
}

function resolveArtifactLocation(
  snapshot: SessionSnapshot,
  kind: "clean_transcript_md" | "meeting_notes_docx"
) {
  const artifact = snapshot.session.artifacts.find(
    (item) => item.kind === kind && item.status === "ready"
  );

  return artifact?.location ?? null;
}

function resolveSummaryLines(snapshot: SessionSnapshot) {
  const notes = snapshot.notes?.notes;

  if (!notes) {
    return ["요약이 아직 생성되지 않았습니다."];
  }

  const lines = [notes.summary];

  if (notes.mode === "meeting") {
    lines.push(
      ...notes.decisions.slice(0, 4).map((item) => `- ${item.decision}`),
      ...notes.actionItems.slice(0, 4).map(
        (item) =>
          `- ${item.task}${item.owner ? ` / ${item.owner}` : ""}${item.dueDate ? ` / ${item.dueDate}` : ""}`
      )
    );
  } else if (notes.mode === "speech") {
    lines.push(...notes.keyMessages.slice(0, 4).map((item) => `- ${item}`));
  } else {
    lines.push(...notes.keyInsights.slice(0, 4).map((item) => `- ${item}`));
  }

  return lines.slice(0, 5);
}

function sanitizeFileSegment(value: string) {
  return value.replace(/[^\w.\-가-힣]+/g, "_").replace(/^_+|_+$/g, "") || "session";
}

function guessAttachmentContentType(fileName: string) {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".md")) {
    return "text/markdown; charset=utf-8";
  }

  if (normalized.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  if (normalized.endsWith(".mp3")) {
    return "audio/mpeg";
  }

  if (normalized.endsWith(".wav")) {
    return "audio/wav";
  }

  if (normalized.endsWith(".m4a") || normalized.endsWith(".mp4")) {
    return "audio/mp4";
  }

  return "application/octet-stream";
}

function canAttachAudio(location?: string | null) {
  if (!location) {
    return false;
  }

  return (
    location.startsWith("minio://") ||
    location.startsWith("/") ||
    /^[A-Za-z]:\\/.test(location)
  );
}

async function maybeBuildAttachment(input: {
  enabled: boolean;
  location?: string | null;
  filename: string;
}): Promise<MailMessageAttachment | null> {
  if (!input.enabled || !input.location) {
    return null;
  }

  try {
    const content = await readPersistedArtifactBuffer(input.location);

    return {
      filename: input.filename,
      content,
      contentType: guessAttachmentContentType(input.filename)
    };
  } catch {
    return null;
  }
}

export async function buildShareEmailDraft(input: {
  snapshot: SessionSnapshot;
  portalBaseUrl: string;
  selection: ShareEmailSelection;
}) {
  const { snapshot, selection } = input;
  const session = snapshot.session;
  const safeTitle = sanitizeFileSegment(session.title);
  const transcriptLocation = resolveArtifactLocation(snapshot, "clean_transcript_md");
  const notesDocxLocation = resolveArtifactLocation(snapshot, "meeting_notes_docx");
  const audioLocation = canAttachAudio(session.localAudioPath) ? session.localAudioPath : null;

  const [transcriptAttachment, notesAttachment, audioAttachment] = await Promise.all([
    maybeBuildAttachment({
      enabled: selection.includeDetails,
      location: transcriptLocation,
      filename: `${safeTitle}-원문.md`
    }),
    maybeBuildAttachment({
      enabled: selection.includeDetails,
      location: notesDocxLocation,
      filename: `${safeTitle}-회의록.docx`
    }),
    maybeBuildAttachment({
      enabled: selection.includeAudio,
      location: audioLocation,
      filename: audioLocation ? basename(audioLocation) : `${safeTitle}.audio`
    })
  ]);

  const attachments = [transcriptAttachment, notesAttachment, audioAttachment].filter(
    (attachment): attachment is MailMessageAttachment => Boolean(attachment)
  );

  const textLines = [
    `[mystt] ${session.title}`,
    `모드: ${session.mode}`,
    `시작 시각: ${session.startedAt}`
  ];
  const htmlSections: string[] = [
    `<p><strong>[mystt]</strong> ${escapeHtml(session.title)}</p>`,
    `<p>모드: ${escapeHtml(session.mode)}<br />시작 시각: ${escapeHtml(session.startedAt)}</p>`
  ];

  if (selection.includeSummary) {
    const summaryLines = resolveSummaryLines(snapshot);

    textLines.push("", "요약", ...summaryLines);
    htmlSections.push(
      `<h2>요약</h2><ul>${summaryLines
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul>`
    );
  }

  if (selection.includeDetails) {
    const detailLines = [
      `세션 ID: ${session.id}`,
      `프로젝트: ${session.projectKey ?? "개인 기록"}`,
      `원문 첨부: ${transcriptAttachment ? "포함" : "없음"}`,
      `회의록 첨부: ${notesAttachment ? "포함" : "없음"}`
    ];

    textLines.push("", "상세 내역", ...detailLines);
    htmlSections.push(
      `<h2>상세 내역</h2><ul>${detailLines
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul>`
    );
  }

  if (selection.includeAudio) {
    const audioLines = [
      `원본 음성 첨부: ${audioAttachment ? "포함" : "없음"}`
    ];

    textLines.push("", "음성 파일", ...audioLines);
    htmlSections.push(
      `<h2>음성 파일</h2><ul>${audioLines
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul>`
    );
  }

  textLines.push(
    "",
    "첨부 상태",
    `원문: ${transcriptAttachment ? "포함" : "없음"}`,
    `회의록: ${notesAttachment ? "포함" : "없음"}`,
    `음성: ${audioAttachment ? "포함" : "없음"}`
  );
  htmlSections.push(
    `<h2>첨부 상태</h2><ul><li>원문: ${transcriptAttachment ? "포함" : "없음"}</li><li>회의록: ${notesAttachment ? "포함" : "없음"}</li><li>음성: ${audioAttachment ? "포함" : "없음"}</li></ul>`
  );

  return {
    subject: `[mystt] ${session.title}`,
    text: textLines.join("\n"),
    html: `<section style="font-family: Arial, sans-serif; color: #121826; line-height: 1.6;">${htmlSections.join("")}</section>`,
    attachments,
    attachmentSummary: {
      transcriptAttached: Boolean(transcriptAttachment),
      notesAttached: Boolean(notesAttachment),
      audioAttached: Boolean(audioAttachment)
    }
  } satisfies ShareEmailDraft;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendShareEmail(input: {
  to: string[];
  draft: ShareEmailDraft;
}) {
  const result = await sendMailMessage({
    to: input.to,
    subject: input.draft.subject,
    text: input.draft.text,
    html: input.draft.html,
    attachments: input.draft.attachments
  });

  return {
    messageId: result.messageId,
    accepted: result.accepted,
    attachmentSummary: input.draft.attachmentSummary
  };
}
