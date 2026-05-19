import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ArchiveSessionSummary = {
  sessionId: string;
  mimeType: string;
  createdAt: string;
  chunkCount: number;
  lastSequence: number;
  isComplete: boolean;
};

type LiveRecordingArchiveModule = typeof import("./live-recording-archive") & {
  listRecoverableLiveRecordingArchives?: () => Promise<ArchiveSessionSummary[] | null>;
};

type FakeKeyRange = {
  value: IDBValidKey;
};

type FakeStoreDefinition = {
  keyPath: string | string[];
  records: Map<string, unknown>;
};

class FakeIndexedDb {
  private databases = new Map<string, FakeDatabaseState>();

  open(name: string) {
    const request = {} as IDBOpenDBRequest;
    const databaseState =
      this.databases.get(name) ?? new FakeDatabaseState(name, this.databases);

    this.databases.set(name, databaseState);

    queueMicrotask(() => {
      Object.defineProperty(request, "result", {
        configurable: true,
        value: new FakeDatabase(databaseState)
      });

      request.onupgradeneeded?.(new Event("upgradeneeded") as IDBVersionChangeEvent);
      request.onsuccess?.(new Event("success"));
    });

    return request;
  }
}

class FakeDatabaseState {
  readonly stores = new Map<string, FakeStoreDefinition>();

  constructor(
    readonly name: string,
    private readonly databases: Map<string, FakeDatabaseState>
  ) {}

  delete() {
    this.databases.delete(this.name);
  }
}

class FakeDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.state.stores.has(name)
  } as DOMStringList;

  constructor(private readonly state: FakeDatabaseState) {}

  createObjectStore(name: string, options: IDBObjectStoreParameters) {
    const definition = {
      keyPath: options.keyPath as string | string[],
      records: new Map<string, unknown>()
    };
    this.state.stores.set(name, definition);

    return new FakeObjectStore(definition, new FakeTransaction(this.state));
  }

  transaction(storeNames: string | string[], mode?: IDBTransactionMode) {
    void storeNames;
    void mode;

    return new FakeTransaction(this.state) as unknown as IDBTransaction;
  }

  close() {}
}

class FakeTransaction {
  onabort: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  oncomplete: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  error: DOMException | null = null;
  private completeTimer: ReturnType<typeof setTimeout> | null = null;
  private completed = false;

  constructor(private readonly state: FakeDatabaseState) {}

  objectStore(name: string) {
    const definition = this.state.stores.get(name);
    if (!definition) {
      throw new Error(`Missing fake object store ${name}`);
    }

    return new FakeObjectStore(definition, this) as unknown as IDBObjectStore;
  }

  scheduleComplete() {
    if (this.completed) {
      return;
    }
    if (this.completeTimer) {
      clearTimeout(this.completeTimer);
    }

    this.completeTimer = setTimeout(() => {
      this.completed = true;
      this.oncomplete?.call(this as unknown as IDBTransaction, new Event("complete"));
    }, 0);
  }
}

class FakeObjectStore {
  constructor(
    private readonly definition: FakeStoreDefinition,
    private readonly transaction: FakeTransaction
  ) {}

  createIndex() {
    return {} as IDBIndex;
  }

  index(name: string) {
    if (name !== "bySessionId") {
      throw new Error(`Unsupported fake index ${name}`);
    }

    return new FakeIndex(this.definition, this.transaction) as unknown as IDBIndex;
  }

  put(value: unknown) {
    this.definition.records.set(encodeKey(getRecordKey(this.definition.keyPath, value)), value);
    this.transaction.scheduleComplete();
    return makeRequest(this.transaction, undefined);
  }

  add(value: unknown) {
    const key = encodeKey(getRecordKey(this.definition.keyPath, value));

    if (this.definition.records.has(key)) {
      const request = {} as IDBRequest<undefined>;
      queueMicrotask(() => {
        this.transaction.error = new DOMException("Constraint failed", "ConstraintError");
        request.onerror?.(new Event("error"));
        this.transaction.onerror?.call(
          this.transaction as unknown as IDBTransaction,
          new Event("error")
        );
      });
      return request;
    }

    this.definition.records.set(key, value);
    this.transaction.scheduleComplete();
    return makeRequest(this.transaction, undefined);
  }

  get(key: IDBValidKey) {
    return makeRequest(this.transaction, this.definition.records.get(encodeKey(key)));
  }

  getAll() {
    return makeRequest(this.transaction, [...this.definition.records.values()]);
  }

  getAllKeys() {
    return makeRequest(
      this.transaction,
      [...this.definition.records.values()].map((record) =>
        getRecordKey(this.definition.keyPath, record)
      )
    );
  }

  delete(key: IDBValidKey) {
    this.definition.records.delete(encodeKey(key));
    this.transaction.scheduleComplete();
    return makeRequest(this.transaction, undefined);
  }
}

class FakeIndex {
  constructor(
    private readonly definition: FakeStoreDefinition,
    private readonly transaction: FakeTransaction
  ) {}

  getAll(range: FakeKeyRange) {
    return makeRequest(
      this.transaction,
      [...this.definition.records.values()].filter(
        (record) => getProperty(record, "sessionId") === range.value
      )
    );
  }

