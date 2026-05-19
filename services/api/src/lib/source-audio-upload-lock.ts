import { createHash } from "node:crypto";

import { isPostgresConfigured } from "../config";
import { getPostgresPool } from "./backends";

const sourceAudioUploadLocks = new Map<string, Promise<void>>();
const postgresSourceAudioUploadLockNamespace = 54_240_002;

export function buildSourceAudioUploadAdvisoryLockKey(sessionId: string) {
  const digest = createHash("sha256").update(sessionId).digest();
  return [
    postgresSourceAudioUploadLockNamespace,
    digest.readInt32BE(0)
  ] as const;
}

async function withProcessLocalSessionSourceAudioLock<T>(
  sessionId: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = sourceAudioUploadLocks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current);

  sourceAudioUploadLocks.set(sessionId, chained);

  try {
    await previous.catch(() => undefined);
    return await fn();
  } finally {
    release();
    if (sourceAudioUploadLocks.get(sessionId) === chained) {
      sourceAudioUploadLocks.delete(sessionId);
    }
  }
}

async function acquirePostgresSourceAudioUploadLock(sessionId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  const [namespace, lockKey] = buildSourceAudioUploadAdvisoryLockKey(sessionId);

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [namespace, lockKey]);
  } catch (error) {
    client.release();
    throw error;
  }

  return {
    async release() {
      await client
        .query("SELECT pg_advisory_unlock($1, $2)", [namespace, lockKey])
        .catch((error: unknown) => {
          console.warn(
            "[source-audio-upload-lock] Failed to release Postgres upload lock:",
            error instanceof Error ? error.message : error
          );
        });
      client.release();
    }
  };
}

export async function withSessionSourceAudioLock<T>(
  sessionId: string,
  fn: () => Promise<T>
): Promise<T> {
  return withProcessLocalSessionSourceAudioLock(sessionId, async () => {
    if (!isPostgresConfigured()) {
      return fn();
    }

    let postgresLock: Awaited<ReturnType<typeof acquirePostgresSourceAudioUploadLock>>;
    try {
      postgresLock = await acquirePostgresSourceAudioUploadLock(sessionId);
    } catch (error) {
      console.warn(
        "[source-audio-upload-lock] Postgres upload lock unavailable; using process-local lock:",
        error instanceof Error ? error.message : error
      );
      return fn();
    }

    try {
      return await fn();
    } finally {
      await postgresLock.release();
    }
  });
}
