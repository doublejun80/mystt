import { notFound, redirect } from "next/navigation";
import {
  normalizeSonioxTranscript,
  type NormalizedTranscript
} from "@mystt/transcript-normalizer";

import { StatusPill } from "../../../components/status-pill";
import {
  fetchSessionAuditEvents,
  fetchRawTranscriptArtifact,
  fetchSessionSnapshotById,
  type AuditEventRecord,
  type MeetingNotesV2Record,
  type SessionNotesRecord,
  type SessionSnapshotRecord
} from "../../../lib/api";
import { decorateSessionRecord } from "../../../lib/demo-data";
import { modeLabels } from "@mystt/ui-kit";
import {
  buildAuditPayloadPreview,
  formatAuditLabel,
  formatKoreanDateTime
} from "../../../lib/format";
import { shouldHidePortalSession } from "../../../lib/session-visibility";
import {
  cleanTranscriptDisplayText as cleanTranscriptText,
  cleanUserFacingText as cleanUserText,
  splitUserFacingStoryParagraphs as splitStoryParagraphs,
  splitUserFacingParagraphs as splitParagraphs
} from "../../../lib/user-facing-text";

function isMeetingNotesV2(notes?: SessionNotesRecord): notes is MeetingNotesV2Record {
  return Boolean(
    notes &&
      notes.mode === "meeting" &&
      "schemaVersion" in notes &&
      notes.schemaVersion === "meeting_notes_v2"
  );
}

function isAuthError(error: unknown) {
  return error instanceof Error && /authentication required|access token required/i.test(error.message);
}

function hasArtificialTranscriptSpacing(transcript?: SessionSnapshotRecord["normalizedTranscript"]) {
  const text = [
    transcript?.text,
    ...(transcript?.segments?.slice(0, 4).map((segment) => segment.text) ?? [])
  ]
    .filter(Boolean)
    .join(" ");

  return /[가-힣]\s+[가-힣]\s+[가-힣]/u.test(text) || /\b[A-Z0-9]\s+[A-Z0-9]\s+[A-Z0-9]\b/u.test(text);
}

async function resolveReadableTranscript(
  snapshot: SessionSnapshotRecord | null
): Promise<NormalizedTranscript | SessionSnapshotRecord["normalizedTranscript"] | undefined> {
  if (!snapshot?.normalizedTranscript) {
    return undefined;
  }

  if (!hasArtificialTranscriptSpacing(snapshot.normalizedTranscript)) {
    return snapshot.normalizedTranscript;
  }

  try {
    const rawTranscript = await fetchRawTranscriptArtifact(snapshot.session.id);

    return normalizeSonioxTranscript({
      mode: snapshot.session.mode,
      transcript: rawTranscript as Parameters<typeof normalizeSonioxTranscript>[0]["transcript"]
    });
  } catch {
    return snapshot.normalizedTranscript;
  }
}

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function buildMetaLabel(label: string, value?: string | null) {
  const cleaned = cleanUserText(value);

  return cleaned ? `${label}: ${cleaned}` : null;
}

function StorySummary({ value }: { value: string }) {
  const paragraphs = splitStoryParagraphs(value);

  if (paragraphs.length === 0) {
    return null;
  }

  return (
    <section className="storySummary" aria-label="줄거리">
      <p className="storySummaryLabel">줄거리</p>
      {paragraphs.map((paragraph) => (
        <p key={paragraph} className="storySummaryParagraph">
          {paragraph}
        </p>
      ))}
    </section>
  );
}

const artifactDownloadLabels: Record<string, string> = {
  raw_transcript_json: "원본 전사 JSON",
  clean_transcript_md: "정리 전사 Markdown",
  meeting_notes_json: "회의록 JSON",
  meeting_notes_html: "회의록 HTML",
  meeting_notes_docx: "회의록 DOCX",
  email_preview_html: "메일 미리보기 HTML"
};

function getSessionSourceAudioDownloadHref(sessionId: string) {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/source-audio`;
}

function getSessionArtifactDownloadHref(sessionId: string, kind: string) {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(kind)}`;
}

