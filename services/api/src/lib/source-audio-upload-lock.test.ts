import { afterEach, describe, expect, it, vi } from "vitest";

async function loadUploadLockModule(input: {
  postgresConfigured: boolean;
  pool?: {
    connect: () => Promise<{
      query: (sql: string, values?: unknown[]) => Promise<unknown>;
      release: () => void;
    }>;
  };
}) {
  vi.resetModules();
  vi.doMock("../config", () => ({
    isPostgresConfigured: () => input.postgresConfigured
  }));
  vi.doMock("./backends", () => ({
    getPostgresPool: () => input.pool
  }));

  return import("./source-audio-upload-lock");
}

describe("source audio upload lock", () => {
  afterEach(() => {
    vi.doUnmock("../config");
    vi.doUnmock("./backends");
  });

  it("serializes same-session uploads with the process-local lock", async () => {
    const { withSessionSourceAudioLock } = await loadUploadLockModule({
      postgresConfigured: false
    });
    const events: string[] = [];
    let releaseFirst!: () => void;

    const first = withSessionSourceAudioLock("sess_lock", async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first:end");
    });
    const second = withSessionSourceAudioLock("sess_lock", async () => {
      events.push("second:start");
    });

    await vi.waitFor(() => {
      expect(events).toEqual(["first:start"]);
    });
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("holds a Postgres advisory lock around the upload section when Postgres is configured", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const release = vi.fn();
    const connect = vi.fn(async () => ({
      query,
      release
    }));
    const { buildSourceAudioUploadAdvisoryLockKey, withSessionSourceAudioLock } =
      await loadUploadLockModule({
        postgresConfigured: true,
        pool: { connect }
      });
    const expectedKey = buildSourceAudioUploadAdvisoryLockKey("sess_pg_lock");
    const events: string[] = [];

    await withSessionSourceAudioLock("sess_pg_lock", async () => {
      events.push("inside");
      expect(query).toHaveBeenCalledWith("SELECT pg_advisory_lock($1, $2)", [
        expectedKey[0],
        expectedKey[1]
      ]);
    });

    expect(events).toEqual(["inside"]);
    expect(query).toHaveBeenLastCalledWith("SELECT pg_advisory_unlock($1, $2)", [
      expectedKey[0],
      expectedKey[1]
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("falls back to the process-local lock if the Postgres lock cannot be acquired", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const connect = vi.fn(async () => {
      throw new Error("postgres unavailable");
    });
    const { withSessionSourceAudioLock } = await loadUploadLockModule({
      postgresConfigured: true,
      pool: { connect }
    });

    await expect(
      withSessionSourceAudioLock("sess_fallback", async () => "stored")
    ).resolves.toBe("stored");
    expect(warn).toHaveBeenCalledWith(
      "[source-audio-upload-lock] Postgres upload lock unavailable; using process-local lock:",
      "postgres unavailable"
    );

    warn.mockRestore();
  });

  it("releases a Postgres client when advisory lock acquisition fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const query = vi.fn(async () => {
      throw new Error("lock denied");
    });
    const release = vi.fn();
    const connect = vi.fn(async () => ({
      query,
      release
    }));
    const { withSessionSourceAudioLock } = await loadUploadLockModule({
      postgresConfigured: true,
      pool: { connect }
    });

    await expect(
      withSessionSourceAudioLock("sess_lock_denied", async () => "stored")
    ).resolves.toBe("stored");

    expect(release).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[source-audio-upload-lock] Postgres upload lock unavailable; using process-local lock:",
      "lock denied"
    );

    warn.mockRestore();
  });

  it("does not rerun the protected upload if it fails after acquiring the Postgres lock", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const release = vi.fn();
    const connect = vi.fn(async () => ({
      query,
      release
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { withSessionSourceAudioLock } = await loadUploadLockModule({
      postgresConfigured: true,
      pool: { connect }
    });
    const upload = vi.fn(async () => {
      throw new Error("soniox upload failed");
    });

    await expect(withSessionSourceAudioLock("sess_pg_failure", upload)).rejects.toThrow(
      "soniox upload failed"
    );

    expect(upload).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("SELECT pg_advisory_unlock($1, $2)", [
      expect.any(Number),
      expect.any(Number)
    ]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalledWith(
      "[source-audio-upload-lock] Postgres upload lock unavailable; using process-local lock:",
      expect.anything()
    );

    warn.mockRestore();
  });
});
