"use client";

import type { MouseEvent, ReactNode } from "react";

import { modeLabels } from "@mystt/ui-kit";

import type { SessionPortalRecord } from "../lib/demo-data";
import { formatKoreanCompactDateTime } from "../lib/format";
import { StatusPill } from "./status-pill";

export function SessionRow({
  session,
  detailHref,
  isDeleting,
  isDeletePending,
  canDownloadAudio,
  onOpen,
  onDownloadAudio,
  onSendMail,
  onDelete
}: {
  session: SessionPortalRecord;
  detailHref: string;
  isDeleting: boolean;
  isDeletePending: boolean;
  canDownloadAudio: boolean;
  onOpen: (sessionId: string) => void;
  onDownloadAudio: (session: SessionPortalRecord) => void;
  onSendMail: (session: SessionPortalRecord) => void;
  onDelete: (session: SessionPortalRecord) => void;
}) {
  function stopRowClick(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  return (
    <article className="sessionRow sessionRowCompact">
      <div className="sessionRowShell">
        <button
          type="button"
          className="sessionRowTrigger"
          onClick={() => onOpen(session.id)}
        >
          <div className="sessionRowLead">
            <strong className="sessionRowTitle">{session.title}</strong>
            <span className="sessionRowSnippet">{session.summary}</span>
          </div>
          <div className="sessionRowMeta">
            <span className="inlineMeta">{modeLabels[session.mode]}</span>
            <span className="inlineMeta">{formatKoreanCompactDateTime(session.startedAt)}</span>
            <StatusPill status={session.status} />
            <span className="rowToggleText">보기</span>
          </div>
        </button>

        <div className="sessionRowActions">
          <button
            type="button"
            className="sessionIconButton"
            aria-label="음성 다운로드"
            title={canDownloadAudio ? "음성 다운로드" : "원본 음성이 아직 없습니다"}
            disabled={!canDownloadAudio}
            onClick={(event) => {
              stopRowClick(event);
              onDownloadAudio(session);
            }}
          >
            <AudioDownloadIcon />
          </button>

          <button
            type="button"
            className="sessionIconButton"
            aria-label="공유"
            title="공유"
            onClick={(event) => {
              stopRowClick(event);
              onSendMail(session);
            }}
          >
            <MailIcon />
          </button>

          <a
            className="sessionIconButton"
            aria-label="상세 페이지"
            title="상세 페이지 열기"
            href={detailHref}
            onClick={stopRowClick}
          >
            <PaperIcon />
          </a>

          <button
            type="button"
            className={
              isDeletePending
                ? "sessionIconButton sessionIconButtonDanger sessionIconButtonDangerActive"
                : "sessionIconButton sessionIconButtonDanger"
            }
            aria-label={isDeletePending ? "한 번 더 누르면 삭제" : "삭제"}
            title={isDeletePending ? "한 번 더 누르면 삭제" : "기록 삭제"}
            disabled={isDeleting}
            onClick={(event) => {
              stopRowClick(event);
              onDelete(session);
            }}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </article>
  );
}

function IconFrame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

function AudioDownloadIcon() {
  return (
    <IconFrame>
      <path d="M10 3v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="m6.8 8.8 3.2 3.4 3.2-3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </IconFrame>
  );
}

function MailIcon() {
  return (
    <IconFrame>
      <rect x="3.5" y="5" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4.5 6.3 5.5 4.2 5.5-4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </IconFrame>
  );
}

function PaperIcon() {
  return (
    <IconFrame>
      <path d="M6 3.5h5.5L15 7v9.5H6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M11.5 3.5V7H15" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 10h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 12.8h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </IconFrame>
  );
}

function TrashIcon() {
  return (
    <IconFrame>
      <path d="M5.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 6V4.5h4V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 6.5v8h6v-8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 8.8v3.8M11 8.8v3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </IconFrame>
  );
}
