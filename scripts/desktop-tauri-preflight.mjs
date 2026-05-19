import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), "../../../.env")
];

for (const candidate of envCandidates) {
  try {
    process.loadEnvFile?.(candidate);
    break;
  } catch {
    // Try the next candidate until one exists.
  }
}

const checks = [
  {
    key: "apiHealth",
    label: "API /health",
    url: "http://127.0.0.1:4100/health",
    required: true,
    accept: "application/json",
    nextStep: "pnpm --filter @mystt/api dev"
  },
  {
    key: "localPortal",
    label: "Local portal",
    url: "http://127.0.0.1:3203",
    required: true,
    accept: "text/html",
    nextStep: "WEB_HOST=0.0.0.0 WEB_PORT=3203 pnpm --filter @mystt/web dev"
  },
  {
    key: "tauriDevShell",
    label: "Tauri Vite dev shell",
    url: "http://localhost:1420",
    required: false,
    accept: "text/html",
    nextStep: "pnpm --filter @mystt/desktop tauri dev"
  }
];

function readQaToken() {
  const configured = process.env.MYSTT_QA_TOKEN?.trim();
  if (configured) {
    return configured;
  }

  try {
    return readFileSync(resolve(process.cwd(), ".data/qa/public-access-token"), "utf8").trim();
  } catch {
    return undefined;
  }
}

