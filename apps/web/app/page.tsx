import { redirect } from "next/navigation";

import { SessionHarness } from "../components/session-harness";
import { fetchApiHealth, fetchPortalSessions } from "../lib/api";
import { decorateSessionRecord } from "../lib/demo-data";
import { filterVisiblePortalSessions } from "../lib/session-visibility";

function isAuthError(error: unknown) {
  return error instanceof Error && /authentication required|access token required/i.test(error.message);
}

export default async function PortalHomePage({
  searchParams
}: {
  searchParams?: {
    desktop_shell?: string;
    portal_role?: string;
  };
}) {
  const isDesktopShell = searchParams?.desktop_shell === "1";
  const isReviewOnly = searchParams?.portal_role === "review";

  try {
    const [health, sessions] = await Promise.all([
      fetchApiHealth(),
      fetchPortalSessions()
    ]);

    return (
      <SessionHarness
        isDesktopShell={isDesktopShell}
        reviewOnly={isReviewOnly}
        initialHealth={health}
        initialSessions={filterVisiblePortalSessions(
          sessions.map((snapshot) =>
            decorateSessionRecord(snapshot.session, snapshot.notes?.notes)
          )
        )}
      />
    );
  } catch (error) {
    if (isAuthError(error)) {
      redirect("/login?next=/");
    }

    return (
      <SessionHarness
        isDesktopShell={isDesktopShell}
        reviewOnly={isReviewOnly}
        initialError={
          error instanceof Error
            ? error.message
            : "최근 기록을 불러오지 못했습니다."
        }
      />
    );
  }
}
