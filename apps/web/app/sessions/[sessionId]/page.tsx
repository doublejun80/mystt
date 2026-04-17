import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusPill } from "../../../components/status-pill";
import {
  fetchSessionAuditEvents,
  fetchSessionSnapshotById,
  type AuditEventRecord,
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

async function resolveSession(sessionId: string): Promise<{
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

    try {
      auditEvents = await fetchSessionAuditEvents(sessionId, 12);
    } catch {
      auditEvents = [];
    }

    return { snapshot, session, auditEvents };
  } catch {
    return { snapshot: null, session: null, auditEvents: [] };
  }
}

export default async function SessionDetailPage({
  params,
  searchParams
}: {
  params: { sessionId: string };
  searchParams?: { desktop_shell?: string };
}) {
  const { snapshot, session, auditEvents } = await resolveSession(params.sessionId);
  const closeHref = searchParams?.desktop_shell === "1" ? "/?desktop_shell=1" : "/";

  if (!session || shouldHidePortalSession(session)) {
    notFound();
  }

  const transcriptPreview =
    snapshot?.normalizedTranscript?.text ??
    snapshot?.transcriptText ??
    "아직 대화 기록이 저장되지 않았습니다.";
  const hasStructuredPanel =
    session.decisions.length > 0 || session.actionItems.length > 0;

  return (
    <main className="pageShell">
      <section className="pageHeaderCard">
        <div className="pageHeader">
          <div>
            <p className="sectionEyebrow">{modeLabels[session.mode]}</p>
            <h1 className="pageTitle">{session.title}</h1>
            <p className="pageHeaderCopy">{session.summary}</p>
          </div>
          <div className="pageHeaderActions">
            <StatusPill status={session.status} />
            <Link href={closeHref} className="ghostButton ghostButtonSecondary pageCloseButton">
              닫기
            </Link>
          </div>
        </div>
      </section>

      <section className="detailLayout detailLayoutCompact">
        {hasStructuredPanel ? (
          <article className="detailPanel">
            {session.decisions.length > 0 ? (
              <>
                <h2 className="sectionTitle">핵심 정리</h2>
                <ul className="detailList">
                  {session.decisions.map((decision) => <li key={decision}>{decision}</li>)}
                </ul>
              </>
            ) : null}

            {session.actionItems.length > 0 ? (
              <>
                <h2 className="sectionTitle" style={{ marginTop: session.decisions.length > 0 ? 24 : 0 }}>
                  다음 할 일
                </h2>
                <ul className="detailList">
                  {session.actionItems.map((item) => (
                    <li key={`${item.task}-${item.owner ?? "none"}`}>
                      {item.task}
                      {item.owner ? ` · ${item.owner}` : ""}
                      {item.dueDate ? ` · ${item.dueDate}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </article>
        ) : null}

        <article className="detailPanel">
          <h2 className="sectionTitle">기록 정보</h2>
          <ul className="detailList">
            <li>{`세션 ID: ${session.id}`}</li>
            <li>{`모드: ${modeLabels[session.mode]}`}</li>
            <li>{`프로젝트: ${session.projectKey ?? "개인 기록"}`}</li>
            <li>{`시작 시각: ${formatKoreanDateTime(session.startedAt)}`}</li>
            <li>{`준비된 결과물: ${session.artifacts.filter((artifact) => artifact.status === "ready").length}개`}</li>
          </ul>

          <h2 className="sectionTitle" style={{ marginTop: 24 }}>
            대화 기록 미리보기
          </h2>
          <div className="transcriptBlock">{transcriptPreview}</div>
        </article>

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
      </section>
    </main>
  );
}
