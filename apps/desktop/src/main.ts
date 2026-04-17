import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import {
  buildRecorderSurvivalSummary,
  type RecorderRuntimeState,
  type TauriRecorderStoreStatus
} from "@mystt/audio-core";

import {
  fetchInsforgeDesktopSession,
  refreshInsforgeDesktopSession,
  signInWithInsforgeDesktop,
  signUpWithInsforgeDesktop
} from "./lib/insforge";

type Target = {
  label: string;
  url: string;
  purpose: string;
  probe?: boolean;
};

type ProbeResult = Target & {
  ok: boolean;
};

type ApiHealthResponse = {
  ok: boolean;
  persistence?: {
    postgres?: {
      configured: boolean;
      mode: "disabled" | "remote" | "local-fallback";
      lastLoadOk: boolean | null;
      lastWriteOk: boolean | null;
      lastReadOk: boolean | null;
      lastError?: string;
    };
    minio?: {
      configured: boolean;
      mode: "disabled" | "remote" | "local-fallback";
      lastLoadOk: boolean | null;
      lastWriteOk: boolean | null;
      lastReadOk: boolean | null;
      lastError?: string;
    };
    paths?: {
      dataRoot: string;
      stateFile: string;
      auditLogFile: string;
      artifactRoot: string;
      audioRoot: string;
    };
  };
  integrations?: {
    insforgeConfigured?: boolean;
    insforgeAdminConfigured?: boolean;
    insforge?: {
      configured: boolean;
      adminConfigured: boolean;
      shadowWriteEnabled: boolean;
      baseUrl?: string;
      lastPublicConfigOk: boolean | null;
      lastSessionOk: boolean | null;
      lastStorageOk: boolean | null;
      lastShadowWriteOk: boolean | null;
      lastError?: string;
    };
  };
};

type InsforgeStatusEnvelope = {
  data?: ApiHealthResponse["integrations"] extends infer T
    ? T extends { insforge?: infer U }
      ? U
      : never
    : never;
};

type InsforgeAuthConfigEnvelope = {
  data: {
    passwordMinLength: number;
    requireEmailVerification: boolean;
    oAuthProviders: string[];
    verifyEmailMethod?: string;
  };
};

type InsforgeBucketsEnvelope = {
  data: Array<{
    name: string;
    public: boolean;
    createdAt?: string;
  }>;
};

type StoredDesktopAuthState = {
  email: string;
  accessToken: string;
  refreshToken?: string | null;
};

