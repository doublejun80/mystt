import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn()
}));

vi.mock("redis", () => ({
  createClient: createClientMock
}));

import {
  sessionProcessDeadLetterKey,
  sessionProcessProcessingKey,
  sessionProcessQueueKey,
  createSessionProcessJob,
  disposeSessionQueueClients,
  enqueueSessionProcessJob,
  enqueueUniqueSessionProcessJob,
  getSessionProcessQueueDepth,
  ackSessionProcessJob,
  dequeueSessionProcessJob,
  parseSessionProcessJob,
  serializeSessionProcessJob,
  recoverProcessingSessionJobs,
  removeSessionProcessJob,
  deadLetterSessionProcessJob,
  retrySessionProcessJob
} from "./index";

describe("createSessionProcessJob", () => {
  it("defaults queued jobs to a long async transcription timeout", () => {
    const job = createSessionProcessJob({
      sessionId: "sess_long_recording",
      fileId: "11111111-1111-4111-8111-111111111111"
    });

    expect(job.timeoutMs).toBe(600_000);
  });
});

function buildRedisClient(options?: {
  connect?: () => Promise<void>;
  lPush?: () => Promise<number>;
  lLen?: () => Promise<number>;
  lRem?: () => Promise<number>;
  lRange?: () => Promise<string[]>;
  brPopLPush?: () => Promise<string | null>;
  rPop?: () => Promise<string | null>;
  hSet?: () => Promise<number>;
  hGet?: () => Promise<string | null>;
  hDel?: () => Promise<number>;
  set?: () => Promise<string | null>;
  get?: () => Promise<string | null>;
  del?: () => Promise<number>;
}) {
  return {
    isOpen: false,
    connect:
      options?.connect ??
      vi.fn().mockImplementation(async function (this: { isOpen: boolean }) {
        this.isOpen = true;
      }),
    lPush: options?.lPush ?? vi.fn().mockResolvedValue(1),
    lLen: options?.lLen ?? vi.fn().mockResolvedValue(0),
    lRem: options?.lRem ?? vi.fn().mockResolvedValue(0),
    lRange: options?.lRange ?? vi.fn().mockResolvedValue([]),
    brPopLPush: options?.brPopLPush ?? vi.fn().mockResolvedValue(null),
    rPop: options?.rPop ?? vi.fn().mockResolvedValue(null),
    hSet: options?.hSet ?? vi.fn().mockResolvedValue(1),
    hGet: options?.hGet ?? vi.fn().mockResolvedValue(null),
    hDel: options?.hDel ?? vi.fn().mockResolvedValue(0),
    set: options?.set ?? vi.fn().mockResolvedValue("OK"),
    get: options?.get ?? vi.fn().mockResolvedValue(null),
    del: options?.del ?? vi.fn().mockResolvedValue(0),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn()
  };
}

