import { createClient, type RedisClientType } from "redis";

export const sessionProcessQueueKey = "mystt:queue:session-process:v1";
export const sessionProcessProcessingKey = "mystt:queue:session-process:processing:v1";
export const sessionProcessProcessingLeaseKey = "mystt:queue:session-process:processing-leases:v1";
export const sessionProcessDeadLetterKey = "mystt:queue:session-process:dead-letter:v1";
const sessionProcessIdempotencyKeyPrefix = "mystt:queue:session-process:idempotency:v1:";
const defaultSessionProcessLeaseMs = 5 * 60 * 1000;
export const defaultSessionProcessingTimeoutMs = 10 * 60 * 1000;
const sessionProcessLeaseGraceMs = 60 * 1000;
const redisConnectTimeoutMs = 1000;

export interface SessionProcessJob {
  jobId: string;
  idempotencyKey: string;
  sessionId: string;
  audioUrl?: string;
  fileId?: string;
  createdAt: string;
  requestedBy: "api";
  pollIntervalMs?: number;
  timeoutMs?: number;
  attempts?: number;
  claimedAt?: string;
  leaseExpiresAt?: string;
}

interface SessionProcessLease {
  jobId: string;
  idempotencyKey: string;
  claimedAt: string;
  leaseExpiresAt: string;
}

interface SessionProcessDeadLetter {
  failedAt: string;
  source: "dequeue" | "recover" | "worker";
  reason: string;
  originalPayload: string;
  jobId?: string;
  sessionId?: string;
  idempotencyKey?: string;
  attempts?: number;
}

const clients = new Map<string, RedisClientType>();

async function getRedisClient(redisUrl: string) {
  const existing = clients.get(redisUrl);

  if (existing?.isOpen) {
    return existing;
  }

  const client =
    existing ??
    createClient({
      url: redisUrl,
      socket: {
        connectTimeout: redisConnectTimeoutMs,
        reconnectStrategy: false
      }
    });

  if (!existing) {
    client.on("error", () => {
      // Callers surface queue errors from each operation.
    });
    clients.set(redisUrl, client);
  }

  if (!client.isOpen) {
    try {
      await client.connect();
    } catch (error) {
      clients.delete(redisUrl);
      throw error;
    }
  }

  return client;
}