function getTopicReportSections(notes: MeetingNotesV2Record) {
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

function ReportSummary({ notes }: { notes: MeetingNotesV2Record }) {
  if (!notes.reportSummary) {
    return (
      <>
        {splitParagraphs(notes.detailedSummary).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </>
    );
  }

  return (
    <div>
      <h3 className="sectionTitle" style={{ marginTop: 16 }}>
        {cleanUserText(notes.reportSummary.title)}
      </h3>
      <section style={{ marginTop: 16 }}>
        <strong>회의 배경</strong>
        {splitParagraphs(notes.reportSummary.introduction).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>
      <section style={{ marginTop: 16 }}>
        <strong>핵심 내용</strong>
        <ul className="detailList" style={{ marginTop: 8 }}>
          {notes.reportSummary.keyPoints.map((point) => (
            <li key={point}>{cleanUserText(point)}</li>
          ))}
        </ul>
      </section>
      <section style={{ marginTop: 16 }}>
        <strong>결론</strong>
        {splitParagraphs(notes.reportSummary.conclusion).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>
    </div>
  );
}

function TopicReportSections({ notes }: { notes: MeetingNotesV2Record }) {
  const topics = getTopicReportSections(notes);

  if (topics.length === 0) {
    return <p className="emptyState">표시할 주제별 요약이 없습니다.</p>;
  }

  return (
    <ul className="detailList">
      {topics.map((item) => (
        <li key={item.id}>
          <strong>{cleanUserText(item.title)}</strong>
          {item.paragraphs.map((paragraph) => (
            <p key={paragraph}>{cleanUserText(paragraph)}</p>
          ))}
        </li>
      ))}
    </ul>
  );
}

async function resolveSession(
  sessionId: string,
  includeAuditEvents: boolean
): Promise<{
  snapshot: SessionSnapshotRecord | null;
  session: ReturnType<typeof decorateSessionRecord> | null;
  auditEvents: AuditEventRecord[];
}> {
  try {
    const snapshot = await fetchSessionSnapshotById(sessionId);
    const session = decorateSessionRecord(
      snapshot.session,
      snapshot.notes?.notes
    );
    let auditEvents: AuditEventRecord[] = [];

    if (includeAuditEvents) {
      try {
        auditEvents = await fetchSessionAuditEvents(sessionId, 12);
      } catch {
        auditEvents = [];
      }
    }

    return { snapshot, session, auditEvents };
  } catch (error) {
    if (isAuthError(error)) {
      throw error;
    }

    return { snapshot: null, session: null, auditEvents: [] };
  }
}

export default async function SessionDetailPage({
  params,
  searchParams
}: {
  params: { sessionId: string };
  searchParams?: { debug?: string; desktop_shell?: string };
}) {
  const showDiagnostics = searchParams?.debug === "1";
  let resolved: Awaited<ReturnType<typeof resolveSession>>;
  try {
    resolved = await resolveSession(params.sessionId, showDiagnostics);
  } catch (error) {
    if (isAuthError(error)) {
      redirect(`/login?next=/sessions/${encodeURIComponent(params.sessionId)}`);
    }
    throw error;
  }
  const { snapshot, session, auditEvents } = resolved;
  const closeHref = searchParams?.desktop_shell === "1" ? "/?desktop_shell=1" : "/";

  if (!session || shouldHidePortalSession(session)) {
    notFound();
  }

  const readableTranscript = await resolveReadableTranscript(snapshot);
  const transcriptPreview =
    readableTranscript?.text ??
    snapshot?.transcriptText ??
    "아직 대화 기록이 저장되지 않았습니다.";
  const notes = snapshot?.notes?.notes;
  const notesV2 = isMeetingNotesV2(notes) ? notes : null;
  const transcriptSegments = readableTranscript?.segments?.slice(0, 8) ?? [];
  const readyArtifacts = session.artifacts.filter(
    (artifact) => artifact.status === "ready"
  );
  const hasSourceAudio = session.localAudioPath.trim().length > 0;
  const hasStructuredPanel = notesV2
    ? notesV2.decisions.length > 0 ||
      notesV2.actionItems.length > 0 ||
      notesV2.openIssues.length > 0 ||
      notesV2.risks.length > 0
    : session.decisions.length > 0 || session.actionItems.length > 0;

  return (
    <main className="pageShell">
      <section className="pageHeaderCard">
        <div className="pageHeader">
          <div>
            <p className="sectionEyebrow">{modeLabels[session.mode]}</p>
            <h1 className="pageTitle">{session.title}</h1>
            <StorySummary value={session.summary} />
          </div>
          <div className="pageHeaderActions">
            <StatusPill status={session.status} />
            <a href={closeHref} className="ghostButton ghostButtonSecondary pageCloseButton">
              닫기
            </a>
          </div>
        </div>
      </section>

      <section className="detailLayout detailLayoutCompact">
        {notesV2 ? (
          <article className="detailPanel detailPanelWide">
            <h2 className="sectionTitle">보고용 요약</h2>
            <p>
              <strong>한 줄 결론</strong> · {cleanUserText(notesV2.oneLineConclusion)}
            </p>
            <ReportSummary notes={notesV2} />
            {notesV2.keywords.length > 0 ? (
              <p>{`키워드: ${notesV2.keywords.map(cleanUserText).join(", ")}`}</p>
            ) : null}
            {notesV2.reviewFlags.length > 0 ? (
              <p>{`${notesV2.reviewFlags.length}개 항목은 아래 확인 필요 항목에서 따로 점검하세요.`}</p>
            ) : null}
          </article>
        ) : null}

        {hasStructuredPanel ? (
          <article className="detailPanel">
            {notesV2 && notesV2.decisions.length > 0 ? (
              <>
                <h2 className="sectionTitle">결정사항</h2>
                <ul className="insightList">
                  {notesV2.decisions.map((decision) => (
                    <li key={decision.decision} className="insightItem">
                      <span>{cleanUserText(decision.decision)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : session.decisions.length > 0 ? (
              <>
                <h2 className="sectionTitle">핵심 정리</h2>
                <ul className="insightList">
                  {session.decisions.map((decision) => (
                    <li key={decision} className="insightItem">
                      <span>{cleanUserText(decision)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {notesV2 && notesV2.actionItems.length > 0 ? (
              <>
                <h2 className="sectionTitle" style={{ marginTop: notesV2.decisions.length > 0 ? 24 : 0 }}>
                  액션아이템
                </h2>
                <ul className="insightList">
                  {notesV2.actionItems.map((item, index) => (
                    <li key={`action-${index}-${item.task}`} className="insightItem">
                      <span>{cleanUserText(item.task)}</span>
                      <small>
                        {[buildMetaLabel("담당", item.owner), buildMetaLabel("기한", item.dueDate)]
                          .filter(Boolean)
                          .join(" · ") || "담당/기한 확인 필요"}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            ) : session.actionItems.length > 0 ? (
              <>
                <h2 className="sectionTitle" style={{ marginTop: session.decisions.length > 0 ? 24 : 0 }}>
                  다음 할 일
                </h2>
                <ul className="insightList">
                  {session.actionItems.map((item, index) => (
                    <li key={`legacy-action-${index}-${item.task}`} className="insightItem">
                      <span>{cleanUserText(item.task)}</span>
                      {item.owner || item.dueDate ? (
                        <small>
                          {[buildMetaLabel("담당", item.owner), buildMetaLabel("기한", item.dueDate)]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </article>
        ) : null}

        {notesV2 &&
        (notesV2.openIssues.length > 0 ||
          notesV2.risks.length > 0 ||
          notesV2.reviewFlags.length > 0) ? (
          <article className="detailPanel">
            {notesV2.openIssues.length > 0 ? (
              <>
                <h2 className="sectionTitle">미결사항</h2>
                <ul className="detailList">
                  {notesV2.openIssues.map((issue) => (
                    <li key={issue.content}>
                      {cleanUserText(issue.content)}
                      <br />
                      {`다음 조치: ${cleanUserText(issue.suggestedNextAction)}`}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {notesV2.risks.length > 0 ? (
              <>
                <h2 className="sectionTitle" style={{ marginTop: notesV2.openIssues.length > 0 ? 24 : 0 }}>
                  리스크
                </h2>
                <ul className="detailList">
                  {notesV2.risks.map((risk) => (
                    <li key={risk.content}>
                      {cleanUserText(risk.content)}
                      <br />
                      {`완화책: ${cleanUserText(risk.mitigation)}`}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {notesV2.reviewFlags.length > 0 ? (
              <>
                <h2
                  className="sectionTitle"
                  style={{
                    marginTop:
                      notesV2.openIssues.length > 0 || notesV2.risks.length > 0 ? 24 : 0
                  }}
                >
                  확인 필요 항목
                </h2>
                <ul className="detailList">
                  {notesV2.reviewFlags.map((flag) => (
                    <li key={`${flag.flagType}-${flag.message}`}>
                      {cleanUserText(flag.message)}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </article>
        ) : null}

        {notesV2 ? (
          <article className="detailPanel detailPanelWide">
            <h2 className="sectionTitle">주제별 요약</h2>
            <TopicReportSections notes={notesV2} />
          </article>
        ) : null}

        <article className="detailPanel">
          <h2 className="sectionTitle">기록 정보</h2>
          <ul className="detailList">
            {showDiagnostics ? <li>{`세션 ID: ${session.id}`}</li> : null}
            <li>{`모드: ${modeLabels[session.mode]}`}</li>
            <li>{`프로젝트: ${session.projectKey ?? "개인 기록"}`}</li>
            <li>{`시작 시각: ${formatKoreanDateTime(session.startedAt)}`}</li>
            <li>{`준비된 결과물: ${session.artifacts.filter((artifact) => artifact.status === "ready").length}개`}</li>
          </ul>

          <h2 className="sectionTitle" style={{ marginTop: 24 }}>
            다운로드
          </h2>
          {hasSourceAudio || readyArtifacts.length > 0 ? (
            <ul className="detailList">
              {hasSourceAudio ? (
                <li>
                  <a
                    className="inlineLink"
                    href={getSessionSourceAudioDownloadHref(session.id)}
                    download
                  >
                    원본 음성 다운로드
                  </a>
                </li>
              ) : null}
              {readyArtifacts.map((artifact) => (
                <li key={`download-${artifact.kind}`}>
                  <a
                    className="inlineLink"
                    href={getSessionArtifactDownloadHref(session.id, artifact.kind)}
                    download
                  >
                    {artifactDownloadLabels[artifact.kind] ?? artifact.kind}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="emptyState">아직 다운로드할 원본 음성이나 결과물이 없습니다.</p>
          )}

          <h2 className="sectionTitle" style={{ marginTop: 24 }}>
            대화 기록 미리보기
          </h2>
          <div className="transcriptBlock">
            {transcriptSegments.length > 0
              ? transcriptSegments
                  .map(
                    (segment) =>
                      `[${formatClock(segment.startMs)}-${formatClock(
                        segment.endMs
                      )}] ${cleanTranscriptText(segment.text)}`
                  )
                  .join("\n\n")
              : cleanTranscriptText(transcriptPreview)}
          </div>
        </article>

        {showDiagnostics ? (
          <article className="detailPanel detailPanelWide">
            <h2 className="sectionTitle">처리 기록</h2>
            <div className="auditRail">
              {auditEvents.length > 0 ? (
                auditEvents.map((event) => (
                  <div key={event.eventId} className="auditRow">
                    <div className="auditDot" />
                    <div className="auditMeta">
                      <strong>{formatAuditLabel(event.kind)}</strong>
                      <span>
                        {formatKoreanDateTime(event.createdAt)} ·{" "}
                        {buildAuditPayloadPreview(event.payload)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="emptyState">기록된 감사 이벤트가 없습니다.</p>
              )}
            </div>
          </article>
        ) : null}
      </section>
    </main>
  );
}