function buildInMemoryRedisClient() {
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, { value: string; expiresAt?: number }>();
  const list = (key: string) => {
    const existing = lists.get(key);

    if (existing) {
      return existing;
    }

    const created: string[] = [];
    lists.set(key, created);
    return created;
  };
  const hash = (key: string) => {
    const existing = hashes.get(key);

    if (existing) {
      return existing;
    }

    const created = new Map<string, string>();
    hashes.set(key, created);
    return created;
  };

  return {
    isOpen: false,
    connect: vi.fn().mockImplementation(async function (this: { isOpen: boolean }) {
      this.isOpen = true;
    }),
    lPush: vi.fn().mockImplementation(async (key: string, value: string) => {
      const values = list(key);
      values.unshift(value);
      return values.length;
    }),
    lLen: vi.fn().mockImplementation(async (key: string) => list(key).length),
    lRem: vi.fn().mockImplementation(async (key: string, count: number, value: string) => {
      const values = list(key);
      let removed = 0;

      for (let index = 0; index < values.length && removed < count; index += 1) {
        if (values[index] === value) {
          values.splice(index, 1);
          removed += 1;
          index -= 1;
        }
      }

      return removed;
    }),
    lRange: vi.fn().mockImplementation(async (key: string, start: number, stop: number) => {
      const values = list(key);
      const normalizedStop = stop < 0 ? values.length + stop : stop;
      return values.slice(start, normalizedStop + 1);
    }),
    brPopLPush: vi.fn().mockImplementation(async (source: string, destination: string) => {
      const payload = list(source).pop();

      if (!payload) {
        return null;
      }

      list(destination).unshift(payload);
      return payload;
    }),
    rPop: vi.fn().mockImplementation(async (key: string) => list(key).pop() ?? null),
    hSet: vi.fn().mockImplementation(async (key: string, field: string, value: string) => {
      hash(key).set(field, value);
      return 1;
    }),
    hGet: vi.fn().mockImplementation(async (key: string, field: string) => hash(key).get(field) ?? null),
    hDel: vi.fn().mockImplementation(async (key: string, field: string) => {
      return hash(key).delete(field) ? 1 : 0;
    }),
    set: vi
      .fn()
      .mockImplementation(
        async (
          key: string,
          value: string,
          options?: { NX?: boolean; PX?: number }
        ): Promise<string | null> => {
          const existing = strings.get(key);
          if (existing?.expiresAt && existing.expiresAt <= Date.now()) {
            strings.delete(key);
          }

          if (options?.NX && strings.has(key)) {
            return null;
          }

          strings.set(key, {
            value,
            expiresAt: options?.PX ? Date.now() + options.PX : undefined
          });
          return "OK";
        }
      ),
    get: vi.fn().mockImplementation(async (key: string) => {
      const existing = strings.get(key);
      if (!existing) {
        return null;
      }

      if (existing.expiresAt && existing.expiresAt <= Date.now()) {
        strings.delete(key);
        return null;
      }

      return existing.value;
    }),
    del: vi.fn().mockImplementation(async (key: string) => {
      return strings.delete(key) ? 1 : 0;
    }),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    lists,
    hashes,
    strings
  };
}

