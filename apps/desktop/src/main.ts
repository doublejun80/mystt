import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  buildRecorderSurvivalSummary,
  type RecorderRuntimeState,
  type TauriRecorderStoreStatus
} from "@mystt/audio-core";

import {
  buildRecentSessionLines,
  formatDesktopBridgeError,
  resolveDesktopVerificationOptions
} from "./verification";

type Target = {
  label: string;
  url: string;
  purpose: string;
  probe?: boolean;
};

type ProbeResult = Target & {
  ok: boolean;
};

type PersistenceStatus = {
  configured: boolean;
  mode: "disabled" | "remote" | "local-fallback";
  lastLoadOk: boolean | null;
  lastWriteOk: boolean | null;
  lastReadOk: boolean | null;
  lastError?: string;
};

type QueueStatus = {
  configured: boolean;
  mode: "disabled" | "remote" | "inline-fallback";
  depth: number | null;
  lastEnqueueOk: boolean | null;
  lastDepthOk: boolean | null;
  lastError?: string;
};

type ApiHealthResponse = {
  ok: boolean;
  now: string;
  providers?: {
    sonioxConfigured: boolean;
    openaiConfigured: boolean;
  };
  persistence?: {
    postgres?: PersistenceStatus;
    minio?: PersistenceStatus;
    paths?: {
      dataRoot: string;
      stateFile: string;
      auditLogFile: string;
      artifactRoot: string;
      audioRoot: string;
    };
  };
  queue?: QueueStatus;
};

type DesktopShellStatus = {
  platform: string;
  appDataDir: string;
  appCacheDir: string;
  appLogDir: string;
  downloadsDir: string;
  recorderRoot: string;
  runtimeStatePath: string;
  reviewOnlyPortal: boolean;
};

type DesktopKeepAwakeStatus = {
  supported: boolean;
  active: boolean;
  mode: string;
  detail: string;
};

const apiBaseUrl = "http://127.0.0.1:4100";

const targets: Target[] = [
  {
    label: "MYSTT Studio",
    url: "http://127.0.0.1:3203",
    purpose: "Live capture workspace",
    probe: true
  },
  {
    label: "MYSTT Cloud",
    url: "https://mystt.doublejun.digital",
    purpose: "Hosted production workspace",
    probe: false
  }
];

let latestProbeResults: ProbeResult[] = [];
let currentTarget: ProbeResult | null = null;
let latestDesktopShellStatus: DesktopShellStatus | null = null;
const verificationOptions = resolveDesktopVerificationOptions(import.meta.env);

