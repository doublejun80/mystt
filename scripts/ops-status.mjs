#!/usr/bin/env node

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const RESTART_COMMANDS = {
  "api process":
    "screen -dmS mystt-api-4100 zsh -lc 'cd /Volumes/mac_dock/github/mystt/services/api && /opt/homebrew/bin/pnpm dev > /tmp/mystt-api-4100.out 2>&1'",
  "web process":
    "screen -dmS mystt-web-3203 zsh -lc 'cd /Volumes/mac_dock/github/mystt && /opt/homebrew/bin/pnpm --filter @mystt/web start > /tmp/mystt-web-3203.out 2>&1'",
  "session worker":
    "screen -dmS mystt-worker-session zsh -lc 'cd /Volumes/mac_dock/github/mystt && /opt/homebrew/bin/pnpm --filter @mystt/worker-session dev > /tmp/mystt-worker-session.log 2>&1'",
  "postgres/minio/redis": "pnpm compose:infra"
};

function normalizeBaseUrl(value) {
  return value?.replace(/\/+$/, "") ?? "";
}

async function probeJson(label, url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, { cache: "no-store" });
    const text = await response.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Keep raw text for non-JSON responses.
    }

    const publicMinimal = options.publicMinimal
      ? response.ok &&
        body &&
        typeof body === "object" &&
        Object.keys(body).sort().join(",") === "ok,service" &&
        body.ok === true &&
        body.service === "api"
      : undefined;
    const ok = options.publicMinimal ? publicMinimal : response.ok;

    return {
      label,
      ok,
      status: response.status,
      body,
      ...(options.publicMinimal ? { publicMinimal } : {}),
      ...(options.restart ? { restart: options.restart } : {})
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      ...(options.restart ? { restart: options.restart } : {})
    };
  }
}

async function probeNotExposed(label, url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      redirect: "manual"
    });
    const location = response.headers?.get?.("location") ?? "";
    const safeRedirect =
      response.status >= 300 &&
      response.status < 400 &&
      location &&
      !/(minio|mailpit|portainer|console|browser|login)/i.test(location);
    const ok = response.status === 401 || response.status === 403 || response.status === 404 || safeRedirect;

    return {
      label,
      ok,
      status: response.status,
      location: location || null,
      exposureExpected: "401/403/404 or redirect away from admin/storage surfaces"
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function pgrep(label, pattern, options = {}) {
  const execFileImpl = options.execFileImpl ?? execFileAsync;

  try {
    const { stdout } = await execFileImpl("pgrep", ["-af", pattern]);
    return {
      label,
      ok: stdout.trim().length > 0,
      matches: stdout.trim().split("\n").filter(Boolean),
      ...(options.restart ? { restart: options.restart } : {})
    };
  } catch {
    return {
      label,
      ok: false,
      matches: [],
      ...(options.restart ? { restart: options.restart } : {})
    };
  }
}

export async function buildOpsStatus(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const execFileImpl = options.execFileImpl ?? execFileAsync;
  const publicBaseUrl = normalizeBaseUrl(options.publicBaseUrl);
  const checks = await Promise.all([
    probeJson("api health", "http://127.0.0.1:4100/health", { fetchImpl }),
    probeJson("api ready", "http://127.0.0.1:4100/ready", {
      fetchImpl,
      restart: RESTART_COMMANDS["postgres/minio/redis"]
    }),
    probeJson("web health proxy", "http://127.0.0.1:3203/health", { fetchImpl }),
    pgrep("api process", "mystt-api-4100|tsx.*src/index.ts", {
      execFileImpl,
      restart: RESTART_COMMANDS["api process"]
    }),
    pgrep("web process", "mystt-web-3203|next-server|next dev|next start", {
      execFileImpl,
      restart: RESTART_COMMANDS["web process"]
    }),
    pgrep("session worker", "worker-session", {
      execFileImpl,
      restart: RESTART_COMMANDS["session worker"]
    }),
    ...(publicBaseUrl
      ? [
          probeJson("public health", `${publicBaseUrl}/health`, {
            fetchImpl,
            publicMinimal: true
          }),
          probeJson("public ready", `${publicBaseUrl}/ready`, {
            fetchImpl,
            publicMinimal: true,
            restart: RESTART_COMMANDS["postgres/minio/redis"]
          }),
          probeNotExposed("public minio exposure", `${publicBaseUrl}/minio`, {
            fetchImpl
          }),
          probeNotExposed("public mailpit exposure", `${publicBaseUrl}/mailpit`, {
            fetchImpl
          }),
          probeNotExposed("public portainer exposure", `${publicBaseUrl}/portainer`, {
            fetchImpl
          })
        ]
      : [])
  ]);

  const failed = checks.filter((check) => !check.ok);

  return {
    ok: failed.length === 0,
    checks,
    recovery: failed.map((check) => ({
      label: check.label,
      restart: check.restart ?? null,
      observe: "Re-run pnpm ops:status after restart and inspect the matching /tmp/mystt-*.log file."
    }))
  };
}

function parsePublicBaseUrl(argv, env) {
  const flagIndex = argv.indexOf("--public-base-url");

  if (flagIndex >= 0) {
    return argv[flagIndex + 1] ?? "";
  }

  return env.MYSTT_PUBLIC_BASE_URL ?? "";
}

async function main() {
  const status = await buildOpsStatus({
    publicBaseUrl: parsePublicBaseUrl(process.argv.slice(2), process.env)
  });

  console.log(JSON.stringify(status, null, 2));

  if (!status.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