export function createSessionProcessJob(input: {
  sessionId: string;
  audioUrl?: string;
  fileId?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): SessionProcessJob {
  const sourceKey = input.fileId ? `file:${input.fileId}` : `audio:${input.audioUrl}`;
  const idempotencyKey = `session:${input.sessionId}:${sourceKey}`;
  return {
    jobId: crypto.randomUUID(),
    idempotencyKey,
    sessionId: input.sessionId,
    audioUrl: input.audioUrl,
    fileId: input.fileId,
    createdAt: new Date().toISOString(),
    requestedBy: "api",
    pollIntervalMs: input.pollIntervalMs,
    timeoutMs: input.timeoutMs ?? defaultSessionProcessingTimeoutMs,
    attempts: 0
  };
}

export function serializeSessionProcessJob(job: SessionProcessJob) {
  return JSON.stringify(job);
}

function buildQueuedSessionProcessJob(job: SessionProcessJob): SessionProcessJob {
  const { claimedAt: _claimedAt, leaseExpiresAt: _leaseExpiresAt, ...queuedJob } = job;
  return queuedJob;
}

function serializeQueuedSessionProcessJob(job: SessionProcessJob) {
  return serializeSessionProcessJob(buildQueuedSessionProcessJob(job));
}

function buildIdempotencyRedisKey(idempotencyKey: string) {
  return `${sessionProcessIdempotencyKeyPrefix}${idempotencyKey}`;
}

export function parseSessionProcessJob(input: string): SessionProcessJob {
  const parsed = JSON.parse(input) as Partial<SessionProcessJob>;

  if (!parsed.jobId || !parsed.sessionId || !parsed.createdAt) {
    throw new Error("Queue payload is missing required session job fields.");
  }

  if (!parsed.audioUrl && !parsed.fileId) {
    throw new Error("Queue payload must include audioUrl or fileId.");
  }

  return {
    jobId: parsed.jobId,
    idempotencyKey:
      parsed.idempotencyKey ??
      `session:${parsed.sessionId}:${parsed.fileId ? `file:${parsed.fileId}` : `audio:${parsed.audioUrl}`}`,
    sessionId: parsed.sessionId,
    audioUrl: parsed.audioUrl,
    fileId: parsed.fileId,
    createdAt: parsed.createdAt,
    requestedBy: parsed.requestedBy === "api" ? "api" : "api",
    pollIntervalMs: parsed.pollIntervalMs,
    timeoutMs: parsed.timeoutMs,
    attempts: parsed.attempts ?? 0,
    claimedAt: typeof parsed.claimedAt === "string" ? parsed.claimedAt : undefined,
    leaseExpiresAt: typeof parsed.leaseExpiresAt === "string" ? parsed.leaseExpiresAt : undefined
  };
}

function buildDeadLetterRecord(input: {
  payload: string;
  source: SessionProcessDeadLetter["source"];
  reason: string;
  failedAt: string;
  job?: SessionProcessJob;
}): SessionProcessDeadLetter {
  return {
    failedAt: input.failedAt,
    source: input.source,
    reason: input.reason,
    originalPayload: input.payload,
    jobId: input.job?.jobId,
    sessionId: input.job?.sessionId,
    idempotencyKey: input.job?.idempotencyKey,
    attempts: input.job?.attempts
  };
}

async function quarantineSessionProcessPayload(input: {
  client: RedisClientType;
  payload: string;
  source: SessionProcessDeadLetter["source"];
  reason: string;
  now: Date;
  job?: SessionProcessJob;
}) {
  const deadLetter = buildDeadLetterRecord({
    payload: input.payload,
    source: input.source,
    reason: input.reason,
    failedAt: input.now.toISOString(),
    job: input.job
  });

  await input.client.lPush(sessionProcessDeadLetterKey, JSON.stringify(deadLetter));
  await input.client.lRem(sessionProcessProcessingKey, 1, input.payload);

  if (input.job) {
    await input.client.hDel(sessionProcessProcessingLeaseKey, input.job.jobId);
    await input.client.del(buildIdempotencyRedisKey(input.job.idempotencyKey));
  }
}

function buildClaimedJob(input: {
  job: SessionProcessJob;
  now: Date;
  leaseMs: number;
}): SessionProcessJob & { claimedAt: string; leaseExpiresAt: string } {
  const claimedAt = input.now.toISOString();
  return {
    ...input.job,
    claimedAt,
    leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs).toISOString()
  };
}

function parseLease(input: string | null): SessionProcessLease | null {
  if (!input) {
    return null;
  }

  try {
    const parsed = JSON.parse(input) as Partial<SessionProcessLease>;
    if (
      !parsed.jobId ||
      !parsed.idempotencyKey ||
      typeof parsed.claimedAt !== "string" ||
      typeof parsed.leaseExpiresAt !== "string"
    ) {
      return null;
    }

    return {
      jobId: parsed.jobId,
      idempotencyKey: parsed.idempotencyKey,
      claimedAt: parsed.claimedAt,
      leaseExpiresAt: parsed.leaseExpiresAt
    };
  } catch {
    return null;
  }
}

function leaseIsActive(lease: SessionProcessLease | null, now: Date) {
  if (!lease) {
    return false;
  }

  const leaseExpiresAtMs = Date.parse(lease.leaseExpiresAt);
  return Number.isFinite(leaseExpiresAtMs) && leaseExpiresAtMs > now.getTime();
}

export async function enqueueSessionProcessJob(input: {
  redisUrl: string;
  job: SessionProcessJob;
}) {
  const client = await getRedisClient(input.redisUrl);
  await client.lPush(sessionProcessQueueKey, serializeQueuedSessionProcessJob(input.job));
}

