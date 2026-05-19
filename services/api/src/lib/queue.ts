import {
  createSessionProcessJob,
  defaultSessionProcessingTimeoutMs,
  enqueueUniqueSessionProcessJob,
  getSessionProcessQueueDepth,
  removeSessionProcessJob,
  type SessionProcessJob
} from "@mystt/session-queue";

import { apiConfig, isRedisConfigured } from "../config";

export interface QueueRuntimeStatus {
  configured: boolean;
  mode: "disabled" | "remote" | "inline-fallback";
  depth: number | null;
  lastEnqueueOk: boolean | null;
  lastDepthOk: boolean | null;
  lastError?: string;
}

const queueStatus: QueueRuntimeStatus = {
  configured: isRedisConfigured(),
  mode: isRedisConfigured() ? "remote" : "disabled",
  depth: null,
  lastEnqueueOk: null,
  lastDepthOk: null
};
const minimumQueueIdempotencyTtlMs = 10 * 60 * 1000;
const queueIdempotencyGraceMs = 2 * 60 * 1000;

export function resolveSessionProcessIdempotencyTtlMs(timeoutMs?: number) {
  return Math.max(
    minimumQueueIdempotencyTtlMs,
    (timeoutMs ?? defaultSessionProcessingTimeoutMs) + queueIdempotencyGraceMs
  );
}

function setQueueStatus(input: Partial<QueueRuntimeStatus>) {
  Object.assign(queueStatus, input, {
    configured: isRedisConfigured()
  });
}

export function isQueueConfigured() {
  return isRedisConfigured() && Boolean(apiConfig.REDIS_URL);
}

export async function enqueueSessionProcessingJob(input: {
  sessionId: string;
  audioUrl?: string;
  fileId?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<{
  enqueued: boolean;
  duplicate?: boolean;
  job?: SessionProcessJob;
  depth?: number;
}> {
  if (!isQueueConfigured() || !apiConfig.REDIS_URL) {
    setQueueStatus({
      mode: "disabled",
      depth: null,
      lastEnqueueOk: null,
      lastDepthOk: null,
      lastError: undefined
    });
    return { enqueued: false };
  }

  const job = createSessionProcessJob(input);

  try {
    const enqueueResult = await enqueueUniqueSessionProcessJob({
      redisUrl: apiConfig.REDIS_URL,
      job,
      ttlMs: resolveSessionProcessIdempotencyTtlMs(input.timeoutMs)
    });
    const depth = await getSessionProcessQueueDepth({
      redisUrl: apiConfig.REDIS_URL
    });

    setQueueStatus({
      mode: "remote",
      depth,
      lastEnqueueOk: true,
      lastDepthOk: true,
      lastError: undefined
    });

    return {
      enqueued: enqueueResult.enqueued,
      duplicate: !enqueueResult.enqueued,
      job: enqueueResult.job,
      depth
    };
  } catch (error) {
    setQueueStatus({
      mode: "inline-fallback",
      lastEnqueueOk: false,
      lastError: error instanceof Error ? error.message : String(error)
    });
    console.warn(
      "[queue] Redis enqueue failed; falling back to inline processing:",
      error instanceof Error ? error.message : error
    );
    return { enqueued: false };
  }
}

export async function removeQueuedSessionProcessingJob(input: {
  job: SessionProcessJob;
}): Promise<boolean> {
  if (!isQueueConfigured() || !apiConfig.REDIS_URL) {
    return false;
  }

  try {
    const removed = await removeSessionProcessJob({
      redisUrl: apiConfig.REDIS_URL,
      job: input.job
    });
    const depth = await getSessionProcessQueueDepth({
      redisUrl: apiConfig.REDIS_URL
    });

    setQueueStatus({
      mode: "remote",
      depth,
      lastDepthOk: true,
      lastError: undefined
    });

    return removed;
  } catch (error) {
    setQueueStatus({
      mode: "inline-fallback",
      lastDepthOk: false,
      lastError: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

export async function getSessionProcessingQueueStatus() {
  if (!isQueueConfigured() || !apiConfig.REDIS_URL) {
    setQueueStatus({
      mode: "disabled",
      depth: null,
      lastEnqueueOk: null,
      lastDepthOk: null,
      lastError: undefined
    });
    return { ...queueStatus };
  }

  try {
    const depth = await getSessionProcessQueueDepth({
      redisUrl: apiConfig.REDIS_URL
    });

    setQueueStatus({
      mode: "remote",
      depth,
      lastDepthOk: true,
      lastError: undefined
    });
  } catch (error) {
    setQueueStatus({
      mode: "inline-fallback",
      depth: null,
      lastDepthOk: false,
      lastError: error instanceof Error ? error.message : String(error)
    });
  }

  return { ...queueStatus };
}
