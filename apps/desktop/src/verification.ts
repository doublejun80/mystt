import type { TauriRecorderPersistedSessionEntry } from "@mystt/audio-core";

export interface DesktopVerificationOptions {
  openDiagnosticsOnLaunch: boolean;
  autostartKeepAwakeOnLaunch: boolean;
  diagnosticsScrollTarget: string | null;
}

export interface DesktopDownloadSavedEvidence {
  requestedUrl: string;
  savedPath: string;
  byteLength: number;
}

export interface DesktopDownloadEvidenceResult {
  ok: boolean;
  detail: string;
}

export function resolveDesktopVerificationOptions(
  env: Record<string, unknown>
): DesktopVerificationOptions {
  return {
    openDiagnosticsOnLaunch: env.VITE_DESKTOP_OPEN_DIAGNOSTICS === "1",
    autostartKeepAwakeOnLaunch: env.VITE_DESKTOP_AUTOSTART_KEEP_AWAKE === "1",
    diagnosticsScrollTarget:
      typeof env.VITE_DESKTOP_SCROLL_TARGET === "string" &&
      env.VITE_DESKTOP_SCROLL_TARGET.trim().length > 0
        ? env.VITE_DESKTOP_SCROLL_TARGET
        : null
  };
}

export function buildRecentSessionLines(recentSessions: TauriRecorderPersistedSessionEntry[]) {
  if (recentSessions.length === 0) {
    return ["recent_sessions: 없음"];
  }

  return recentSessions.map((session, index) => {
    const title = session.session.title || "제목 없음";
    return `recent_sessions[${index}]: ${title} · ${session.session.id} · ${session.savedAt}`;
  });
}

export function formatDesktopBridgeError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

export function sanitizeDesktopDownloadFileName(fileName: string) {
  const cleaned = fileName
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ");

  return cleaned || "mystt-audio";
}

export function normalizeDesktopDownloadFileName(fileName: string) {
  const sanitized = sanitizeDesktopDownloadFileName(fileName);
  const lastDot = sanitized.lastIndexOf(".");
  const stem = lastDot > 0 ? sanitized.slice(0, lastDot) : sanitized;

  return `${stem}.mp3`;
}

export function resolveDesktopSourceAudioDownloadUrl(
  downloadUrl: string,
  pageUrl: string
): string | null {
  const trimmedUrl = downloadUrl.trim();

  if (!trimmedUrl) {
    return null;
  }

  try {
    const resolved = new URL(trimmedUrl, pageUrl);

    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }

    if (!resolved.pathname.endsWith("/source-audio")) {
      return null;
    }

    resolved.searchParams.delete("inline");
    resolved.searchParams.set("format", "mp3");
    return resolved.toString();
  } catch {
    return null;
  }
}

export function assertDesktopDownloadSavedEvidence(
  evidence: DesktopDownloadSavedEvidence
): DesktopDownloadEvidenceResult {
  let requestedMp3 = false;
  try {
    requestedMp3 = new URL(evidence.requestedUrl).searchParams.get("format") === "mp3";
  } catch {
    requestedMp3 = false;
  }

  if (!requestedMp3) {
    return {
      ok: false,
      detail: "download URL did not request format=mp3"
    };
  }

  if (!evidence.savedPath.toLowerCase().endsWith(".mp3")) {
    return {
      ok: false,
      detail: "saved filename is not .mp3"
    };
  }

  if (!Number.isFinite(evidence.byteLength) || evidence.byteLength <= 0) {
    return {
      ok: false,
      detail: "saved file is empty"
    };
  }

  return {
    ok: true,
    detail: `saved ${evidence.savedPath} (${evidence.byteLength} bytes)`
  };
}