  getAllKeys(range: FakeKeyRange) {
    const keys = [...this.definition.records.values()]
      .filter((record) => getProperty(record, "sessionId") === range.value)
      .map((record) => getRecordKey(this.definition.keyPath, record));

    return makeRequest(this.transaction, keys);
  }
}

function makeRequest<T>(transaction: FakeTransaction, result: T) {
  const request = {} as IDBRequest<T>;

  queueMicrotask(() => {
    Object.defineProperty(request, "result", {
      configurable: true,
      value: result
    });
    request.onsuccess?.(new Event("success"));
    transaction.scheduleComplete();
  });

  return request;
}

function getProperty(record: unknown, key: string) {
  return (record as Record<string, unknown>)[key];
}

function getRecordKey(keyPath: string | string[], value: unknown) {
  if (Array.isArray(keyPath)) {
    return keyPath.map((key) => getProperty(value, key)) as IDBValidKey[];
  }

  return getProperty(value, keyPath) as IDBValidKey;
}

function encodeKey(key: IDBValidKey) {
  return JSON.stringify(key);
}

async function loadLiveRecordingArchiveModule() {
  return (await import("./live-recording-archive")) as LiveRecordingArchiveModule;
}

describe("live recording archive", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new FakeIndexedDb());
    vi.stubGlobal("IDBKeyRange", {
      only: (value: IDBValidKey) => ({ value })
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finalizes contiguous chunks into the original audio blob", async () => {
    const archive = await loadLiveRecordingArchiveModule();

    await archive.prepareLiveRecordingArchive("session_1", "audio/webm");
    await archive.appendLiveRecordingChunk("session_1", 0, new Blob(["aa"]));
    await archive.appendLiveRecordingChunk("session_1", 1, new Blob(["bb"]));

    const blob = await archive.finalizeLiveRecordingArchive("session_1");

    expect(blob).not.toBeNull();
    expect(blob?.type).toBe("audio/webm");
    await expect(blob?.text()).resolves.toBe("aabb");
  });

  it("orders out-of-order chunks by sequence before finalizing", async () => {
    const archive = await loadLiveRecordingArchiveModule();

    await archive.prepareLiveRecordingArchive("session_1", "audio/webm");
    await archive.appendLiveRecordingChunk("session_1", 1, new Blob(["bb"]));
    await archive.appendLiveRecordingChunk("session_1", 0, new Blob(["aa"]));

    const blob = await archive.finalizeLiveRecordingArchive("session_1");

    expect(blob).not.toBeNull();
    await expect(blob?.text()).resolves.toBe("aabb");
  });

  it("does not finalize when chunk sequences are missing", async () => {
    const archive = await loadLiveRecordingArchiveModule();

    await archive.prepareLiveRecordingArchive("session_1", "audio/webm");
    await archive.appendLiveRecordingChunk("session_1", 0, new Blob(["aa"]));
    await archive.appendLiveRecordingChunk("session_1", 2, new Blob(["cc"]));

    await expect(archive.finalizeLiveRecordingArchive("session_1")).resolves.toBeNull();
  });

  it("rejects duplicate chunk sequence writes instead of overwriting audio", async () => {
    const archive = await loadLiveRecordingArchiveModule();

    await archive.prepareLiveRecordingArchive("session_1", "audio/webm");
    await archive.appendLiveRecordingChunk("session_1", 0, new Blob(["aa"]));

    await expect(
      archive.appendLiveRecordingChunk("session_1", 0, new Blob(["zz"]))
    ).rejects.toThrow();

    const blob = await archive.finalizeLiveRecordingArchive("session_1");

    await expect(blob?.text()).resolves.toBe("aa");
  });

  it("lists recoverable archive sessions with chunk counts", async () => {
    const archive = await loadLiveRecordingArchiveModule();

    expect(archive.listRecoverableLiveRecordingArchives).toBeTypeOf("function");

    await archive.prepareLiveRecordingArchive("session_1", "audio/webm");
    await archive.appendLiveRecordingChunk("session_1", 0, new Blob(["aa"]));
    await archive.appendLiveRecordingChunk("session_1", 1, new Blob(["bb"]));
    await archive.prepareLiveRecordingArchive("session_empty", "audio/webm");
    await archive.prepareLiveRecordingArchive("session_gap", "audio/webm");
    await archive.appendLiveRecordingChunk("session_gap", 1, new Blob(["bb"]));

    await expect(archive.listRecoverableLiveRecordingArchives?.()).resolves.toEqual([
      expect.objectContaining({
        sessionId: "session_1",
        mimeType: "audio/webm",
        chunkCount: 2,
        lastSequence: 1,
        isComplete: true
      }),
      expect.objectContaining({
        sessionId: "session_gap",
        mimeType: "audio/webm",
        chunkCount: 1,
        lastSequence: 1,
        isComplete: false
      })
    ]);
  });

  it("removes discarded archive sessions and chunks", async () => {
    const archive = await loadLiveRecordingArchiveModule();

    await archive.prepareLiveRecordingArchive("session_1", "audio/webm");
    await archive.appendLiveRecordingChunk("session_1", 0, new Blob(["aa"]));
    await archive.discardLiveRecordingArchive("session_1");

    await expect(archive.finalizeLiveRecordingArchive("session_1")).resolves.toBeNull();
    await expect(archive.listRecoverableLiveRecordingArchives?.()).resolves.toEqual([]);
  });
});
