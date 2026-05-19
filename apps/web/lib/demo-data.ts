import type { SessionRecord } from "@mystt/audio-core";
import { modeLabels, statusLabels } from "@mystt/ui-kit";

import type { SessionNotesRecord } from "./api";
import { cleanUserFacingText } from "./user-facing-text";

export interface SessionPortalRecord extends SessionRecord {
  summary: string;
  decisions: string[];
  actionItems: Array<{ task: string; owner: string | null; dueDate: string | null }>;
  hasStructuredNotes: boolean;
}

function buildFallbackNarrative(session: SessionRecord) {
  return {
    summary: cleanUserFacingText(
      `${modeLabels[session.mode]} 세션이 ${statusLabels[session.status]} 상태입니다. 대기 청크 ${session.pendingChunkCount}개, 준비된 아티팩트 ${session.artifacts.filter((artifact) => artifact.status === "ready").length}개입니다.`
    ),
    decisions: [],
    actionItems: []
  };
}

function buildNarrativeFromNotes(notes: SessionNotesRecord) {
  if (notes.mode === "meeting") {
    return {
      summary:
        "schemaVersion" in notes && notes.schemaVersion === "meeting_notes_v2"
          ? cleanUserFacingText(notes.oneLineConclusion)
          : cleanUserFacingText(notes.summary),
      decisions: notes.decisions.map((item) => cleanUserFacingText(item.decision)),
      actionItems: notes.actionItems.map((item) => ({
        task: cleanUserFacingText(item.task),
        owner: item.owner ? cleanUserFacingText(item.owner) : null,
        dueDate: item.dueDate ? cleanUserFacingText(item.dueDate) : null
      }))
    };
  }

  if (notes.mode === "speech") {
    return {
      summary: cleanUserFacingText(notes.summary),
      decisions: notes.keyMessages.map(cleanUserFacingText),
      actionItems: notes.audienceQna.slice(0, 3).map((item) => ({
        task: cleanUserFacingText(item.question),
        owner: null,
        dueDate: null
      }))
    };
  }

  return {
    summary: cleanUserFacingText(notes.summary),
    decisions: notes.keyInsights.map(cleanUserFacingText),
    actionItems: notes.followUpQuestions.slice(0, 3).map((item) => ({
      task: cleanUserFacingText(item),
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