type CurrentSessionRecord = {
  user: {
    id: string;
    email?: string;
    emailVerified?: boolean;
    providers?: string[];
    [key: string]: unknown;
  };
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
const desktopSessionStorageKey = "mystt.insforge.desktop.session";

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

async function downloadFileToDesktop(input: { url: string; fileName: string }) {
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

function updateLoginMessage(message: string) {
  const element = document.querySelector<HTMLElement>("#insforge-login-message");
  if (element) {
    element.textContent = message;
  }
}

function syncAuthButton(input: {
  stored: StoredDesktopAuthState | null;
  session: CurrentSessionRecord | null;
}) {
  const button = document.querySelector<HTMLButtonElement>("#open-login");

  if (!button) {
    return;
  }

  const isLoggedIn = Boolean(input.stored && input.session);
  button.textContent = isLoggedIn ? "로그아웃" : "로그인";
  button.dataset.mode = isLoggedIn ? "logout" : "login";
  button.classList.toggle("button-primary", !isLoggedIn);
}

function prefillEmail(email?: string) {
  const input = document.querySelector<HTMLInputElement>("#insforge-email");
  if (input && email) {
    input.value = email;
  }
}

function loadStoredDesktopAuthState(): StoredDesktopAuthState | null {
  try {
    const raw = window.localStorage.getItem(desktopSessionStorageKey);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as StoredDesktopAuthState;
  } catch {
    return null;
  }
}

function saveStoredDesktopAuthState(state: StoredDesktopAuthState) {
  window.localStorage.setItem(desktopSessionStorageKey, JSON.stringify(state));
}

function clearStoredDesktopAuthState() {
  window.localStorage.removeItem(desktopSessionStorageKey);
}

async function resolveDesktopSessionState() {
  const stored = loadStoredDesktopAuthState();

  if (!stored) {
    return {
      stored: null,
      session: null
    };
  }

  try {
    const session = await fetchInsforgeDesktopSession(stored.accessToken);
    updateLoginMessage(`${session.user.email ?? stored.email} 로그인 상태입니다.`);
    return {
      stored,
      session
    };
  } catch {
    if (!stored.refreshToken) {
      clearStoredDesktopAuthState();
      updateLoginMessage("저장된 세션이 만료되었습니다. 다시 로그인해 주세요.");
      return {
        stored: null,
        session: null
      };
    }

    let refreshed;
    try {
      refreshed = await refreshInsforgeDesktopSession({
        refreshToken: stored.refreshToken
      });
    } catch {
      clearStoredDesktopAuthState();
      updateLoginMessage("세션 갱신에 실패했습니다. 다시 로그인해 주세요.");
      return {
        stored: null,
        session: null
      };
    }

    if (!refreshed.accessToken) {
      clearStoredDesktopAuthState();
      updateLoginMessage("세션 갱신에 실패했습니다. 다시 로그인해 주세요.");
      return {
        stored: null,
        session: null
      };
    }

    const nextStored = {
      email: refreshed.user.email ?? stored.email,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken
    };

    saveStoredDesktopAuthState(nextStored);
    try {
      const session = await fetchInsforgeDesktopSession(nextStored.accessToken);
      updateLoginMessage(`${session.user.email ?? nextStored.email} 로그인 상태입니다.`);
      return {
        stored: nextStored,
        session
      };
    } catch {
      updateLoginMessage(`${refreshed.user.email ?? nextStored.email} 로그인 상태입니다.`);
      return {
        stored: nextStored,
        session: {
          user: refreshed.user
        }
      };
    }
  }
}

async function loadInsforgeState() {
  const [health, status, authConfig, buckets] = await Promise.allSettled([
    requestJson<ApiHealthResponse>("/health"),
    requestJson<InsforgeStatusEnvelope>("/v1/insforge/status"),
    requestJson<InsforgeAuthConfigEnvelope>("/v1/insforge/auth/public-config"),
    requestJson<InsforgeBucketsEnvelope>("/v1/insforge/storage/buckets")
  ]);

  return {
    health,
    status,
    authConfig,
    buckets
  };
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

function renderInsforgeState(input: Awaited<ReturnType<typeof loadInsforgeState>>) {
  const title = document.querySelector<HTMLElement>("#insforge-title");
  const detail = document.querySelector<HTMLElement>("#insforge-detail");
  const pill = document.querySelector<HTMLElement>("#insforge-pill");
  const summary = document.querySelector<HTMLDivElement>("#insforge-status-summary");
  const buckets = document.querySelector<HTMLDivElement>("#insforge-buckets");

  if (!title || !detail || !pill || !summary || !buckets) {
    return;
  }

  const health = input.health.status === "fulfilled" ? input.health.value : undefined;
  const runtime = input.status.status === "fulfilled" ? input.status.value.data : undefined;
  const authConfig =
    input.authConfig.status === "fulfilled" ? input.authConfig.value.data : undefined;
  const bucketList =
    input.buckets.status === "fulfilled" ? input.buckets.value.data : [];
  const bucketError = input.buckets.status === "rejected" ? input.buckets.reason : undefined;
  const connected = Boolean(runtime?.configured && health?.integrations?.insforgeConfigured);
  const diagnostics = document.querySelector<HTMLDetailsElement>("#insforge-diagnostics");

  title.textContent = connected ? "InsForge 연결됨" : "InsForge 연결 미완료";
  detail.textContent = runtime?.lastError
    ? `최근 오류: ${runtime.lastError}`
    : runtime?.baseUrl
      ? `${runtime.baseUrl}와 bridge를 연결했습니다.`
      : "InsForge base URL이 아직 API에 반영되지 않았습니다.";
  pill.textContent = connected ? "연결됨" : "점검 필요";

  if (diagnostics && runtime?.lastError) {
    diagnostics.open = true;
  }

  summary.innerHTML = [
    {
      label: "Base URL",
      value: runtime?.baseUrl ?? "없음",
      detail: health?.integrations?.insforgeAdminConfigured ? "admin token 연결" : "admin token 미확인"
    },
    {
      label: "Public Auth",
      value:
        input.authConfig.status === "fulfilled"
          ? `비밀번호 ${authConfig?.passwordMinLength ?? "-"}자`
          : "실패",
      detail:
        input.authConfig.status === "fulfilled"
          ? `이메일 검증 ${authConfig?.requireEmailVerification ? "필수" : "선택"}`
          : "public config 확인 필요"
    },
    {
      label: "Shadow Write",
      value: runtime?.shadowWriteEnabled ? "켜짐" : "꺼짐",
      detail:
        runtime?.lastShadowWriteOk == null
          ? "아직 artifact 쓰기 전"
          : runtime.lastShadowWriteOk
            ? "최근 쓰기 성공"
            : "최근 쓰기 실패"
    },
    {
      label: "Storage Buckets",
      value: `${bucketList.length}개`,
      detail:
        bucketError instanceof Error
          ? bucketError.message
          : bucketList.length > 0
            ? "목록 조회 성공"
            : "목록 비어 있음"
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

  if (health?.persistence?.paths) {
    summary.insertAdjacentHTML(
      "beforeend",
      [
        {
          label: "원본 오디오",
          value: health.persistence.paths.audioRoot,
          detail: `MinIO ${health.persistence.minio?.mode ?? "확인 중"}`
        },
        {
          label: "아티팩트",
          value: health.persistence.paths.artifactRoot,
          detail: `InsForge shadow write ${health.integrations?.insforge?.shadowWriteEnabled ? "켜짐" : "꺼짐"}`
        },
        {
          label: "상태 파일",
          value: health.persistence.paths.stateFile,
          detail: "세션/캐시 저장"
        },
        {
          label: "감사 로그",
          value: health.persistence.paths.auditLogFile,
          detail: "audit trail 저장"
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
        .join("")
    );
  }

  buckets.innerHTML = bucketList.length
    ? bucketList
        .map(
          (bucket) => `
            <article class="platform-card">
              <p class="target-label">bucket</p>
              <strong>${bucket.name}</strong>
            </article>
          `
        )
        .join("")
    : `
        <article class="platform-card">
          <p class="target-label">bucket</p>
          <strong>${bucketError ? "조회 실패" : "아직 없음"}</strong>
        </article>
      `;
}

function renderSessionState(input: {
  stored: StoredDesktopAuthState | null;
  session: CurrentSessionRecord | null;
}) {
  const summary = document.querySelector<HTMLDivElement>("#session-summary");
  const checklist = document.querySelector<HTMLUListElement>("#session-checklist");

  if (!summary || !checklist) {
    return;
  }

  syncAuthButton(input);

  if (!input.session || !input.stored) {
    summary.innerHTML = [
      {
        label: "로그인 상태",
        value: "로그아웃",
        detail: "설정에서 이메일/비밀번호로 로그인하거나 계정을 만들 수 있습니다."
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
    checklist.innerHTML = [
      "<li>저장된 세션이 없습니다.</li>",
      "<li>필요하면 같은 창에서 바로 계정을 만들 수 있습니다.</li>"
    ].join("");
    return;
  }

  summary.innerHTML = [
    {
      label: "이메일",
      value: input.session.user.email ?? input.stored.email,
      detail: "현재 저장된 desktop session"
    },
    {
      label: "이메일 인증",
      value: input.session.user.emailVerified ? "완료" : "미완료",
      detail: "InsForge auth user record 기준"
    },
    {
      label: "제공자",
      value: input.session.user.providers?.join(", ") ?? "email",
      detail: "현재 로그인 공급자"
    },
    {
      label: "Refresh Token",
      value: input.stored.refreshToken ? "있음" : "없음",
      detail: "만료 시 자동 갱신에 사용"
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

  checklist.innerHTML = [
    `<li>${input.session.user.email ?? input.stored.email} 계정으로 로그인되어 있습니다.</li>`,
    `<li>세션 확인 버튼으로 현재 access token 유효성을 다시 점검할 수 있습니다.</li>`
  ].join("");
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

  title.textContent = status.active ? "노트북 장시간 보호가 켜져 있습니다." : "노트북 장시간 보호가 꺼져 있습니다.";
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
    checklist.innerHTML = ["<li>로컬 recorder 저장소 상태를 아직 읽지 못했습니다.</li>"].join("");
    clearButton.disabled = true;
    return;
  }

  const runtimeState = isRuntimeState(status.runtimeState) ? status.runtimeState : null;
  const survivalSummary = runtimeState ? buildRecorderSurvivalSummary(runtimeState) : null;
  const latestSession = status.recentSessions[0] ?? null;
  const latestTitle =
    latestSession &&
    typeof latestSession === "object" &&
    latestSession &&
    "session" in latestSession &&
    latestSession.session &&
    typeof latestSession.session === "object" &&
    "title" in latestSession.session
      ? String(latestSession.session.title)
      : "없음";
  const latestSavedAt =
    latestSession &&
    typeof latestSession === "object" &&
    latestSession &&
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
        ...survivalSummary.recentEvidence.map((entry) => `<li>${entry}</li>`)
      ]
    : [
        "<li>현재 복구 후보는 없습니다.</li>",
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

async function refreshInsforgePanel() {
  const [insforgeState, shellStatus, keepAwakeStatus, recorderStoreStatus] = await Promise.all([
    loadInsforgeState(),
    loadDesktopShellStatus(),
    loadDesktopKeepAwakeStatus(),
    loadDesktopRecorderStoreStatus()
  ]);
  renderInsforgeState(insforgeState);
  renderDesktopShellStatus(shellStatus);
  renderDesktopKeepAwakeStatus(keepAwakeStatus);
  renderDesktopRecorderStoreStatus(recorderStoreStatus);
  const resolvedSession = await resolveDesktopSessionState();
  renderSessionState(resolvedSession);
  prefillEmail(resolvedSession.stored?.email);
}

async function finishAuthSuccess(input: {
  stored: StoredDesktopAuthState;
  session: CurrentSessionRecord;
  message: string;
}) {
  const frame = document.querySelector<HTMLIFrameElement>("#portal-frame");
  const nextUrl = buildPortalUrl(currentTarget?.url ?? targets[0].url);

  updateLoginMessage(input.message);
  renderSessionState({
    stored: input.stored,
    session: input.session
  });
  prefillEmail(input.session.user.email ?? input.stored.email);
  setSettingsOpen(false);
  if (frame) {
    frame.hidden = false;
    frame.src = nextUrl;
    frame.focus();
  }
  window.setTimeout(() => setSettingsOpen(false), 50);
  await renderPortalTargets();
}

window.addEventListener("DOMContentLoaded", async () => {
  const localButton = document.querySelector<HTMLButtonElement>("#open-local");
  const prodButton = document.querySelector<HTMLButtonElement>("#open-prod");
  const healthButton = document.querySelector<HTMLButtonElement>("#open-health");
  const openPortalSettingsButton =
    document.querySelector<HTMLButtonElement>("#open-portal-settings");
  const openLoginButton = document.querySelector<HTMLButtonElement>("#open-login");
  const closeSettingsButton = document.querySelector<HTMLButtonElement>("#close-settings");
  const reloadPortalButton = document.querySelector<HTMLButtonElement>("#reload-portal");
  const dashboardButton = document.querySelector<HTMLButtonElement>("#open-insforge-dashboard");
  const authButton = document.querySelector<HTMLButtonElement>("#open-insforge-auth");
  const ensureBucketsButton =
    document.querySelector<HTMLButtonElement>("#ensure-insforge-buckets");
  const refreshInsforgeButton =
    document.querySelector<HTMLButtonElement>("#refresh-insforge");
  const verifyInsforgeSessionButton =
    document.querySelector<HTMLButtonElement>("#verify-insforge-session");
  const loginForm = document.querySelector<HTMLFormElement>("#insforge-login-form");
  const signUpButton = document.querySelector<HTMLButtonElement>("#insforge-sign-up");
  const logoutButton = document.querySelector<HTMLButtonElement>("#insforge-logout");
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
          fileName: payload.fileName
        });

        postPortalEvent({
          type: "mystt.desktop.download-complete",
          path: savedPath,
          sessionTitle: payload.sessionTitle ?? null
        });
      } catch (error) {
        postPortalEvent({
          type: "mystt.desktop.download-failed",
          message:
            error instanceof Error ? error.message : "다운로드 폴더 저장에 실패했습니다."
        });
      }
    }
  });

  openPortalSettingsButton?.addEventListener("click", () =>
    postPortalCommand("mystt.portal.toggleSettings")
  );
  openLoginButton?.addEventListener("click", () => {
    if (openLoginButton.dataset.mode === "logout") {
      clearStoredDesktopAuthState();
      updateLoginMessage("로그아웃했습니다.");
      renderSessionState({
        stored: null,
        session: null
      });
      return;
    }

    setSettingsOpen(true);
  });
  closeSettingsButton?.addEventListener("click", () => setSettingsOpen(false));
  overlay?.addEventListener("click", (event) => {
    if (event.target === overlay) {
      setSettingsOpen(false);
    }
  });

  reloadPortalButton?.addEventListener("click", async () => {
    const frame = document.querySelector<HTMLIFrameElement>("#portal-frame");
    await renderPortalTargets();
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
    await openExternal(`${targets[0].url}/health`);
  });

  dashboardButton?.addEventListener("click", async () => {
    await openExternal("https://insforge.doublejun.digital/dashboard");
  });
  authButton?.addEventListener("click", async () => {
    await openExternal("https://insforge.doublejun.digital/dashboard/authentication");
  });
  ensureBucketsButton?.addEventListener("click", async () => {
    await requestJson("/v1/insforge/storage/buckets/ensure", {
      method: "POST"
    });
    await refreshInsforgePanel();
  });
  refreshInsforgeButton?.addEventListener("click", async () => {
    await refreshInsforgePanel();
  });
  verifyInsforgeSessionButton?.addEventListener("click", async () => {
    const resolved = await resolveDesktopSessionState();
    renderSessionState(resolved);

    if (!resolved.session) {
      updateLoginMessage("로그인된 세션이 없습니다.");
      return;
    }

    updateLoginMessage(`${resolved.session.user.email ?? resolved.stored?.email} 세션이 유효합니다.`);
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

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();

    if (!email || !password) {
      updateLoginMessage("이메일과 비밀번호를 입력해 주세요.");
      return;
    }

    updateLoginMessage("로그인 중입니다.");

    try {
      const session = await signInWithInsforgeDesktop({
        email,
        password
      });

      if (!session.accessToken) {
        throw new Error("Access token was not returned.");
      }

      const nextState = {
        email: session.user.email ?? email,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
      };

      saveStoredDesktopAuthState(nextState);
      let currentSession: CurrentSessionRecord;
      try {
        currentSession = await fetchInsforgeDesktopSession(nextState.accessToken);
      } catch {
        currentSession = {
          user: session.user
        };
      }
      await finishAuthSuccess({
        stored: nextState,
        session: currentSession,
        message: `${currentSession.user.email ?? email} 로그인 완료`
      });
    } catch (error) {
      clearStoredDesktopAuthState();
      updateLoginMessage(error instanceof Error ? error.message : "로그인에 실패했습니다.");
      renderSessionState({
        stored: null,
        session: null
      });
    }
  });

  signUpButton?.addEventListener("click", async () => {
    if (!loginForm) {
      return;
    }

    const formData = new FormData(loginForm);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();

    if (!email || !password) {
      updateLoginMessage("계정을 만들려면 이메일과 비밀번호를 입력해 주세요.");
      return;
    }

    updateLoginMessage("계정을 만드는 중입니다.");

    try {
      const session = await signUpWithInsforgeDesktop({
        email,
        password,
        name: name || undefined
      });

      if (!session.accessToken) {
        throw new Error("계정은 만들어졌지만 access token이 없습니다.");
      }

      const nextState = {
        email: session.user.email ?? email,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
      };

      saveStoredDesktopAuthState(nextState);
      let currentSession: CurrentSessionRecord;
      try {
        currentSession = await fetchInsforgeDesktopSession(nextState.accessToken);
      } catch {
        currentSession = {
          user: session.user
        };
      }
      await finishAuthSuccess({
        stored: nextState,
        session: currentSession,
        message: `${currentSession.user.email ?? email} 계정 생성 및 로그인 완료`
      });
    } catch (error) {
      updateLoginMessage(error instanceof Error ? error.message : "계정 생성에 실패했습니다.");
    }
  });

  logoutButton?.addEventListener("click", () => {
    clearStoredDesktopAuthState();
    updateLoginMessage("로그아웃했습니다.");
    renderSessionState({
      stored: null,
      session: null
    });
  });

  await renderPortalTargets();
  await refreshInsforgePanel();
});