describe("@mystt/session-queue", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  afterEach(async () => {
    await disposeSessionQueueClients();
  });

  it("round-trips payloads with an idempotency key and repairs legacy payloads", () => {
    const job = createSessionProcessJob({
      sessionId: "sess_payload",
      fileId: "11111111-1111-4111-8111-111111111111"
    });

    expect(parseSessionProcessJob(serializeSessionProcessJob(job))).toEqual(job);
    expect(
      parseSessionProcessJob(
        JSON.stringify({
          jobId: "legacy-job",
          sessionId: "sess_payload",
          fileId: "11111111-1111-4111-8111-111111111111",
          createdAt: "2026-05-11T00:00:00.000Z"
        })
      ).idempotencyKey
    ).toBe("session:sess_payload:file:11111111-1111-4111-8111-111111111111");
    expect(() =>
      parseSessionProcessJob(
        JSON.stringify({
          jobId: "bad-job",
          sessionId: "sess_payload",
          createdAt: "2026-05-11T00:00:00.000Z"
        })
      )
    ).toThrow("audioUrl or fileId");
  });

  it("drops failed Redis clients so later status checks can retry with a fresh client", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const firstClient = buildRedisClient({
      connect: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:6379"))
    });
    const secondClient = buildRedisClient({
      lLen: vi.fn().mockResolvedValue(7)
    });

    createClientMock.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);

    await expect(getSessionProcessQueueDepth({ redisUrl })).rejects.toThrow("ECONNREFUSED");
    await expect(getSessionProcessQueueDepth({ redisUrl })).resolves.toBe(7);

    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(createClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: redisUrl,
        socket: expect.objectContaining({
          connectTimeout: 1000,
          reconnectStrategy: false
        })
      })
    );
  });

  it("removes an unclaimed queued job", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildRedisClient({
      lLen: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      lRem: vi.fn().mockResolvedValue(1)
    });
    const job = createSessionProcessJob({
      sessionId: "sess_remove",
      fileId: "11111111-1111-4111-8111-111111111111"
    });

    createClientMock.mockReturnValue(client);

    await enqueueSessionProcessJob({ redisUrl, job });
    await expect(getSessionProcessQueueDepth({ redisUrl })).resolves.toBe(1);
    await expect(removeSessionProcessJob({ redisUrl, job })).resolves.toBe(true);
    await expect(getSessionProcessQueueDepth({ redisUrl })).resolves.toBe(0);
    expect(client.lRem).toHaveBeenCalledTimes(1);
  });

  it("claims jobs into a processing list and acks only after processing", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const job = createSessionProcessJob({
      sessionId: "sess_claim",
      fileId: "11111111-1111-4111-8111-111111111111"
    });
    const client = buildRedisClient({
      brPopLPush: vi.fn().mockResolvedValue(JSON.stringify(job)),
      lRem: vi.fn().mockResolvedValue(1)
    });

    createClientMock.mockReturnValue(client);

    await expect(dequeueSessionProcessJob({ redisUrl, timeoutSeconds: 1 })).resolves.toEqual(
      expect.objectContaining({
        jobId: job.jobId,
        sessionId: job.sessionId,
        claimedAt: expect.any(String),
        leaseExpiresAt: expect.any(String)
      })
    );
    await expect(ackSessionProcessJob({ redisUrl, job })).resolves.toBe(true);

    expect(client.brPopLPush).toHaveBeenCalledWith(
      "mystt:queue:session-process:v1",
      "mystt:queue:session-process:processing:v1",
      1
    );
    expect(client.lRem).toHaveBeenCalledWith(
      "mystt:queue:session-process:processing:v1",
      1,
      JSON.stringify(job)
    );
  });

  it("does not requeue processing jobs while their lease is still active", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();
    const job = createSessionProcessJob({
      sessionId: "sess_active_lease",
      fileId: "11111111-1111-4111-8111-111111111111",
      timeoutMs: 0
    });
    const claimedAt = new Date("2026-05-17T00:00:00.000Z");

    createClientMock.mockReturnValue(client);

    await enqueueSessionProcessJob({ redisUrl, job });
    await expect(
      dequeueSessionProcessJob({
        redisUrl,
        timeoutSeconds: 1,
        leaseMs: 60_000,
        now: claimedAt
      })
    ).resolves.toEqual(
      expect.objectContaining({
        jobId: job.jobId,
        claimedAt: "2026-05-17T00:00:00.000Z",
        leaseExpiresAt: "2026-05-17T00:01:00.000Z"
      })
    );

    await expect(
      recoverProcessingSessionJobs({
        redisUrl,
        now: new Date("2026-05-17T00:00:30.000Z")
      })
    ).resolves.toBe(0);
    await expect(getSessionProcessQueueDepth({ redisUrl })).resolves.toBe(0);
    expect(client.lists.get(sessionProcessProcessingKey)).toHaveLength(1);
  });

  it("requeues processing jobs only after their lease expires", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();
    const job = createSessionProcessJob({
      sessionId: "sess_expired_lease",
      fileId: "11111111-1111-4111-8111-111111111111",
      timeoutMs: 0
    });

    createClientMock.mockReturnValue(client);

    await enqueueSessionProcessJob({ redisUrl, job });
    await dequeueSessionProcessJob({
      redisUrl,
      timeoutSeconds: 1,
      leaseMs: 60_000,
      now: new Date("2026-05-17T00:00:00.000Z")
    });

    await expect(
      recoverProcessingSessionJobs({
        redisUrl,
        now: new Date("2026-05-17T00:01:01.000Z")
      })
    ).resolves.toBe(1);
    await expect(getSessionProcessQueueDepth({ redisUrl })).resolves.toBe(1);
    expect(client.lists.get(sessionProcessProcessingKey)).toHaveLength(0);
  });

  it("removes a recovered queue payload when processing removal fails", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();
    const job = createSessionProcessJob({
      sessionId: "sess_recovery_transition_failure",
      fileId: "11111111-1111-4111-8111-111111111111",
      timeoutMs: 0
    });

    createClientMock.mockReturnValue(client);

    await enqueueSessionProcessJob({ redisUrl, job });
    await dequeueSessionProcessJob({
      redisUrl,
      timeoutSeconds: 1,
      leaseMs: 60_000,
      now: new Date("2026-05-17T00:00:00.000Z")
    });
    client.lRem.mockRejectedValueOnce(new Error("redis removal failed"));

    await expect(
      recoverProcessingSessionJobs({
        redisUrl,
        now: new Date("2026-05-17T00:01:01.000Z")
      })
    ).rejects.toThrow("redis removal failed");

    expect(client.lists.get(sessionProcessQueueKey)).toHaveLength(0);
    expect(client.lists.get(sessionProcessProcessingKey)).toEqual([serializeSessionProcessJob(job)]);
  });

  it("recovers a claimed job on worker restart and processes it only once after ack", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();
    const job = createSessionProcessJob({
      sessionId: "sess_restart_no_duplicate",
      fileId: "11111111-1111-4111-8111-111111111111"
    });

    createClientMock.mockReturnValue(client);

    await enqueueSessionProcessJob({ redisUrl, job });
    await expect(
      dequeueSessionProcessJob({
        redisUrl,
        timeoutSeconds: 1,
        now: new Date("2026-05-17T00:00:00.000Z")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        jobId: job.jobId,
        sessionId: job.sessionId
      })
    );
    await expect(removeSessionProcessJob({ redisUrl, job })).resolves.toBe(false);
    await expect(getSessionProcessQueueDepth({ redisUrl })).resolves.toBe(0);

    await expect(
      recoverProcessingSessionJobs({
        redisUrl,
        now: new Date("2026-05-17T00:11:01.000Z")
      })
    ).resolves.toBe(1);
    await expect(getSessionProcessQueueDepth({ redisUrl })).resolves.toBe(1);
    await expect(dequeueSessionProcessJob({ redisUrl, timeoutSeconds: 1 })).resolves.toEqual(
      expect.objectContaining({
        jobId: job.jobId,
        sessionId: job.sessionId
      })
    );
    await expect(ackSessionProcessJob({ redisUrl, job })).resolves.toBe(true);

    await expect(recoverProcessingSessionJobs({ redisUrl })).resolves.toBe(0);
    await expect(dequeueSessionProcessJob({ redisUrl, timeoutSeconds: 1 })).resolves.toBeNull();
  });

  it("dead-letters malformed queue payloads instead of returning them to the queue", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();

    createClientMock.mockReturnValue(client);

    await client.lPush(sessionProcessQueueKey, "{not-json");
    await expect(dequeueSessionProcessJob({ redisUrl, timeoutSeconds: 1 })).resolves.toBeNull();

    expect(client.lists.get(sessionProcessQueueKey)).toHaveLength(0);
    expect(client.lists.get(sessionProcessProcessingKey)).toHaveLength(0);
    expect(client.lists.get(sessionProcessDeadLetterKey)).toHaveLength(1);
    expect(client.lists.get(sessionProcessDeadLetterKey)?.[0]).toContain("malformed");
  });

  it("keeps the current processing job when retry enqueue fails", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();
    const job = createSessionProcessJob({
      sessionId: "sess_retry_enqueue_failure",
      fileId: "11111111-1111-4111-8111-111111111111"
    });
    const retryJob = {
      ...job,
      jobId: "retry-job",
      attempts: 1,
      createdAt: "2026-05-17T00:00:00.000Z"
    };

    createClientMock.mockReturnValue(client);

    await enqueueSessionProcessJob({ redisUrl, job });
    await dequeueSessionProcessJob({ redisUrl, timeoutSeconds: 1 });
    client.lPush.mockRejectedValueOnce(new Error("redis write failed"));

    await expect(
      retrySessionProcessJob({
        redisUrl,
        currentJob: job,
        retryJob
      })
    ).rejects.toThrow("redis write failed");

    expect(client.lists.get(sessionProcessQueueKey)).toHaveLength(0);
    expect(client.lists.get(sessionProcessProcessingKey)).toEqual([serializeSessionProcessJob(job)]);
  });

  it("removes a queued retry when the retry transition cannot remove the processing job", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();
    const job = createSessionProcessJob({
      sessionId: "sess_retry_transition_failure",
      fileId: "11111111-1111-4111-8111-111111111111"
    });
    const retryJob = {
      ...job,
      jobId: "retry-transition-job",
      attempts: 1,
      createdAt: "2026-05-17T00:00:00.000Z"
    };

    createClientMock.mockReturnValue(client);

    await enqueueSessionProcessJob({ redisUrl, job });
    await dequeueSessionProcessJob({ redisUrl, timeoutSeconds: 1 });
    client.lRem.mockRejectedValueOnce(new Error("redis removal failed"));

    await expect(
      retrySessionProcessJob({
        redisUrl,
        currentJob: job,
        retryJob
      })
    ).rejects.toThrow("redis removal failed");

    expect(client.lists.get(sessionProcessQueueKey)).toHaveLength(0);
    expect(client.lists.get(sessionProcessProcessingKey)).toEqual([serializeSessionProcessJob(job)]);
  });

  it("does not keep a dead-letter record when the processing job is already missing", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();
    const job = createSessionProcessJob({
      sessionId: "sess_dead_letter_missing_processing",
      fileId: "11111111-1111-4111-8111-111111111111"
    });

    createClientMock.mockReturnValue(client);

    await expect(
      deadLetterSessionProcessJob({
        redisUrl,
        job,
        reason: "terminal failure"
      })
    ).resolves.toBe(false);

    expect(client.lists.get(sessionProcessDeadLetterKey) ?? []).toHaveLength(0);
    expect(client.lists.get(sessionProcessProcessingKey) ?? []).toHaveLength(0);
  });

  it("removes a dead-letter record when the processing removal fails", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();
    const job = createSessionProcessJob({
      sessionId: "sess_dead_letter_transition_failure",
      fileId: "11111111-1111-4111-8111-111111111111"
    });

    createClientMock.mockReturnValue(client);

    await enqueueSessionProcessJob({ redisUrl, job });
    await dequeueSessionProcessJob({ redisUrl, timeoutSeconds: 1 });
    client.lRem.mockRejectedValueOnce(new Error("redis removal failed"));

    await expect(
      deadLetterSessionProcessJob({
        redisUrl,
        job,
        reason: "terminal failure"
      })
    ).rejects.toThrow("redis removal failed");

    expect(client.lists.get(sessionProcessDeadLetterKey) ?? []).toHaveLength(0);
    expect(client.lists.get(sessionProcessProcessingKey)).toEqual([serializeSessionProcessJob(job)]);
  });

  it("deduplicates idempotency keys in Redis instead of process-local memory", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildInMemoryRedisClient();
    const firstJob = createSessionProcessJob({
      sessionId: "sess_dedupe",
      fileId: "11111111-1111-4111-8111-111111111111"
    });
    const duplicateJob = {
      ...firstJob,
      jobId: "duplicate-job"
    };

    createClientMock.mockReturnValue(client);

    await expect(
      enqueueUniqueSessionProcessJob({
        redisUrl,
        job: firstJob,
        ttlMs: 60_000
      })
    ).resolves.toEqual({ enqueued: true, job: firstJob });
    await expect(
      enqueueUniqueSessionProcessJob({
        redisUrl,
        job: duplicateJob,
        ttlMs: 60_000
      })
    ).resolves.toEqual({ enqueued: false, job: firstJob });
    await expect(getSessionProcessQueueDepth({ redisUrl })).resolves.toBe(1);
  });

  it("retries unique enqueue when the idempotency key expires between SET NX and duplicate lookup", async () => {
    const redisUrl = "redis://127.0.0.1:6379";
    const client = buildRedisClient({
      set: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("OK"),
      get: vi.fn().mockResolvedValueOnce(null),
      lPush: vi.fn().mockResolvedValue(1)
    });
    const job = createSessionProcessJob({
      sessionId: "sess_dedupe_expired_between_set_and_get",
      fileId: "11111111-1111-4111-8111-111111111111"
    });

    createClientMock.mockReturnValue(client);

    await expect(
      enqueueUniqueSessionProcessJob({
        redisUrl,
        job,
        ttlMs: 60_000
      })
    ).resolves.toEqual({ enqueued: true, job });

    expect(client.set).toHaveBeenCalledTimes(2);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.lPush).toHaveBeenCalledTimes(1);
  });
});
