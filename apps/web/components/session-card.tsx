"use client";

import Link from "next/link";

import { modeLabels } from "@mystt/ui-kit";

import { StatusPill } from "./status-pill";
import type { SessionPortalRecord } from "../lib/demo-data";

export function SessionCard({
  session,
  selected = false,
  onSelect
}: {
  session: SessionPortalRecord;
  selected?: boolean;
  onSelect?: (session: SessionPortalRecord) => void;
}) {
  const content = (
    <>
      <div className="sessionTop">
        <div>
          <p className="eyebrow">{modeLabels[session.mode]}</p>
          <h3>{session.title}</h3>
        </div>
        <StatusPill status={session.status} />
      </div>
      <p className="summary">{session.summary}</p>
      <div className="metaRow">
        <span>{session.projectKey ?? "공통"}</span>
        <span>대기 청크 {session.pendingChunkCount}개</span>
      </div>
      <div className="sessionDigest">
        {session.actionItems.slice(0, 2).map((item) => (
          <span key={`${item.task}-${item.owner ?? "none"}`} className="digestChip">
            {item.task}
          </span>
        ))}
      </div>
    </>
  );

  const className = selected ? "sessionCard sessionCardSelected" : "sessionCard";

  if (onSelect) {
    return (
      <button
        type="button"
        className={`${className} sessionCardButton`}
        onClick={() => onSelect(session)}
      >
        {content}
      </button>
    );
  }

  return (
    <article className={className}>
      {content}
      <Link href={`/sessions/${session.id}`} className="ghostButton">
        세션 열기
      </Link>
    </article>
  );
}
