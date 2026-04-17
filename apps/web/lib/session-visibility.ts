import type { SessionPortalRecord } from "./demo-data";

const internalSessionTitlePattern =
  /smoke|harness|append only|server process|automation save test/i;

export function shouldHidePortalSession(
  session: Pick<SessionPortalRecord, "id" | "title">
) {
  return (
    session.id.startsWith("sess_demo_") ||
    internalSessionTitlePattern.test(session.title)
  );
}

export function filterVisiblePortalSessions(records: SessionPortalRecord[]) {
  return records.filter((record) => !shouldHidePortalSession(record));
}