export async function enqueueUniqueSessionProcessJob(input: {
  redisUrl: string;
  job: SessionProcessJob;
  ttlMs: number;
}): Promise<{ enqueued: boolean; job: SessionProcessJob }> {
  const client = await getRedisClient(input.redisUrl);
  const queuedJob = buildQueuedSessionProcessJob(input.job);
  const payload = serializeSessionProcessJob(queuedJob);
  const idempotencyKey = buildIdempotencyRedisKey(queuedJob.idempotencyKey);

  for (let claimAttempt = 0; claimAttempt < 2; claimAttempt += 1) {
    const claimed = await client.set(idempotencyKey, payload, {
      NX: true,
      PX: input.ttlMs
    });

    if (claimed === "OK") {
      try {
        await client.lPush(sessionProcessQueueKey, payload);
        return { enqueued: true, job: queuedJob };
      } catch (error) {
        await client.del(idempotencyKey).catch(() => undefined);
        throw error;
      }
    }

    const existingPayload = await client.get(idempotencyKey);

    if (!existingPayload) {
      continue;
    }

    try {
      return { enqueued: false, job: parseSessionProcessJob(existingPayload) };
    } catch {
      return { enqueued: false, job: queuedJob };
    }
  }

  return { enqueued: false, job: queuedJob };
}

export async function removeSessionProcessJob(input: {
  redisUrl: string;
  job: SessionProcessJob;
}) {
  const client = await getRedisClient(input.redisUrl);
  const payload = serializeQueuedSessionProcessJob(input.job);
  const queuedRemoved = await client.lRem(sessionProcessQueueKey, 1, payload);

  if (queuedRemoved > 0) {
    await client.del(buildIdempotencyRedisKey(input.job.idempotencyKey));
  }

  return queuedRemoved > 0;
}

export async function dequeueSessionProcessJob(input: {
  redisUrl: string;
  timeoutSeconds?: number;
  leaseMs?: number;
  now?: Date;
}): Promise<SessionProcessJob | null> {
  const client = await getRedisClient(input.redisUrl);
  const result = await client.brPopLPush(
    sessionProcessQueueKey,
    sessionProcessProcessingKey,
    input.timeoutSeconds ?? 5
  );

  if (!result) {
    return null;
  }

  let job: SessionProcessJob;

  try {
    job = parseSessionProcessJob(result);
  } catch (error) {
    await quarantineSessionProcessPayload({
      client,
      payload: result,
      source: "dequeue",
      reason: `malformed payload: ${error instanceof Error ? error.message : String(error)}`,
      now: input.now ?? new Date()
    });
    return null;
  }

  const claimedJob = buildClaimedJob({
    job,
    now: input.now ?? new Date(),
    leaseMs: Math.max(
      input.leaseMs ?? defaultSessionProcessLeaseMs,
      (job.timeoutMs ?? defaultSessionProcessingTimeoutMs) + sessionProcessLeaseGraceMs
    )
  });
  await client.hSet(
    sessionProcessProcessingLeaseKey,
    job.jobId,
    JSON.stringify({
      jobId: claimedJob.jobId,
      idempotencyKey: claimedJob.idempotencyKey,
      claimedAt: claimedJob.claimedAt,
      leaseExpiresAt: claimedJob.leaseExpiresAt
    } satisfies SessionProcessLease)
  );

  return claimedJob;
}

export async function ackSessionProcessJob(input: {
  redisUrl: string;
  job: SessionProcessJob;
}) {
  const client = await getRedisClient(input.redisUrl);
  const payload = serializeQueuedSessionProcessJob(input.job);
  const removed = await client.lRem(
    sessionProcessProcessingKey,
    1,
    payload
  );

  if (removed > 0) {
    await client.hDel(sessionProcessProcessingLeaseKey, input.job.jobId);
  }

  return removed > 0;
}

