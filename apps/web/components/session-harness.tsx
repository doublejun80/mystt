"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import {
  deletePortalSession,
  fetchApiHealth,
  fetchPortalSessions,
  getSessionArtifactHref,
  getSessionSourceAudioHref,
  sendSessionShareEmail,
  updatePortalSessionTitle,
  type ApiHealth
} from "../lib/api";
import {
  resolveDesktopDownloadUrl
} from "../lib/desktop-download";
import {
  decorateSessionRecord,
  type SessionPortalRecord
} from "../lib/demo-data";
import {
  describePortalStorageState,
  hasPortalSourceAudio,
  hasReadyPortalArtifact
} from "../lib/session-assets";
import { formatKoreanTime } from "../lib/format";
import {
  cleanUserFacingText,
  splitUserFacingStoryParagraphs
} from "../lib/user-facing-text";
import {
  defaultRecorderPreferences,
  endpointDelayOptions,
  portalThemeOptions,
  type PortalTheme,
  type RecorderPreferences
} from "../lib/recorder-settings";
import {
  activePortalSessionStatuses,
  hasActivePortalSession
} from "../lib/session-polling";
import { filterVisiblePortalSessions } from "../lib/session-visibility";
import { LiveRecorder } from "./live-recorder";
import { SessionRow } from "./session-row";

const activeSessionRefreshIntervalMs = 10_000;
const preferencesStorageKey = "mystt.portal.preferences";
const shareRecipientsStorageKey = "mystt.portal.shareRecipients";
const portalThemeColorById: Record<PortalTheme, string> = {
  sand: "#121327",
  sage: "#05100c",
  sky: "#050913"
};
const defaultShareSelection = {
  includeSummary: true,
  includeDetails: true,
  includeAudio: false
};

type ShareSelection = typeof defaultShareSelection;