function buildPortalUrl(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}desktop_shell=1&ts=${Date.now()}`;
}

async function probeTarget(target: Target): Promise<ProbeResult> {
  if (target.probe === false) {
    return {
      ...target,
      ok: false
    };
  }

  try {
    await fetch(`${target.url}/health`, {
      cache: "no-store",
      mode: "no-cors"
    });

    return {
      ...target,
      ok: true
    };
  } catch {
    return {
      ...target,
      ok: false
    };
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    cache: "no-store",
    ...init
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;

    try {
      const payload = (await response.json()) as { message?: string; error?: string };
      detail = payload.message ?? payload.error ?? detail;
    } catch {
      try {
        const text = await response.text();
        if (text.trim()) {
          detail = text.trim();
        }
      } catch {
        // Keep fallback detail.
      }
    }

    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

async function loadDesktopShellStatus() {
  try {
    return await invoke<DesktopShellStatus>("desktop_shell_status");
  } catch {
    return null;
  }
}

async function loadDesktopKeepAwakeStatus() {
  try {
    return await invoke<DesktopKeepAwakeStatus>("desktop_keep_awake_status");
  } catch {
    return null;
  }
}

async function loadDesktopRecorderStoreStatus() {
  try {
    return await invoke<TauriRecorderStoreStatus>("desktop_recorder_store_status");
  } catch {
    return null;
  }
}

async function startDesktopKeepAwake() {
  return invoke<DesktopKeepAwakeStatus>("desktop_keep_awake_start");
}

async function stopDesktopKeepAwake() {
  return invoke<DesktopKeepAwakeStatus>("desktop_keep_awake_stop");
}

async function clearDesktopRecorderRuntime() {
  return invoke<TauriRecorderStoreStatus>("desktop_recorder_clear_runtime");
}

async function downloadFileToDesktop(input: {
  url: string;
  fileName: string;
  targetFormat?: "original" | "mp3";
}) {
  return invoke<string>("desktop_download_file", input);
}

async function openExternal(url: string) {
  if (url.startsWith("mailto:")) {
    return;
  }

  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function postPortalCommand(type: string) {
  const frame = document.querySelector<HTMLIFrameElement>("#portal-frame");

  if (!frame?.contentWindow) {
    return;
  }

  frame.contentWindow.postMessage({ type }, "*");
}

function postPortalEvent(payload: Record<string, unknown>) {
  const frame = document.querySelector<HTMLIFrameElement>("#portal-frame");

  if (!frame?.contentWindow) {
    return;
  }

  frame.contentWindow.postMessage(payload, "*");
}

function postDesktopShellStatusToPortal() {
  if (!latestDesktopShellStatus) {
    return;
  }

  postPortalEvent({
    type: "mystt.desktop.shell-status",
    downloadsDir: latestDesktopShellStatus.downloadsDir,
    recorderRoot: latestDesktopShellStatus.recorderRoot
  });
}

function setSettingsOpen(open: boolean) {
  const overlay = document.querySelector<HTMLElement>("#settings-overlay");

  if (!overlay) {
    return;
  }

  overlay.hidden = !open;
  overlay.style.display = open ? "grid" : "none";
  overlay.setAttribute("aria-hidden", open ? "false" : "true");
  document.body.classList.toggle("settings-open", open);
}

function renderTargetList(selector: string, results: ProbeResult[]) {
  const container = document.querySelector<HTMLDivElement>(selector);

  if (!container) {
    return;
  }

  container.innerHTML = results
    .map(
      (item) => `
        <article class="platform-card">
          <p class="target-label">${item.label}</p>
          <strong>${item.url}</strong>
          <p class="target-purpose">${item.purpose}</p>
          <span class="target-state">${item.ok ? "응답 확인" : "대기"}</span>
        </article>
      `
    )
    .join("");
}

function renderPortalState(result: ProbeResult | null) {
  const title = document.querySelector<HTMLElement>("#app-status-title");
  const detail = document.querySelector<HTMLElement>("#app-status-detail");
  const pill = document.querySelector<HTMLElement>("#status-pill");
  const frame = document.querySelector<HTMLIFrameElement>("#portal-frame");
  const loading = document.querySelector<HTMLElement>("#portal-loading");
  const fallback = document.querySelector<HTMLElement>("#portal-fallback");

  if (!title || !detail || !pill || !frame || !loading || !fallback) {
    return;
  }

  currentTarget = result;

  if (!result) {
    title.textContent = "MYSTT Studio";
    detail.textContent = "Connecting live workspace";
    pill.textContent = "대기";
    loading.hidden = true;
    frame.hidden = true;
    fallback.hidden = false;
    return;
  }

  title.textContent = result.label;
  detail.textContent = "메인 화면";
  pill.textContent = "연결됨";
  frame.src = buildPortalUrl(result.url);
  frame.hidden = false;
  loading.hidden = true;
  fallback.hidden = true;
}

function describePersistenceStatus(status?: PersistenceStatus) {
  if (!status) {
    return "상태 확인 중";
  }

  if (!status.configured) {
    return "구성 안 됨";
  }

  if (status.lastError) {
    return status.lastError;
  }

  if (status.mode === "remote") {
    return "원격 persistence 사용 중";
  }

  if (status.mode === "local-fallback") {
    return "원격 장애 시 로컬 fallback 유지";
  }

  return "비활성";
}

function describeQueueStatus(queue?: QueueStatus) {
  if (!queue) {
    return "상태 확인 중";
  }

  if (!queue.configured) {
    return "구성 안 됨";
  }

  if (queue.lastError) {
    return queue.lastError;
  }

  const depthLabel = queue.depth == null ? "깊이 미확인" : `대기 ${queue.depth}`;
  return `${queue.mode} · ${depthLabel}`;
}

function renderPersistenceState(input: {
  health: ApiHealthResponse | null;
  errorMessage?: string;
}) {
  const title = document.querySelector<HTMLElement>("#persistence-title");
  const detail = document.querySelector<HTMLElement>("#persistence-detail");
  const pill = document.querySelector<HTMLElement>("#persistence-pill");
  const diagnosticsPill = document.querySelector<HTMLElement>("#diagnostics-pill");
  const summary = document.querySelector<HTMLDivElement>("#persistence-summary");
  const paths = document.querySelector<HTMLDivElement>("#persistence-paths");
  const diagnostics = document.querySelector<HTMLDetailsElement>("#desktop-diagnostics");

  if (!title || !detail || !pill || !diagnosticsPill || !summary || !paths) {
    return;
  }

  if (!input.health) {
    title.textContent = "API persistence 상태를 읽지 못했습니다.";
    detail.textContent =
      input.errorMessage ?? "API가 아직 떠 있지 않거나 `/health` 응답이 준비되지 않았습니다.";
    pill.textContent = "주의";
    diagnosticsPill.textContent = "주의";
    summary.innerHTML = `
      <article class="metric-card">
        <p class="metric-label">상태</p>
        <strong class="metric-value metric-value-small">헬스체크 실패</strong>
        <p class="metric-detail">${detail.textContent}</p>
      </article>
    `;
    paths.innerHTML = "";
    if (diagnostics) {
      diagnostics.open = true;
    }
    return;
  }

  const postgres = input.health.persistence?.postgres;
  const minio = input.health.persistence?.minio;
  const queue = input.health.queue;
  const providers = input.health.providers;
  const pathsState = input.health.persistence?.paths;
  const storageReady = postgres?.mode === "remote" && minio?.mode === "remote";
  const needsAttention = Boolean(postgres?.lastError || minio?.lastError || queue?.lastError);

  title.textContent = storageReady
    ? "서버 persistence 연결됨"
    : "fallback 포함 상태 점검";
  detail.textContent = [
    `Postgres ${postgres?.mode ?? "확인 중"}`,
    `MinIO ${minio?.mode ?? "확인 중"}`,
    `Queue ${queue?.mode ?? "확인 중"}`,
    "현재 데스크톱 셸은 로컬/무인증 검토 경로를 유지합니다."
  ].join(" · ");
  pill.textContent = needsAttention ? "주의" : storageReady ? "정상" : "확인";
  diagnosticsPill.textContent = pill.textContent;

  if (diagnostics && needsAttention) {
    diagnostics.open = true;
  }

  summary.innerHTML = [
    {
      label: "Postgres",
      value: postgres?.mode ?? "확인 중",
      detail: describePersistenceStatus(postgres)
    },
    {
      label: "MinIO",
      value: minio?.mode ?? "확인 중",
      detail: describePersistenceStatus(minio)
    },
    {
      label: "Queue",
      value: queue?.mode ?? "확인 중",
      detail: describeQueueStatus(queue)
    },
    {
      label: "자동 처리",
      value:
        providers?.sonioxConfigured && providers?.openaiConfigured ? "준비됨" : "점검 필요",
      detail: `Soniox ${providers?.sonioxConfigured ? "on" : "off"} / OpenAI ${
        providers?.openaiConfigured ? "on" : "off"
      }`
    }
  ]
    .map(
      (metric) => `
        <article class="metric-card">
          <p class="metric-label">${metric.label}</p>
          <strong class="metric-value metric-value-small">${metric.value}</strong>
          <p class="metric-detail">${metric.detail}</p>
        </article>
      `
    )
    .join("");

  if (!pathsState) {
    paths.innerHTML = `
      <article class="metric-card">
        <p class="metric-label">경로</p>
        <strong class="metric-value metric-value-small">미확인</strong>
        <p class="metric-detail">.data fallback 경로를 아직 읽지 못했습니다.</p>
      </article>
    `;
    return;
  }

  paths.innerHTML = [
    {
      label: "원본 오디오",
      value: pathsState.audioRoot,
      detail: "로컬 원본 오디오 fallback 경로"
    },
    {
      label: "아티팩트",
      value: pathsState.artifactRoot,
      detail: "회의록/전사 산출물 fallback 경로"
    },
    {
      label: "세션 상태",
      value: pathsState.stateFile,
      detail: "API 상태 캐시"
    },
    {
      label: "감사 로그",
      value: pathsState.auditLogFile,
      detail: "audit trail append log"
    }
  ]
    .map(
      (metric) => `
        <article class="metric-card">
          <p class="metric-label">${metric.label}</p>
          <strong class="metric-value metric-value-small">${metric.value}</strong>
          <p class="metric-detail">${metric.detail}</p>
        </article>
      `
    )
    .join("");
}

function renderDesktopShellStatus(status: DesktopShellStatus | null) {
  const summary = document.querySelector<HTMLDivElement>("#desktop-shell-summary");

  latestDesktopShellStatus = status;
  postDesktopShellStatusToPortal();

  if (!summary) {
    return;
  }

  if (!status) {
    summary.innerHTML = `
      <article class="metric-card">
        <p class="metric-label">Desktop shell</p>
        <strong class="metric-value metric-value-small">상태 확인 실패</strong>
        <p class="metric-detail">Tauri shell 경로를 아직 읽지 못했습니다.</p>
      </article>
    `;
    return;
  }

  summary.innerHTML = [
    {
      label: "플랫폼",
      value: status.platform,
      detail: status.reviewOnlyPortal ? "검토 전용 포털" : "실시간 포털 모드"
    },
    {
      label: "앱 데이터",
      value: status.appDataDir,
      detail: "데스크톱 셸 로컬 상태"
    },
    {
      label: "다운로드",
      value: status.downloadsDir,
      detail: "음성 파일과 문서 기본 저장 폴더"
    },
    {
      label: "Recorder 루트",
      value: status.recorderRoot,
      detail: "장시간 녹음 원본/런타임 상태 기준 경로"
    },
    {
      label: "Runtime 상태",
      value: status.runtimeStatePath,
      detail: "앱 재실행 복구 후보 파일"
    },
    {
      label: "Cache",
      value: status.appCacheDir,
      detail: "임시 캐시와 번들 자산"
    },
    {
      label: "Logs",
      value: status.appLogDir,
      detail: "셸 로그 경로"
    }
  ]
    .map(
      (metric) => `
        <article class="metric-card">
          <p class="metric-label">${metric.label}</p>
          <strong class="metric-value metric-value-small">${metric.value}</strong>
          <p class="metric-detail">${metric.detail}</p>
        </article>
      `
    )
    .join("");
}

function renderDesktopKeepAwakeStatus(status: DesktopKeepAwakeStatus | null) {
  const title = document.querySelector<HTMLElement>("#desktop-keep-awake-title");
  const detail = document.querySelector<HTMLElement>("#desktop-keep-awake-detail");
  const pill = document.querySelector<HTMLElement>("#desktop-keep-awake-pill");
  const startButton = document.querySelector<HTMLButtonElement>("#desktop-keep-awake-start");
  const stopButton = document.querySelector<HTMLButtonElement>("#desktop-keep-awake-stop");

  if (!title || !detail || !pill || !startButton || !stopButton) {
    return;
  }

  if (!status) {
    title.textContent = "장시간 보호 상태를 읽지 못했습니다.";
    detail.textContent = "Tauri keep-awake 어댑터 응답을 기다리는 중입니다.";
    pill.textContent = "미확인";
    startButton.disabled = false;
    stopButton.disabled = true;
    return;
  }

  if (!status.supported) {
    title.textContent = "현재 플랫폼은 keep-awake 미지원";
    detail.textContent = status.detail;
    pill.textContent = "미지원";
    startButton.disabled = true;
    stopButton.disabled = true;
    return;
  }

  title.textContent = status.active
    ? "노트북 장시간 보호가 켜져 있습니다."
    : "노트북 장시간 보호가 꺼져 있습니다.";
  detail.textContent = status.detail;
  pill.textContent = status.active ? "켜짐" : "꺼짐";
  startButton.disabled = status.active;
  stopButton.disabled = !status.active;
}

function isRuntimeState(value: TauriRecorderStoreStatus["runtimeState"]): value is RecorderRuntimeState {
  return Boolean(
    value &&
      typeof value === "object" &&
      "phase" in value &&
      "transportState" in value &&
      "session" in value
  );
}

function renderDesktopRecorderStoreStatus(status: TauriRecorderStoreStatus | null) {
  const summary = document.querySelector<HTMLDivElement>("#desktop-recorder-summary");
  const checklist = document.querySelector<HTMLUListElement>("#desktop-recorder-checklist");
  const clearButton = document.querySelector<HTMLButtonElement>("#desktop-recorder-clear-runtime");

  if (!summary || !checklist || !clearButton) {
    return;
  }

  if (!status) {
    summary.innerHTML = `
      <article class="metric-card">
        <p class="metric-label">Recorder 상태</p>
        <strong class="metric-value metric-value-small">읽기 실패</strong>
        <p class="metric-detail">Tauri recorder ledger 응답을 기다리는 중입니다.</p>
      </article>
    `;
    checklist.innerHTML = "<li>로컬 recorder 저장소 상태를 아직 읽지 못했습니다.</li>";
    clearButton.disabled = true;
    return;
  }

  const runtimeState = isRuntimeState(status.runtimeState) ? status.runtimeState : null;
  const survivalSummary = runtimeState ? buildRecorderSurvivalSummary(runtimeState) : null;
  const latestSession = status.recentSessions[0] ?? null;
  const latestTitle =
    latestSession &&
    typeof latestSession === "object" &&
    "session" in latestSession &&
    latestSession.session &&
    typeof latestSession.session === "object" &&
    "title" in latestSession.session
      ? String(latestSession.session.title)
      : "없음";
  const latestSavedAt =
    latestSession &&
    typeof latestSession === "object" &&
    "savedAt" in latestSession
      ? String(latestSession.savedAt)
      : "기록 없음";

  summary.innerHTML = [
    {
      label: "복구 후보",
      value: status.hasRuntimeState ? "있음" : "없음",
      detail: survivalSummary?.detail ?? "앱 재실행 시 runtime-state 후보를 여기서 확인합니다."
    },
    {
      label: "저장 세션",
      value: `${status.savedSessionCount}개`,
      detail: `세션 인덱스: ${status.ledgerPath}`
    },
    {
      label: "최근 세션",
      value: latestTitle,
      detail: latestSavedAt
    },
    {
      label: "Runtime 경로",
      value: status.runtimeStatePath,
      detail: "잠금/강제종료 복구 후보 파일"
    }
  ]
    .map(
      (metric) => `
        <article class="metric-card">
          <p class="metric-label">${metric.label}</p>
          <strong class="metric-value metric-value-small">${metric.value}</strong>
          <p class="metric-detail">${metric.detail}</p>
        </article>
      `
    )
    .join("");

  const items = survivalSummary
    ? [
        `<li>${survivalSummary.headline}</li>`,
        `<li>${survivalSummary.detail}</li>`,
        ...survivalSummary.recentEvidence.map((entry) => `<li>${entry}</li>`),
        ...buildRecentSessionLines(status.recentSessions).map((entry) => `<li>${entry}</li>`)
      ]
    : [
        "<li>현재 복구 후보는 없습니다.</li>",
        `<li>saved_session_count: ${status.savedSessionCount}</li>`,
        ...buildRecentSessionLines(status.recentSessions).map((entry) => `<li>${entry}</li>`),
        `<li>로컬 recorder 루트: ${status.recorderRoot}</li>`,
        "<li>다음 desktop recorder 어댑터가 이 저장소를 그대로 사용합니다.</li>"
      ];

  checklist.innerHTML = items.join("");
  clearButton.disabled = !status.hasRuntimeState;
}

async function renderPortalTargets() {
  latestProbeResults = await Promise.all(targets.map(probeTarget));
  renderTargetList("#target-list", latestProbeResults);
  renderTargetList("#settings-target-list", latestProbeResults);
  renderPortalState(latestProbeResults.find((item) => item.ok) ?? null);
}

async function refreshDesktopDiagnostics() {
  const [health, shellStatus, keepAwakeStatus, recorderStoreStatus] = await Promise.allSettled([
    requestJson<ApiHealthResponse>("/health"),
    loadDesktopShellStatus(),
    loadDesktopKeepAwakeStatus(),
    loadDesktopRecorderStoreStatus()
  ]);

  renderPersistenceState({
    health: health.status === "fulfilled" ? health.value : null,
    errorMessage:
      health.status === "rejected"
        ? health.reason instanceof Error
          ? health.reason.message
          : String(health.reason)
        : undefined
  });
  renderDesktopShellStatus(shellStatus.status === "fulfilled" ? shellStatus.value : null);
  renderDesktopKeepAwakeStatus(
    keepAwakeStatus.status === "fulfilled" ? keepAwakeStatus.value : null
  );
  renderDesktopRecorderStoreStatus(
    recorderStoreStatus.status === "fulfilled" ? recorderStoreStatus.value : null
  );
}

window.addEventListener("DOMContentLoaded", async () => {
  const localButton = document.querySelector<HTMLButtonElement>("#open-local");
  const prodButton = document.querySelector<HTMLButtonElement>("#open-prod");
  const healthButton = document.querySelector<HTMLButtonElement>("#open-health");
  const openPortalSettingsButton =
    document.querySelector<HTMLButtonElement>("#open-portal-settings");
  const openDiagnosticsButton =
    document.querySelector<HTMLButtonElement>("#open-diagnostics");
  const closeSettingsButton = document.querySelector<HTMLButtonElement>("#close-settings");
  const reloadPortalButton = document.querySelector<HTMLButtonElement>("#reload-portal");
  const refreshDiagnosticsButton =
    document.querySelector<HTMLButtonElement>("#refresh-diagnostics");
  const openApiHealthButton = document.querySelector<HTMLButtonElement>("#open-api-health");
  const keepAwakeStartButton =
    document.querySelector<HTMLButtonElement>("#desktop-keep-awake-start");
  const keepAwakeStopButton =
    document.querySelector<HTMLButtonElement>("#desktop-keep-awake-stop");
  const clearRecorderRuntimeButton =
    document.querySelector<HTMLButtonElement>("#desktop-recorder-clear-runtime");
  const overlay = document.querySelector<HTMLElement>("#settings-overlay");
  const frame = document.querySelector<HTMLIFrameElement>("#portal-frame");

  frame?.addEventListener("load", () => {
    window.setTimeout(() => {
      postDesktopShellStatusToPortal();
    }, 300);
  });

  window.addEventListener("message", async (event) => {
    const payload =
      event.data && typeof event.data === "object"
        ? (event.data as {
            type?: string;
            url?: string;
            fileName?: string;
            targetFormat?: "original" | "mp3";
            sessionTitle?: string;
          })
        : null;

    if (payload?.type === "mystt.desktop.open-url" && payload.url) {
      await openExternal(payload.url);
    }

    if (payload?.type === "mystt.desktop.download-file" && payload.url && payload.fileName) {
      try {
        const savedPath = await downloadFileToDesktop({
          url: payload.url,
          fileName: payload.fileName,
          targetFormat: payload.targetFormat
        });

        postPortalEvent({
          type: "mystt.desktop.download-complete",
          path: savedPath,
          sessionTitle: payload.sessionTitle ?? null
        });
      } catch (error) {
        postPortalEvent({
          type: "mystt.desktop.download-failed",
          message: formatDesktopBridgeError(
            error,
            "다운로드 폴더 저장에 실패했습니다."
          )
        });
      }
    }
  });

  openPortalSettingsButton?.addEventListener("click", () =>
    postPortalCommand("mystt.portal.toggleSettings")
  );
  openDiagnosticsButton?.addEventListener("click", async () => {
    setSettingsOpen(true);
    await refreshDesktopDiagnostics();
  });
  closeSettingsButton?.addEventListener("click", () => setSettingsOpen(false));
  overlay?.addEventListener("click", (event) => {
    if (event.target === overlay) {
      setSettingsOpen(false);
    }
  });

  reloadPortalButton?.addEventListener("click", async () => {
    await renderPortalTargets();
    await refreshDesktopDiagnostics();
    if (frame && currentTarget) {
      frame.src = buildPortalUrl(currentTarget.url);
    }
    window.setTimeout(() => postPortalCommand("mystt.portal.refresh"), 250);
  });

  localButton?.addEventListener("click", async () => {
    await openExternal(targets[0].url);
  });
  prodButton?.addEventListener("click", async () => {
    await openExternal(targets[1].url);
  });
  healthButton?.addEventListener("click", async () => {
    await openExternal(`${apiBaseUrl}/health`);
  });
  refreshDiagnosticsButton?.addEventListener("click", async () => {
    await refreshDesktopDiagnostics();
  });
  openApiHealthButton?.addEventListener("click", async () => {
    await openExternal(`${apiBaseUrl}/health`);
  });

  keepAwakeStartButton?.addEventListener("click", async () => {
    const status = await startDesktopKeepAwake();
    renderDesktopKeepAwakeStatus(status);
  });

  keepAwakeStopButton?.addEventListener("click", async () => {
    const status = await stopDesktopKeepAwake();
    renderDesktopKeepAwakeStatus(status);
  });

  clearRecorderRuntimeButton?.addEventListener("click", async () => {
    const status = await clearDesktopRecorderRuntime();
    renderDesktopRecorderStoreStatus(status);
  });

  await Promise.all([renderPortalTargets(), refreshDesktopDiagnostics()]);

  if (verificationOptions.autostartKeepAwakeOnLaunch) {
    try {
      const status = await startDesktopKeepAwake();
      renderDesktopKeepAwakeStatus(status);
    } catch (error) {
      console.warn("desktop keep-awake autostart failed", error);
    }
  }

  if (verificationOptions.openDiagnosticsOnLaunch) {
    setSettingsOpen(true);
    await refreshDesktopDiagnostics();

    if (verificationOptions.diagnosticsScrollTarget) {
      document
        .getElementById(verificationOptions.diagnosticsScrollTarget)
        ?.scrollIntoView({ block: "center" });
    }
  }
});
