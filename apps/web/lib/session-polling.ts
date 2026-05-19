import type { SessionStatus } from "@mystt/audio-core";

export const activePortalSessionStatuses: SessionStatus[] = [
  "recording",
  "uploading",
  "transcribing",
  "summarizing",
  "emailing"
];

export function hasActivePortalSession(
  sessions: Array<{ status: SessionStatus }>
) {
  return sessions.some((session) =>
    activePortalSessionStatuses.includes(session.status)
  );
}