function buildTitleBasedAudioFileName(title: string) {
  const safeTitle = title
    .trim()
    .replace(/[^\w.\-가-힣]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${safeTitle || "mystt-recording"}.mp3`;
}

function StorySummary({ value }: { value: string }) {
  const paragraphs = splitUserFacingStoryParagraphs(value);

  if (paragraphs.length === 0) {
    return null;
  }

  return (
    <section className="storySummary storySummaryCompact" aria-label="줄거리">
      <p className="storySummaryLabel">줄거리</p>
      {paragraphs.map((paragraph) => (
        <p key={paragraph} className="storySummaryParagraph">
          {paragraph}
        </p>
      ))}
    </section>
  );
}

function sortSessions(records: SessionPortalRecord[]) {
  return [...records].sort(
    (left, right) =>
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}

function resolveArtifactHref(
  session: SessionPortalRecord,
  kind: "clean_transcript_md" | "meeting_notes_docx"
) {
  if (!hasReadyPortalArtifact(session, kind)) {
    return null;
  }

  return getSessionArtifactHref(session.id, kind);
}

export function SessionHarness({
  initialSessions,
  initialHealth = null,
  initialError = null,
  isDesktopShell = false,
  reviewOnly = false
}: {
  initialSessions?: SessionPortalRecord[];
  initialHealth?: ApiHealth | null;
  initialError?: string | null;
  isDesktopShell?: boolean;
  reviewOnly?: boolean;
}) {
  const seededSessions = initialSessions && initialSessions.length > 0
    ? sortSessions(filterVisiblePortalSessions(initialSessions))
    : [];
  const [sessions, setSessions] = useState<SessionPortalRecord[]>(seededSessions);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [health, setHealth] = useState<ApiHealth | null>(initialHealth);
  const [error, setError] = useState<string | null>(initialError);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(8);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(true);
  const [preferences, setPreferences] = useState<RecorderPreferences>(
    defaultRecorderPreferences
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(
    !Boolean(initialSessions?.length)
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [titleEditSessionId, setTitleEditSessionId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitleSessionId, setSavingTitleSessionId] = useState<string | null>(null);
  const [shareSessionId, setShareSessionId] = useState<string | null>(null);
  const [shareSelection, setShareSelection] = useState<ShareSelection>(
    defaultShareSelection
  );
  const [shareRecipients, setShareRecipients] = useState("");
  const [shareIdempotencyKey, setShareIdempotencyKey] = useState("");
  const deferredSearch = useDeferredValue(search);

  const loadWorkspace = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const [healthPayload, sessionPayload] = await Promise.all([
        fetchApiHealth(),
        fetchPortalSessions()
      ]);

      const decorated = sortSessions(
        filterVisiblePortalSessions(
          sessionPayload.map((snapshot) =>
            decorateSessionRecord(snapshot.session, snapshot.notes?.notes)
          )
        )
      );

      setHealth(healthPayload);
      setSessions(decorated);
      setError(null);
    } catch (loadError) {
      setHealth(null);
      setSessions([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "최근 기록을 불러오지 못했습니다."
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const refreshWorkspacePreservingSessions = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const [healthPayload, sessionPayload] = await Promise.all([
        fetchApiHealth(),
        fetchPortalSessions()
      ]);
      const decorated = sortSessions(
        filterVisiblePortalSessions(
          sessionPayload.map((snapshot) =>
            decorateSessionRecord(snapshot.session, snapshot.notes?.notes)
          )
        )
      );

      setHealth(healthPayload);
      setSessions(decorated);
      setError(null);
      return true;
    } catch (loadError) {
      setHealth(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "최근 기록을 불러오지 못했습니다."
      );
      return false;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (initialSessions && initialSessions.length > 0) {
      return;
    }

    void loadWorkspace();
  }, [initialSessions, loadWorkspace]);

  const hasActiveSessions = useMemo(
    () => hasActivePortalSession(sessions),
    [sessions]
  );

  useEffect(() => {
    if (!hasActiveSessions) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshWorkspacePreservingSessions();
    }, activeSessionRefreshIntervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [hasActiveSessions, refreshWorkspacePreservingSessions]);

  useEffect(() => {
    function onPortalCommand(event: MessageEvent) {
      const payload =
        event.data && typeof event.data === "object"
          ? (event.data as { type?: string })
          : null;

      switch (payload?.type) {
        case "mystt.portal.toggleSettings":
          setIsSettingsOpen((current) => !current);
          break;
        case "mystt.portal.openSettings":
          setIsSettingsOpen(true);
          break;
        case "mystt.portal.closeSettings":
          setIsSettingsOpen(false);
          break;
        case "mystt.portal.refresh":
          void loadWorkspace();
          break;
        default:
          break;
      }
    }

    window.addEventListener("message", onPortalCommand);
    return () => window.removeEventListener("message", onPortalCommand);
  }, [loadWorkspace]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(preferencesStorageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<RecorderPreferences>;
      setPreferences({
        ...defaultRecorderPreferences,
        ...parsed
      });
    } catch {
      window.localStorage.removeItem(preferencesStorageKey);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(preferencesStorageKey, JSON.stringify(preferences));
    document.documentElement.dataset.theme = preferences.theme;
    const themeColor = portalThemeColorById[preferences.theme] ?? portalThemeColorById.sand;
    let themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!themeColorMeta) {
      themeColorMeta = document.createElement("meta");
      themeColorMeta.name = "theme-color";
      document.head.appendChild(themeColorMeta);
    }
    themeColorMeta.content = themeColor;
  }, [preferences]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(shareRecipientsStorageKey);
    if (stored) {
      setShareRecipients(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!shareRecipients.trim()) {
      window.localStorage.removeItem(shareRecipientsStorageKey);
      return;
    }

    window.localStorage.setItem(shareRecipientsStorageKey, shareRecipients);
  }, [shareRecipients]);

  useEffect(() => {
    if (!actionMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setActionMessage(null);
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  useEffect(() => {
    if (!pendingDeleteSessionId) {
      return;
    }

    const timer = window.setTimeout(() => {
      setPendingDeleteSessionId(null);
    }, 3200);

    return () => window.clearTimeout(timer);
  }, [pendingDeleteSessionId]);

  const filteredSessions = sessions.filter((session) => {
    const needle = deferredSearch.trim().toLowerCase();

    if (!needle) {
      return true;
    }

    return [
      session.title,
      session.projectKey ?? "",
      session.mode,
      session.status,
      session.summary
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const visibleSessions = deferredSearch.trim()
    ? filteredSessions
    : filteredSessions.slice(0, visibleCount);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions]
  );
  const shareSession = useMemo(
    () => sessions.find((session) => session.id === shareSessionId) ?? null,
    [shareSessionId, sessions]
  );
  const titleEditSession = useMemo(
    () => sessions.find((session) => session.id === titleEditSessionId) ?? null,
    [titleEditSessionId, sessions]
  );

  const activeCount = sessions.filter((session) =>
    activePortalSessionStatuses.includes(session.status)
  ).length;
  const completedCount = sessions.filter(
    (session) => session.status === "completed"
  ).length;
  const autoSummaryReady =
    health?.providers?.sonioxConfigured && health?.providers?.openaiConfigured;
  const storageState = describePortalStorageState(health);
  const selectedReadyArtifactCount = selectedSession
    ? selectedSession.artifacts.filter((artifact) => artifact.status === "ready").length
    : 0;

  function updatePreference<Key extends keyof RecorderPreferences>(
    key: Key,
    value: RecorderPreferences[Key]
  ) {
    setPreferences((current) => ({
      ...current,
      [key]: value
    }));
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleDesktopMessage = (event: MessageEvent) => {
      const payload =
        event.data && typeof event.data === "object"
          ? (event.data as {
              type?: string;
              path?: string;
              message?: string;
              sessionTitle?: string | null;
            })
          : null;

      if (!payload?.type) {
        return;
      }

      if (payload.type === "mystt.desktop.download-complete") {
        const prefix = payload.sessionTitle ? `"${payload.sessionTitle}" ` : "";
        setActionMessage(
          `${prefix}음성 파일을 ${payload.path ?? "Downloads 폴더"}에 저장했습니다.`
        );
      }

      if (payload.type === "mystt.desktop.download-failed") {
        setActionMessage(payload.message ?? "다운로드 폴더 저장에 실패했습니다.");
      }
    };

    window.addEventListener("message", handleDesktopMessage);
    return () => window.removeEventListener("message", handleDesktopMessage);
  }, []);

  function hasDownloadableAudio(session: SessionPortalRecord) {
    return hasPortalSourceAudio(session);
  }

  function buildShareDraft(session: SessionPortalRecord, selection: ShareSelection) {
    const transcriptHref = resolveArtifactHref(session, "clean_transcript_md");
    const notesDocxHref = resolveArtifactHref(session, "meeting_notes_docx");
    const modeLabel =
      session.mode === "meeting"
        ? "회의"
        : session.mode === "speech"
          ? "발표"
          : session.mode === "interview"
            ? "인터뷰"
            : session.mode;
    const bodyLines = [
      `[mystt] ${session.title}`,
      `모드: ${modeLabel}`,
      `기록 시각: ${formatKoreanTime(session.startedAt)}`
    ];

    if (selection.includeSummary) {
      bodyLines.push("", "요약");
      bodyLines.push(cleanUserFacingText(session.summary) || "요약이 아직 없습니다.");
      bodyLines.push("", "핵심 정리");
      bodyLines.push(
        ...(session.decisions.length > 0
          ? session.decisions.map((item) => `- ${cleanUserFacingText(item)}`)
          : ["- 없음"])
      );
      bodyLines.push("", "다음 할 일");
      bodyLines.push(
        ...(session.actionItems.length > 0
          ? session.actionItems.map(
              (item) =>
                `- ${cleanUserFacingText(item.task)}${item.owner ? ` / ${cleanUserFacingText(item.owner)}` : ""}${item.dueDate ? ` / ${cleanUserFacingText(item.dueDate)}` : ""}`
            )
          : ["- 없음"])
      );
    }

    if (selection.includeDetails) {
      bodyLines.push("", "상세 내역");
      bodyLines.push(`프로젝트: ${session.projectKey ?? "개인 기록"}`);
      bodyLines.push(`원문 첨부: ${transcriptHref ? "포함 예정" : "없음"}`);
      bodyLines.push(`회의록 첨부: ${notesDocxHref ? "포함 예정" : "없음"}`);
    }

    if (selection.includeAudio) {
      bodyLines.push("", "음성 파일");
      bodyLines.push(
        hasDownloadableAudio(session)
          ? "원본 음성 첨부: 포함 예정"
          : "원본 음성이 아직 없습니다."
      );
    }

    const subject = `[mystt] ${session.title}`;
    const bodyText = bodyLines.join("\n");

    return {
      subject,
      bodyText
    };
  }

  function openShareComposer(session: SessionPortalRecord) {
    setShareSessionId(session.id);
    setShareSelection({
      ...defaultShareSelection,
      includeAudio: false
    });
    setShareIdempotencyKey(
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `share-${Date.now()}`
    );
  }

  function updateShareSelection<Key extends keyof ShareSelection>(
    key: Key,
    value: ShareSelection[Key]
  ) {
    setShareSelection((current) => ({
      ...current,
      [key]: value
    }));
  }

  function parseShareRecipients(input: string) {
    return input
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function handleShareEmail() {
    if (!shareSession || typeof window === "undefined") {
      return;
    }

    const selectedCount = Object.values(shareSelection).filter(Boolean).length;
    const recipients = parseShareRecipients(shareRecipients);

    if (selectedCount === 0) {
      setActionMessage("공유할 항목을 하나 이상 선택해 주세요.");
      return;
    }

    if (recipients.length === 0) {
      setActionMessage("받는 사람 이메일을 하나 이상 입력해 주세요.");
      return;
    }

    try {
      const result = await sendSessionShareEmail({
        sessionId: shareSession.id,
        to: recipients,
        portalBaseUrl: window.location.origin,
        idempotencyKey: shareIdempotencyKey,
        includeSummary: shareSelection.includeSummary,
        includeDetails: shareSelection.includeDetails,
        includeAudio: shareSelection.includeAudio
      });
      setShareSessionId(null);
      const attachmentCount = result.attachmentSummary
        ? [
            result.attachmentSummary.transcriptAttached,
            result.attachmentSummary.notesAttached,
            result.attachmentSummary.audioAttached
          ].filter(Boolean).length
        : 0;
      setActionMessage(
        result.duplicate
          ? `"${shareSession.title}" 메일은 이미 보낸 요청이라 중복 발송하지 않았습니다.`
          : attachmentCount > 0
            ? `"${shareSession.title}" 메일을 보냈습니다. 첨부 ${attachmentCount}개를 포함했습니다.`
            : `"${shareSession.title}" 메일을 보냈습니다.`
      );
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "메일 발송에 실패했습니다."
      );
    }
  }

  async function handleCopyShare() {
    if (!shareSession || typeof navigator === "undefined" || !navigator.clipboard) {
      setActionMessage("이 환경에서는 클립보드 복사를 지원하지 않습니다.");
      return;
    }

    const selectedCount = Object.values(shareSelection).filter(Boolean).length;

    if (selectedCount === 0) {
      setActionMessage("공유할 항목을 하나 이상 선택해 주세요.");
      return;
    }

    const draft = buildShareDraft(shareSession, shareSelection);

    if (!draft) {
      return;
    }

    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.bodyText}`);
      setShareSessionId(null);
      setActionMessage(`"${shareSession.title}" 공유 내용을 복사했습니다.`);
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "공유 내용을 복사하지 못했습니다."
      );
    }
  }

  async function handleNativeShare() {
    if (!shareSession || typeof navigator === "undefined" || typeof navigator.share !== "function") {
      return;
    }

    const selectedCount = Object.values(shareSelection).filter(Boolean).length;

    if (selectedCount === 0) {
      setActionMessage("공유할 항목을 하나 이상 선택해 주세요.");
      return;
    }

    const draft = buildShareDraft(shareSession, shareSelection);

    if (!draft) {
      return;
    }

    try {
      await navigator.share({
        title: draft.subject,
        text: draft.bodyText
      });
      setShareSessionId(null);
      setActionMessage(`"${shareSession.title}" 시스템 공유를 열었습니다.`);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      setActionMessage(
        error instanceof Error ? error.message : "시스템 공유를 열지 못했습니다."
      );
    }
  }

  async function handleDownloadAudio(session: SessionPortalRecord) {
    if (!hasDownloadableAudio(session)) {
      setActionMessage("다운로드할 원본 음성이 아직 없습니다.");
      return;
    }

    const mp3FileName = buildTitleBasedAudioFileName(session.title);
    const sourceAudioDownloadHref = getSessionSourceAudioHref(session.id, {
      format: "mp3"
    });
    const desktopDownloadUrl =
      typeof window !== "undefined"
        ? resolveDesktopDownloadUrl(
            sourceAudioDownloadHref,
            window.location.href
          )
        : null;

    if (
      isDesktopShell &&
      typeof window !== "undefined" &&
      window.parent !== window &&
      desktopDownloadUrl
    ) {
      window.parent.postMessage(
        {
          type: "mystt.desktop.download-file",
          url: desktopDownloadUrl,
          fileName: mp3FileName,
          targetFormat: "original",
          sessionTitle: session.title
        },
        "*"
      );
      setActionMessage(`"${session.title}" 음성 파일을 Downloads 폴더에 mp3로 저장하는 중입니다.`);
      return;
    }

    try {
      const response = await fetch(sourceAudioDownloadHref, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("원본 음성을 다운로드하지 못했습니다.");
      }

      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = href;
      link.download = mp3FileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setActionMessage(
        `\"${session.title}\" 음성 파일 다운로드를 시작했습니다. 브라우저 기본 다운로드 폴더에서 확인해 주세요.`
      );
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "원본 음성 다운로드에 실패했습니다."
      );
    }
  }

  async function handleDeleteSession(session: SessionPortalRecord) {
    if (pendingDeleteSessionId !== session.id) {
      setPendingDeleteSessionId(session.id);
      setActionMessage(`"${session.title}" 기록을 지우려면 휴지통을 한 번 더 눌러 주세요.`);
      return;
    }

    setDeletingSessionId(session.id);
    setPendingDeleteSessionId(null);
    setActionMessage(null);

    const previousSessions = sessions;
    try {
      setSessions((current) => current.filter((item) => item.id !== session.id));
      await deletePortalSession(session.id);
      setSelectedSessionId(null);
      void refreshWorkspacePreservingSessions().then((refreshed) => {
        if (!refreshed) {
          setActionMessage(
            `"${session.title}" 기록을 삭제했습니다. 목록 새로고침은 잠시 후 다시 시도해 주세요.`
          );
        }
      });
      setActionMessage(`"${session.title}" 기록을 삭제했습니다.`);
    } catch (error) {
      setSessions(previousSessions);
      setActionMessage(
        error instanceof Error ? error.message : "기록 삭제에 실패했습니다."
      );
    } finally {
      setDeletingSessionId(null);
    }
  }

  function openTitleEditor(session: SessionPortalRecord) {
    setTitleEditSessionId(session.id);
    setTitleDraft(session.title);
    setActionMessage(null);
  }

  async function handleSaveSessionTitle() {
    const session = titleEditSession;
    const nextTitle = titleDraft.trim();

    if (!session || !nextTitle) {
      return;
    }

    setSavingTitleSessionId(session.id);

    try {
      const snapshot = await updatePortalSessionTitle({
        sessionId: session.id,
        title: nextTitle
      });
      const decorated = decorateSessionRecord(snapshot.session, snapshot.notes?.notes);

      setSessions((current) =>
        sortSessions(current.map((item) => (item.id === decorated.id ? decorated : item)))
      );
      setTitleEditSessionId(null);
      setActionMessage(`"${nextTitle}" 제목으로 저장했습니다.`);
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "제목 저장에 실패했습니다."
      );
    } finally {
      setSavingTitleSessionId(null);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/v1/auth/logout", {
        method: "POST",
        cache: "no-store"
      });
    } finally {
      window.location.assign("/login");
    }
  }

  const settingsPanel = isSettingsOpen ? (
    <section className="settingsPanel">
      <div className="settingsSection">
        <div>
          <p className="sectionEyebrow">화면</p>
          <h2 className="sectionTitle">배경 톤</h2>
        </div>

        <div className="themePicker">
          {portalThemeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={
                option.id === preferences.theme
                  ? "themeSwatch themeSwatchActive"
                  : "themeSwatch"
              }
              data-theme-preview={option.id}
              onClick={() => updatePreference("theme", option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settingsSection">
        <div>
          <p className="sectionEyebrow">실시간 자막</p>
          <h2 className="sectionTitle">다음 녹음에 반영될 옵션</h2>
          <p className="workspaceCopy">
            저장하는 즉시 로컬에 남고, 다음 녹음 시작 시 Soniox 세션에 바로 적용됩니다.
          </p>
        </div>

        <label className="settingToggle">
          <div className="settingCopy">
            <strong>혼용 언어 자동 처리</strong>
            <span>한국어와 영어가 섞여도 실시간으로 감지해 자막에 반영합니다.</span>
          </div>
          <input
            type="checkbox"
            checked={preferences.enableMixedLanguage}
            onChange={(event) =>
              updatePreference("enableMixedLanguage", event.target.checked)
            }
          />
        </label>

        <label className="settingToggle">
          <div className="settingCopy">
            <strong>화자 분리</strong>
            <span>말하는 사람이 바뀌면 자막 줄을 나눠서 보여 줍니다.</span>
          </div>
          <input
            type="checkbox"
            checked={preferences.enableSpeakerDiarization}
            onChange={(event) =>
              updatePreference("enableSpeakerDiarization", event.target.checked)
            }
          />
        </label>

        <label className="settingToggle">
          <div className="settingCopy">
            <strong>낮은 신뢰도 강조</strong>
            <span>잘 안 들린 단어를 바로 확인할 수 있게 색으로 표시합니다.</span>
          </div>
          <input
            type="checkbox"
            checked={preferences.highlightLowConfidence}
            onChange={(event) =>
              updatePreference("highlightLowConfidence", event.target.checked)
            }
          />
        </label>

        <label className="settingToggle">
          <div className="settingCopy">
            <strong>실시간 한국어 번역</strong>
            <span>원문 자막은 그대로 두고, 한국어 번역은 보조 줄로만 보여 줍니다.</span>
          </div>
          <input
            type="checkbox"
            checked={preferences.enableLiveTranslation}
            onChange={(event) =>
              updatePreference("enableLiveTranslation", event.target.checked)
            }
          />
        </label>

        <div className="settingCard">
          <div className="settingCopy">
            <strong>엔드포인트 지연</strong>
            <span>
              화자가 잠깐 멈췄을 때 Soniox가 한 문장을 확정하기까지 기다리는 시간을
              조절합니다.
            </span>
          </div>
          <div className="optionRow">
            {endpointDelayOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  preferences.endpointDelayMs === option.value
                    ? "optionChip optionChipActive"
                    : "optionChip"
                }
                onClick={() =>
                  updatePreference("endpointDelayMs", option.value)
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="settingHint">
            {
              endpointDelayOptions.find(
                (option) => option.value === preferences.endpointDelayMs
              )?.description
            }
          </p>
        </div>

        <label className="fieldGroup settingField">
          <span className="fieldLabel">맥락 용어</span>
          <textarea
            className="textField settingTextarea"
            value={preferences.contextTermsText}
            onChange={(event) =>
              updatePreference("contextTermsText", event.target.value)
            }
            rows={5}
            placeholder="예: MYSTT, Soniox, 분기 전략, VIP 고객사&#10;쉼표 또는 줄바꿈으로 구분"
          />
          <span className="settingHint">
            다음 녹음 시작 시 Soniox `context.terms`로 들어갑니다. 쉼표나 줄바꿈으로
            구분하면 됩니다.
          </span>
        </label>

        <div className="settingsSection">
          <div>
            <p className="sectionEyebrow">저장 위치</p>
            <h2 className="sectionTitle">현재 저장 구조</h2>
            <p className="workspaceCopy">
              원본 오디오는 먼저 맥미니 로컬 `.data` 아래에 남고, 세션 상태와 아티팩트는 원격 저장
              상태를 같이 표시합니다.
            </p>
          </div>

          <div className="storageGrid">
            <div className="settingCard">
              <div className="settingCopy">
                <strong>원본 오디오</strong>
                <span>{health?.persistence?.paths?.audioRoot ?? "경로 확인 중"}</span>
              </div>
            </div>

            <div className="settingCard">
              <div className="settingCopy">
                <strong>아티팩트</strong>
                <span>{health?.persistence?.paths?.artifactRoot ?? "경로 확인 중"}</span>
              </div>
            </div>

            <div className="settingCard">
              <div className="settingCopy">
                <strong>세션 상태 파일</strong>
                <span>{health?.persistence?.paths?.stateFile ?? "경로 확인 중"}</span>
              </div>
            </div>

            <div className="settingCard">
              <div className="settingCopy">
                <strong>감사 로그</strong>
                <span>{health?.persistence?.paths?.auditLogFile ?? "경로 확인 중"}</span>
              </div>
            </div>

            <div className="settingCard">
              <div className="settingCopy">
                <strong>Postgres</strong>
                <span>{health?.persistence?.postgres.mode ?? "확인 중"}</span>
              </div>
            </div>

            <div className="settingCard">
              <div className="settingCopy">
                <strong>MinIO</strong>
                <span>{health?.persistence?.minio.mode ?? "확인 중"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  ) : null;

  return (
    <main className={isDesktopShell ? "pageShell pageShellEmbedded desktopShellPage" : "pageShell"}>
      {isDesktopShell ? (
        <>
          <section className="embeddedStatusBar">
            <div className="statusCluster">
              <span className="statusChip">
                {storageState.label}
              </span>
              <span className="statusChip">
                {autoSummaryReady ? "자동 요약 준비됨" : "자동 요약 연결 확인 필요"}
              </span>
              <span className="statusChip">진행 중 {activeCount}</span>
              <span className="statusChip">완료 {completedCount}</span>
              {health?.now ? (
                <span className="statusChip">최근 동기화 {formatKoreanTime(health.now)}</span>
              ) : null}
            </div>
          </section>
          {settingsPanel}
        </>
      ) : (
        <section className="appHeader">
          <div className="appHeaderIntro">
            <p className="brandLabel">mystt</p>
            <h1 className="appTitle">회의 녹음</h1>
          </div>

          <div className="headerTools">
            <div className="toolbarActions">
              {health?.now ? (
                <span className="toolbarHint">
                  최근 동기화 {formatKoreanTime(health.now)}
                </span>
              ) : null}
              <button
                type="button"
                className="ghostButton ghostButtonSecondary toolbarIconButton"
                onClick={() => void loadWorkspace()}
                disabled={isRefreshing}
                aria-label={isRefreshing ? "새로고침 중" : "새로고침"}
                title={isRefreshing ? "새로고침 중" : "새로고침"}
              >
                <span className="toolbarIcon" aria-hidden="true">↻</span>
                <span className="toolbarLabel">{isRefreshing ? "새로고침 중..." : "새로고침"}</span>
              </button>
              <button
                type="button"
                className="ghostButton ghostButtonSecondary toolbarIconButton"
                onClick={() => void handleLogout()}
                aria-label="로그아웃"
                title="로그아웃"
              >
                <span className="toolbarIcon" aria-hidden="true">⎋</span>
                <span className="toolbarLabel">로그아웃</span>
              </button>
              <button
                type="button"
                className={
                  isSettingsOpen
                    ? "ghostButton settingsButtonActive toolbarIconButton"
                    : "ghostButton toolbarIconButton"
                }
                onClick={() => setIsSettingsOpen((current) => !current)}
                aria-label="환경"
                title="환경"
              >
                <span className="toolbarIcon" aria-hidden="true">⚙</span>
                <span className="toolbarLabel">환경</span>
              </button>
            </div>

            <div className="statusCluster">
              <span className="statusChip">
                {storageState.label}
              </span>
              <span className="statusChip">
                {autoSummaryReady ? "자동 요약 준비됨" : "자동 요약 연결 확인 필요"}
              </span>
              <span className="statusChip">진행 중 {activeCount}</span>
              <span className="statusChip">완료 {completedCount}</span>
            </div>

          </div>

          {settingsPanel}
        </section>
      )}

      {error ? <p className="inlineError">{error}</p> : null}
      {actionMessage ? (
        <div className="toastNotice" role="status" aria-live="polite">
          {actionMessage}
        </div>
      ) : null}

      <section className="studioGrid studioGridSingle">
        {reviewOnly ? (
          <section className="sectionCard reviewModeCard">
            <div className="sectionHead">
              <div>
                <p className="sectionEyebrow">검토 포털</p>
                <h2 className="sectionTitleLarge">이 셸에서는 기록 검토와 공유만 다룹니다.</h2>
              </div>
            </div>

            <p className="workspaceCopy">
              녹음은 네이티브 recorder 레인에서 처리하고, 웹 포털은 최근 기록 검토,
              다운로드, 메일 공유, 삭제 같은 후속 작업에 집중합니다.
            </p>
          </section>
        ) : (
          <LiveRecorder
            preferences={preferences}
            onSaved={(sessionId) => {
              setSelectedSessionId(sessionId);
              void loadWorkspace();
            }}
          />
        )}

        <section className="sectionCard historyCard historyCardCompact">
          <div className="sectionHead">
            <div>
              <p className="sectionEyebrow">최근 기록</p>
              <h2 className="sectionTitleLarge">최근 기록</h2>
            </div>
            <div className="historyHeaderActions">
              <span className="sectionMeta">
                {visibleSessions.length}/{filteredSessions.length}개 표시 중
              </span>
              <button
                type="button"
                className="ghostButton ghostButtonSecondary historyToggleButton"
                onClick={() => setIsHistoryCollapsed((current) => !current)}
                aria-expanded={!isHistoryCollapsed}
              >
                {isHistoryCollapsed ? "펼치기" : "접기"}
              </button>
            </div>
          </div>

          {!isHistoryCollapsed ? (
            <>
              <label className="fieldGroup">
                <span className="fieldLabel">검색</span>
                <input
                  className="textField"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="제목, 프로젝트, 상태로 찾기"
                />
              </label>

              <div className="sessionList sessionListCompact">
                {visibleSessions.length > 0 ? (
                  visibleSessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      detailHref={
                        isDesktopShell
                          ? `/sessions/${session.id}?desktop_shell=1`
                          : `/sessions/${session.id}`
                      }
                      isDeleting={deletingSessionId === session.id}
                      isDeletePending={pendingDeleteSessionId === session.id}
                      canDownloadAudio={hasDownloadableAudio(session)}
                      onOpen={(sessionId) => setSelectedSessionId(sessionId)}
                      onDownloadAudio={(target) => void handleDownloadAudio(target)}
                      onSendMail={(target) => openShareComposer(target)}
                      onEditTitle={(target) => openTitleEditor(target)}
                      onDelete={(target) => void handleDeleteSession(target)}
                    />
                  ))
                ) : (
                  <p className="emptyState">
                    {deferredSearch.trim()
                      ? "조건에 맞는 기록이 없습니다."
                      : "저장된 기록이 아직 없습니다."}
                  </p>
                )}
              </div>

              {deferredSearch.trim() === "" && filteredSessions.length > visibleSessions.length ? (
                <button
                  type="button"
                  className="ghostButton ghostButtonSecondary"
                  onClick={() => setVisibleCount((current) => current + 8)}
                >
                  기록 더 보기
                </button>
              ) : null}
            </>
          ) : null}
        </section>
      </section>

      {selectedSession ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onClick={() => setSelectedSessionId(null)}
        >
          <section
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-label="기록 상세"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="sectionEyebrow">기록 상세</p>
                <h2 className="sectionTitleLarge">{selectedSession.title}</h2>
                <StorySummary value={selectedSession.summary} />
              </div>
              <div className="buttonRow modalHeaderActions">
                <button
                  type="button"
                  className="ghostButton"
                  onClick={() => openTitleEditor(selectedSession)}
                >
                  제목 수정
                </button>
                <button
                  type="button"
                  className="ghostButton ghostButtonSecondary modalCloseButton"
                  onClick={() => setSelectedSessionId(null)}
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="rowPills">
              <span className="detailPill">{selectedSession.projectKey ?? "개인 기록"}</span>
              <span className="detailPill">준비된 결과물 {selectedReadyArtifactCount}개</span>
              <span className="detailPill">대기 청크 {selectedSession.pendingChunkCount}개</span>
            </div>

            {selectedSession.actionItems.length > 0 ? (
              <ul className="compactList">
                {selectedSession.actionItems.map((item) => (
                  <li key={`${selectedSession.id}-${item.task}`}>
                    {cleanUserFacingText(item.task)}
                    {item.owner ? ` · ${cleanUserFacingText(item.owner)}` : ""}
                    {item.dueDate ? ` · ${cleanUserFacingText(item.dueDate)}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}

          </section>
        </div>
      ) : null}

      {titleEditSession ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onClick={() => setTitleEditSessionId(null)}
        >
          <section
            className="modalCard modalCardNarrow"
            role="dialog"
            aria-modal="true"
            aria-label="제목 수정"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="sectionEyebrow">제목 수정</p>
                <h2 className="sectionTitleLarge">저장된 기록 이름 바꾸기</h2>
              </div>
            </div>
            <label className="fieldGroup">
              <span className="fieldLabel">제목</span>
              <input
                className="textField"
                value={titleDraft}
                maxLength={140}
                onChange={(event) => setTitleDraft(event.target.value)}
                autoFocus
              />
            </label>
            <div className="buttonRow modalFooterActions">
              <button
                type="button"
                className="ghostButton ghostButtonSecondary"
                onClick={() => setTitleEditSessionId(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="recordButton"
                onClick={() => void handleSaveSessionTitle()}
                disabled={
                  savingTitleSessionId === titleEditSession.id ||
                  titleDraft.trim().length === 0 ||
                  titleDraft.trim().length > 140
                }
              >
                {savingTitleSessionId === titleEditSession.id ? "저장 중" : "저장"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {shareSession ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onClick={() => setShareSessionId(null)}
        >
          <section
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-label="공유 옵션"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <p className="sectionEyebrow">공유</p>
                <h2 className="sectionTitleLarge">{shareSession.title}</h2>
                <p className="appCopy">
                  체크한 항목만 메일 본문과 실제 첨부에 반영합니다. VDI에서 열기 어려운 링크는
                  넣지 않습니다.
                </p>
              </div>
              <button
                type="button"
                className="ghostButton ghostButtonSecondary modalCloseButton"
                onClick={() => setShareSessionId(null)}
              >
                닫기
              </button>
            </div>

            <div className="settingsSection">
              <label className="fieldGroup settingField">
                <span className="fieldLabel">받는 사람</span>
                <textarea
                  className="textField settingTextarea"
                  value={shareRecipients}
                  onChange={(event) => setShareRecipients(event.target.value)}
                  rows={3}
                  placeholder="name@example.com, team@example.com"
                />
                <span className="settingHint">
                  쉼표 또는 줄바꿈으로 여러 메일 주소를 넣을 수 있습니다.
                </span>
              </label>

              <label className="settingToggle">
                <div className="settingCopy">
                  <strong>요약 포함</strong>
                  <span>세 줄 요약, 핵심 정리, 다음 할 일을 같이 보냅니다.</span>
                </div>
                <input
                  type="checkbox"
                  checked={shareSelection.includeSummary}
                  onChange={(event) =>
                    updateShareSelection("includeSummary", event.target.checked)
                  }
                />
              </label>

              <label className="settingToggle">
                <div className="settingCopy">
                  <strong>상세 내역 포함</strong>
                  <span>기록 정보와 대화 기록, 회의록이 준비돼 있으면 실제 첨부로 붙입니다.</span>
                </div>
                <input
                  type="checkbox"
                  checked={shareSelection.includeDetails}
                  onChange={(event) =>
                    updateShareSelection("includeDetails", event.target.checked)
                  }
                />
              </label>

              <label className="settingToggle">
                <div className="settingCopy">
                  <strong>음성 파일 포함</strong>
                  <span>
                    {hasDownloadableAudio(shareSession)
                      ? "원본 음성이 있으면 실제 메일 첨부로 붙입니다."
                      : "이 기록은 아직 원본 음성 파일이 없어서 첨부할 수 없습니다."}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={shareSelection.includeAudio}
                  disabled={!hasDownloadableAudio(shareSession)}
                  onChange={(event) =>
                    updateShareSelection("includeAudio", event.target.checked)
                  }
                />
              </label>
            </div>

            <div className="settingCard">
              <div className="settingCopy">
                <strong>공유 미리보기</strong>
                <span>선택한 항목만 아래에 포함됩니다.</span>
              </div>
              <div className="transcriptBlock sharePreview">
                {buildShareDraft(shareSession, shareSelection)?.bodyText ?? ""}
              </div>
            </div>

            <div className="buttonRow">
              {typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
                <button type="button" className="ghostButton" onClick={() => void handleNativeShare()}>
                  시스템 공유
                </button>
              ) : null}
              <button type="button" className="recordButton" onClick={() => void handleShareEmail()}>
                메일로 보내기
              </button>
              <button type="button" className="ghostButton" onClick={() => void handleCopyShare()}>
                내용 복사
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
