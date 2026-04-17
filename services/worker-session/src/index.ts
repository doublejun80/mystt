import process from "node:process";

import {
  dequeueSessionProcessJob,
  disposeSessionQueueClients
} from "@mystt/session-queue";

import { loadRepoEnv } from "../../../scripts/env";
import { apiConfig, isRedisConfigured } from "../../api/src/config";
import { processSessionVerticalSlice } from "../../api/src/lib/session-process";
import {
  getSession,
  initializeStore,
  recordAuditEvent,
  refreshStore,
  updateSessionStatus
} from "../../api/src/lib/store";

const idleTimeoutSeconds = Number(process.env.SESSION_WORKER_BLOCK_SECONDS ?? "5");

async function processNextJob() {
  if (!apiConfig.REDIS_URL) {
    throw new Error("REDIS_URL is required for worker-session.");
  }

  const job = await dequeueSessionProcessJob({
    redisUrl: apiConfig.REDIS_URL,
    timeoutSeconds: idleTimeoutSeconds
  });

  if (!job) {
    return;
  }

  try {
    await refreshStore();
    await recordAuditEvent({
      sessionId: job.sessionId,
      kind: "session.process.started",
      payload: {
        jobId: job.jobId,
        source: job.audioUrl ? "audio_url" : "file_id",
        requestedBy: job.requestedBy
      }
    });

    const result = await processSessionVerticalSlice({
      sessionId: job.sessionId,
      audioUrl: job.audioUrl,
      fileId: job.fileId,
      wait: true,
      pollIntervalMs: job.pollIntervalMs,
      timeoutMs: job.timeoutMs
    });

    await recordAuditEvent({
      sessionId: job.sessionId,
      kind: "session.process.finished",
      payload: {
        jobId: job.jobId,
        accepted: result.accepted,
        finalStatus: result.snapshot?.session.status ?? getSession(job.sessionId)?.status ?? null
      }
    });
  } catch (error) {
    await refreshStore();
    await recordAuditEvent({
      sessionId: job.sessionId,
      kind: "session.process.failed",
      payload: {
        jobId: job.jobId,
        error: error instanceof Error ? error.message : String(error)
      }
    });
    await updateSessionStatus(job.sessionId, "failed");
  }
}

export async function runSessionWorker() {
  loadRepoEnv();

  if (!isRedisConfigured() || !apiConfig.REDIS_URL) {
    throw new Error("Configure REDIS_URL before starting worker-session.");
  }

  await initializeStore();

  process.on("SIGINT", async () => {
    await disposeSessionQueueClients();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await disposeSessionQueueClients();
    process.exit(0);
  });

  for (;;) {
    await processNextJob();
  }
}

runSessionWorker().catch(async (error) => {
  console.error(error);
  await disposeSessionQueueClients();
  process.exit(1);
});
