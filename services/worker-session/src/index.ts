import process from "node:process";

import {
  ackSessionProcessJob,
  deadLetterSessionProcessJob,
  dequeueSessionProcessJob,
  disposeSessionQueueClients,
  recoverProcessingSessionJobs,
  retrySessionProcessJob
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
const maxAttempts = Number(process.env.SESSION_WORKER_MAX_ATTEMPTS ?? "3");
const leaseMs = Number(process.env.SESSION_WORKER_LEASE_MS ?? "300000");
const recoveryIntervalMs = Number(
  process.env.SESSION_WORKER_RECOVERY_INTERVAL_MS ?? "30000"
);
let lastRecoveryAt = 0;

async function recoverExpiredProcessingJobs(reason: "startup" | "periodic") {
  if (!apiConfig.REDIS_URL) {
    return 0;
  }

  const recovered = await recoverProcessingSessionJobs({ redisUrl: apiConfig.REDIS_URL });

  if (recovered > 0) {
    console.warn(
      `[worker-session] recovered ${recovered} expired session job(s) during ${reason}.`
    );
  }

  return recovered;
}

async function recoverExpiredProcessingJobsIfDue() {
  const now = Date.now();

  if (now - lastRecoveryAt < recoveryIntervalMs) {
    return;
  }

  lastRecoveryAt = now;
  await recoverExpiredProcessingJobs("periodic");
}

async function ackCurrentJob(job: Awaited<ReturnType<typeof dequeueSessionProcessJob>>) {
  if (!job || !apiConfig.REDIS_URL) {
    return false;
  }

  try {
    const acked = await ackSessionProcessJob({
      redisUrl: apiConfig.REDIS_URL,
      job
    });

    if (!acked) {
      await recordAuditEvent({
        sessionId: job.sessionId,
        kind: "session.process.ack_missing",
        payload: {
          jobId: job.jobId
        }
      });
    }

    return acked;
  } catch (error) {
    await recordAuditEvent({
      sessionId: job.sessionId,
      kind: "session.process.ack_failed",
      payload: {
        jobId: job.jobId,
        error: error instanceof Error ? error.message : String(error)
      }
    });
    return false;
  }
}

async function processNextJob() {
  if (!apiConfig.REDIS_URL) {
    throw new Error("REDIS_URL is required for worker-session.");
  }

  const job = await dequeueSessionProcessJob({
    redisUrl: apiConfig.REDIS_URL,
    timeoutSeconds: idleTimeoutSeconds,
    leaseMs
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

	    if (result.timedOut) {
	      throw new Error("Session processing timed out before terminal transcription state.");
	    }

	    if (result.snapshot?.session.status === "failed") {
	      throw new Error("Session processing returned failed status.");
	    }

    await recordAuditEvent({
      sessionId: job.sessionId,
      kind: "session.process.finished",
      payload: {
        jobId: job.jobId,
        accepted: result.accepted,
        finalStatus: result.snapshot?.session.status ?? getSession(job.sessionId)?.status ?? null
      }
    });
    await ackCurrentJob(job);
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
    const attempts = (job.attempts ?? 0) + 1;
    if (attempts < maxAttempts) {
      const retryJob = {
        ...job,
        attempts,
        jobId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        claimedAt: undefined,
        leaseExpiresAt: undefined
      };

      try {
        const retryScheduled = await retrySessionProcessJob({
          redisUrl: apiConfig.REDIS_URL,
          currentJob: job,
          retryJob
        });

        if (!retryScheduled) {
          await recordAuditEvent({
            sessionId: job.sessionId,
            kind: "session.process.retry_transition_missing",
            payload: {
              previousJobId: job.jobId,
              retryJobId: retryJob.jobId,
              attempts
            }
          });
          return;
        }
      } catch (retryError) {
        await recordAuditEvent({
          sessionId: job.sessionId,
          kind: "session.process.retry_enqueue_failed",
          payload: {
            jobId: job.jobId,
            attempts,
            error: retryError instanceof Error ? retryError.message : String(retryError)
          }
        });
        return;
      }

      await recordAuditEvent({
        sessionId: job.sessionId,
        kind: "session.process.retry_scheduled",
        payload: {
          previousJobId: job.jobId,
          retryJobId: retryJob.jobId,
          attempts
        }
      });
      return;
    }

    try {
      const deadLettered = await deadLetterSessionProcessJob({
        redisUrl: apiConfig.REDIS_URL,
        job,
        reason: error instanceof Error ? error.message : String(error)
      });

      if (!deadLettered) {
        await recordAuditEvent({
          sessionId: job.sessionId,
          kind: "session.process.dead_letter_missing",
          payload: {
            jobId: job.jobId,
            attempts
          }
        });
        return;
      }
    } catch (deadLetterError) {
      await recordAuditEvent({
        sessionId: job.sessionId,
        kind: "session.process.dead_letter_failed",
        payload: {
          jobId: job.jobId,
          attempts,
          error: deadLetterError instanceof Error ? deadLetterError.message : String(deadLetterError)
        }
      });
      return;
    }

    try {
      await updateSessionStatus(job.sessionId, "failed");
    } catch (statusError) {
      await recordAuditEvent({
        sessionId: job.sessionId,
        kind: "session.process.status_update_failed",
        payload: {
          jobId: job.jobId,
          attempts,
          status: "failed",
          error: statusError instanceof Error ? statusError.message : String(statusError)
        }
      });
    }
  }
}

export async function runSessionWorker() {
  loadRepoEnv();

  if (!isRedisConfigured() || !apiConfig.REDIS_URL) {
    throw new Error("Configure REDIS_URL before starting worker-session.");
  }

	  await initializeStore();
	  await recoverExpiredProcessingJobs("startup");
	  lastRecoveryAt = Date.now();

  process.on("SIGINT", async () => {
    await disposeSessionQueueClients();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await disposeSessionQueueClients();
    process.exit(0);
  });

	  for (;;) {
	    await recoverExpiredProcessingJobsIfDue();
	    await processNextJob();
	  }
}

runSessionWorker().catch(async (error) => {
  console.error(error);
  await disposeSessionQueueClients();
  process.exit(1);
});
