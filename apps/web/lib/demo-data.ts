import type { SessionRecord } from "@mystt/audio-core";
import { modeLabels, statusLabels } from "@mystt/ui-kit";

import type { SessionNotesRecord } from "./api";

export interface SessionPortalRecord extends SessionRecord {
  summary: string;
  decisions: string[];
  actionItems: Array<{ task: string; owner: string | null; dueDate: string | null }>;
  hasStructuredNotes: boolean;
}

function buildFallbackNarrative(session: SessionRecord) {
  return {
    summary: `${modeLabels[session.mode]} 세션이 ${statusLabels[session.status]} 상태입니다. 대기 청크 ${session.pendingChunkCount}개, 준비된 아티팩트 ${session.artifacts.filter((artifact) => artifact.status === "ready").length}개입니다.`,
    decisions: [],
    actionItems: []
  };
}

function buildNarrativeFromNotes(notes: SessionNotesRecord) {
  if (notes.mode === "meeting") {
    return {
      summary: notes.summary,
      decisions: notes.decisions.map((item) => item.decision),
      actionItems: notes.actionItems.map((item) => ({
        task: item.task,
        owner: item.owner,
        dueDate: item.dueDate
      }))
    };
  }

  if (notes.mode === "speech") {
    return {
      summary: notes.summary,
      decisions: notes.keyMessages,
      actionItems: notes.audienceQna.slice(0, 3).map((item) => ({
        task: item.question,
        owner: null,
        dueDate: null
      }))
    };
  }

  return {
    summary: notes.summary,
    decisions: notes.keyInsights,
    actionItems: notes.followUpQuestions.slice(0, 3).map((item) => ({
      task: item,
      owner: null,
      dueDate: null
    }))
  };
}

export function decorateSessionRecord(
  session: SessionRecord,
  notes?: SessionNotesRecord
): SessionPortalRecord {
  const narrative = notes ? buildNarrativeFromNotes(notes) : buildFallbackNarrative(session);
  const hasStructuredNotes = Boolean(
    notes &&
      (
        narrative.decisions.length > 0 ||
        narrative.actionItems.length > 0 ||
        narrative.summary.trim().length > 0
      )
  );

  return {
    ...session,
    summary: narrative.summary,
    decisions: narrative.decisions,
    actionItems: narrative.actionItems,
    hasStructuredNotes
  };
}