export async function retrySessionProcessJob(input: {
  redisUrl: string;
  currentJob: SessionProcessJob;
  retryJob: SessionProcessJob;
}) {
  const client = await getRedisClient(input.redisUrl);
  const retryPayload = serializeQueuedSessionProcessJob(input.retryJob);

  await client.lPush(sessionProcessQueueKey, retryPayload);

  let removed: number;

  try {
    removed = await client.lRem(
      sessionProcessProcessingKey,
      1,
      serializeQueuedSessionProcessJob(input.currentJob)
    );
  } catch (error) {
    await client.lRem(sessionProcessQueueKey, 1, retryPayload).catch(() => undefined);
    throw error;
  }

  if (removed > 0) {
    await client.hDel(sessionProcessProcessingLeaseKey, input.currentJob.jobId);
    return true;
  }

  await client.lRem(sessionProcessQueueKey, 1, retryPayload).catch(() => undefined);
  return false;
}

export async function deadLetterSessionProcessJob(input: {
  redisUrl: string;
  job: SessionProcessJob;
  reason: string;
  now?: Date;
}) {
  const client = await getRedisClient(input.redisUrl);
  const payload = serializeQueuedSessionProcessJob(input.job);
  const deadLetterPayload = JSON.stringify(
    buildDeadLetterRecord({
      payload,
      source: "worker",
      reason: input.reason,
      failedAt: (input.now ?? new Date()).toISOString(),
      job: input.job
    })
  );

  await client.lPush(sessionProcessDeadLetterKey, deadLetterPayload);

  let removed: number;

  try {
    removed = await client.lRem(sessionProcessProcessingKey, 1, payload);
  } catch (error) {
    await client.lRem(sessionProcessDeadLetterKey, 1, deadLetterPayload).catch(() => undefined);
    throw error;
  }

  if (removed > 0) {
    await client.hDel(sessionProcessProcessingLeaseKey, input.job.jobId);
    await client.del(buildIdempotencyRedisKey(input.job.idempotencyKey));
  } else {
    await client.lRem(sessionProcessDeadLetterKey, 1, deadLetterPayload).catch(() => undefined);
  }

  return removed > 0;
}

export async function recoverProcessingSessionJobs(input: { redisUrl: string; now?: Date }) {
  const client = await getRedisClient(input.redisUrl);
  const now = input.now ?? new Date();
  let recovered = 0;
  const processingPayloads = await client.lRange(sessionProcessProcessingKey, 0, -1);

  for (const payload of processingPayloads) {
    let job: SessionProcessJob;

    try {
      job = parseSessionProcessJob(payload);
    } catch (error) {
      await quarantineSessionProcessPayload({
        client,
        payload,
        source: "recover",
        reason: `malformed payload: ${error instanceof Error ? error.message : String(error)}`,
        now
      });
      continue;
    }

    const lease = parseLease(
      (await client.hGet(sessionProcessProcessingLeaseKey, job.jobId)) ?? null
    );
    if (leaseIsActive(lease, now)) {
      continue;
    }

    const queuedPayload = serializeQueuedSessionProcessJob(job);
    await client.lPush(sessionProcessQueueKey, queuedPayload);
    let removed: number;

    try {
      removed = await client.lRem(sessionProcessProcessingKey, 1, payload);
    } catch (error) {
      await client.lRem(sessionProcessQueueKey, 1, queuedPayload).catch(() => undefined);
      throw error;
    }

    if (removed > 0) {
      await client.hDel(sessionProcessProcessingLeaseKey, job.jobId);
      recovered += 1;
    } else {
      await client.lRem(sessionProcessQueueKey, 1, queuedPayload).catch(() => undefined);
    }
  }

  return recovered;
}

export async function getSessionProcessQueueDepth(input: { redisUrl: string }) {
  const client = await getRedisClient(input.redisUrl);
  return client.lLen(sessionProcessQueueKey);
}

export async function disposeSessionQueueClients() {
  await Promise.all(
    [...clients.values()].map(async (client) => {
      if (client.isOpen) {
        await client.quit();
      }
    })
  );
  clients.clear();
}
