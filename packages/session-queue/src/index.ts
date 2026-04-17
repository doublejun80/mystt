import { createClient, type RedisClientType } from "redis";

export const sessionProcessQueueKey = "mystt:queue:session-process:v1";

export interface SessionProcessJob {
  jobId: string;
  sessionId: string;
  audioUrl?: string;
  fileId?: string;
  createdAt: string;
  requestedBy: "api";
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const clients = new Map<string, RedisClientType>();

async function getRedisClient(redisUrl: string) {
  const existing = clients.get(redisUrl);

  if (existing?.isOpen) {
    return existing;
  }

  const client = existing ?? createClient({ url: redisUrl });

  if (!existing) {
    client.on("error", () => {
      // Callers surface queue errors from each operation.
    });
    clients.set(redisUrl, client);
  }

  if (!client.isOpen) {
    await client.connect();
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
  return {
    jobId: crypto.randomUUID(),
    sessionId: input.sessionId,
    audioUrl: input.audioUrl,
    fileId: input.fileId,
    createdAt: new Date().toISOString(),
    requestedBy: "api",
    pollIntervalMs: input.pollIntervalMs,
    timeoutMs: input.timeoutMs
  };
}

export function serializeSessionProcessJob(job: SessionProcessJob) {
  return JSON.stringify(job);
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
    sessionId: parsed.sessionId,
    audioUrl: parsed.audioUrl,
    fileId: parsed.fileId,
    createdAt: parsed.createdAt,
    requestedBy: parsed.requestedBy === "api" ? "api" : "api",
    pollIntervalMs: parsed.pollIntervalMs,
    timeoutMs: parsed.timeoutMs
  };
}

export async function enqueueSessionProcessJob(input: {
  redisUrl: string;
  job: SessionProcessJob;
}) {
  const client = await getRedisClient(input.redisUrl);
  await client.lPush(sessionProcessQueueKey, serializeSessionProcessJob(input.job));
}

export async function dequeueSessionProcessJob(input: {
  redisUrl: string;
  timeoutSeconds?: number;
}): Promise<SessionProcessJob | null> {
  const client = await getRedisClient(input.redisUrl);
  const result = await client.brPop(sessionProcessQueueKey, input.timeoutSeconds ?? 5);

  if (!result) {
    return null;
  }

  return parseSessionProcessJob(result.element);
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