async function probeHttp(input) {
  const qaToken = readQaToken();
  const headers = {
    accept: input.accept
  };

  if (qaToken) {
    headers["x-mystt-qa-token"] = qaToken;
  }

  try {
    const response = await fetch(input.url, {
      headers,
      signal: AbortSignal.timeout(2_000)
    });

    return {
      ...input,
      ok: response.ok,
      status: response.status,
      detail: response.ok ? "reachable" : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ...input,
      ok: false,
      status: null,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function probeDocker() {
  const result = spawnSync("docker", ["ps", "--format", "{{.Names}}"], {
    encoding: "utf8"
  });

  if (result.status === 0) {
    return {
      ok: true,
      detail: result.stdout.trim() || "daemon reachable"
    };
  }

  return {
    ok: false,
    detail: (result.stderr || result.stdout || "docker unavailable").trim()
  };
}

function resolveDesktopQaSourceAudioUrl(downloadUrl, pageUrl = "http://127.0.0.1:3203/") {
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

function normalizeDesktopQaDownloadName(fileName) {
  const cleaned = fileName
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ");
  const safeName = cleaned || "mystt-audio";
  const lastDot = safeName.lastIndexOf(".");
  const stem = lastDot > 0 ? safeName.slice(0, lastDot) : safeName;

  return `${stem}.mp3`;
}

function hasMp3AttachmentName(contentDisposition) {
  if (!contentDisposition) {
    return false;
  }

  const parts = contentDisposition.split(";").map((part) => part.trim());
  const disposition = parts.shift()?.toLowerCase();
  if (disposition !== "attachment") {
    return false;
  }

  const params = new Map();
  for (const part of parts) {
    const equalsIndex = part.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = part.slice(0, equalsIndex).trim().toLowerCase();
    let value = part.slice(equalsIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    params.set(key, value);
  }

  const encodedName = params.get("filename*");
  if (encodedName) {
    const match = encodedName.match(/^UTF-8''(.+)$/i);
    const decoded = match ? decodeURIComponent(match[1]) : encodedName;
    return decoded.toLowerCase().endsWith(".mp3");
  }

  return params.get("filename")?.toLowerCase().endsWith(".mp3") === true;
}

async function probeDesktopDownloadQa() {
  const configuredUrl = process.env.MYSTT_DESKTOP_DOWNLOAD_QA_URL?.trim();

  if (!configuredUrl) {
    return {
      enabled: false,
      ok: true,
      detail:
        "MYSTT_DESKTOP_DOWNLOAD_QA_URL 미설정이라 source-audio MP3 다운로드 체크를 건너뜁니다."
    };
  }

  const pageUrl =
    process.env.MYSTT_DESKTOP_DOWNLOAD_QA_PAGE_URL?.trim() || "http://127.0.0.1:3203/";
  const resolvedUrl = resolveDesktopQaSourceAudioUrl(configuredUrl, pageUrl);

  if (!resolvedUrl) {
    return {
      enabled: true,
      ok: false,
      detail: "source-audio http(s) URL이 아니어서 MP3 다운로드 QA를 실행할 수 없습니다."
    };
  }

  const requestedFileName = normalizeDesktopQaDownloadName(
    process.env.MYSTT_DESKTOP_DOWNLOAD_QA_FILE_NAME?.trim() || "mystt-source-audio"
  );

  try {
    const response = await fetch(resolvedUrl, {
      cache: "no-store",
      headers: {
        accept: "audio/mpeg"
      },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      return {
        enabled: true,
        ok: false,
        detail: `HTTP ${response.status} from ${resolvedUrl}`
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const contentDisposition = response.headers.get("content-disposition") || "";
    const bytes = await response.arrayBuffer();

    if (!/audio\/(?:mpeg|mp3)/i.test(contentType)) {
      return {
        enabled: true,
        ok: false,
        detail: `expected audio/mpeg response, got ${contentType || "missing content-type"}`
      };
    }

    if (!hasMp3AttachmentName(contentDisposition)) {
      return {
        enabled: true,
        ok: false,
        detail: `expected .mp3 attachment filename, got ${contentDisposition}`
      };
    }

    if (bytes.byteLength <= 0) {
      return {
        enabled: true,
        ok: false,
        detail: "downloaded MP3 response is empty"
      };
    }

    return {
      enabled: true,
      ok: true,
      detail: `${resolvedUrl} -> ${requestedFileName} (${bytes.byteLength} bytes)`
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function apiQueueRequiresWorker(healthResult) {
  const queue = healthResult?.body?.queue;
  return queue?.configured === true && queue?.mode === "remote";
}

function probeSessionWorker(healthResult) {
  if (!apiQueueRequiresWorker(healthResult)) {
    return {
      enabled: false,
      ok: true,
      detail: "API health가 remote queue를 보고하지 않아 worker-session 체크를 건너뜁니다."
    };
  }

  const result = spawnSync("pgrep", ["-fl", "services/worker-session/src/index.ts"], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const fallback = spawnSync(
      "pgrep",
      ["-fl", "@mystt/worker-session|pnpm --filter @mystt/worker-session start"],
      {
        encoding: "utf8"
      }
    );

    if (fallback.status === 0) {
      return {
        enabled: true,
        ok: true,
        detail: fallback.stdout.trim() || "worker-session running"
      };
    }
  }

  if (result.status === 0) {
    return {
      enabled: true,
      ok: true,
      detail: result.stdout.trim() || "worker-session running"
    };
  }

  return {
    enabled: true,
    ok: false,
    detail: "worker-session not running",
    nextStep: "pnpm --filter @mystt/worker-session start"
  };
}

const results = await Promise.all(checks.map(probeHttp));
const docker = probeDocker();
const worker = probeSessionWorker(results.find((item) => item.key === "apiHealth"));
const downloadQa = await probeDesktopDownloadQa();
const failedRequired = results.filter((item) => item.required && !item.ok);

console.log("[mystt desktop] preflight");
for (const result of results) {
  const status = result.ok ? "OK" : result.required ? "FAIL" : "WARN";
  console.log(`- ${status} ${result.label}: ${result.detail}`);

  if (!result.ok) {
    console.log(`  next: ${result.nextStep}`);
  }
}

console.log(`- ${docker.ok ? "OK" : "WARN"} Docker daemon: ${docker.detail}`);

if (worker.enabled) {
  console.log(`- ${worker.ok ? "OK" : "FAIL"} Session worker: ${worker.detail}`);

  if (!worker.ok && worker.nextStep) {
    console.log(`  next: ${worker.nextStep}`);
  }
}

if (downloadQa.enabled) {
  console.log(`- ${downloadQa.ok ? "OK" : "FAIL"} MP3 download QA: ${downloadQa.detail}`);
}

if (failedRequired.length > 0 || (worker.enabled && !worker.ok) || !downloadQa.ok) {
  console.error(
    "[mystt desktop] required local targets are not ready; start the commands above before running `pnpm --filter @mystt/desktop tauri dev`."
  );
  process.exit(1);
}

console.log(
  "[mystt desktop] local API and portal are ready. next: pnpm --filter @mystt/desktop tauri dev"
);
