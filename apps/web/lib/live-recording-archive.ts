"use client";

const databaseName = "mystt-live-recording";
const databaseVersion = 1;
const sessionStoreName = "sessions";
const chunkStoreName = "chunks";

type ArchiveSessionRecord = {
  sessionId: string;
  mimeType: string;
  createdAt: string;
};

type ArchiveChunkRecord = {
  sessionId: string;
  sequence: number;
  chunk: Blob;
};

export type RecoverableLiveRecordingArchive = {
  sessionId: string;
  mimeType: string;
  createdAt: string;
  chunkCount: number;
  lastSequence: number;
  isComplete: boolean;
};

type ContiguousChunkSequence = {
  orderedRecords: ArchiveChunkRecord[];
  chunkCount: number;
  lastSequence: number;
};

type ChunkSequenceSummary = {
  chunkCount: number;
  lastSequence: number;
  isComplete: boolean;
};

function supportsIndexedDbArchive() {
  return typeof indexedDB !== "undefined";
}

function openDatabase() {
  if (!supportsIndexedDbArchive()) {
    return Promise.resolve<IDBDatabase | null>(null);
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(sessionStoreName)) {
        database.createObjectStore(sessionStoreName, {
          keyPath: "sessionId"
        });
      }

      if (!database.objectStoreNames.contains(chunkStoreName)) {
        const chunkStore = database.createObjectStore(chunkStoreName, {
          keyPath: ["sessionId", "sequence"]
        });
        chunkStore.createIndex("bySessionId", "sessionId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function withDatabase<T>(fn: (database: IDBDatabase) => Promise<T>) {
  const database = await openDatabase();

  if (!database) {
    return null as T;
  }

  try {
    return await fn(database);
  } finally {
    database.close();
  }
}

function getContiguousChunkSequence(
  chunkRecords: ArchiveChunkRecord[]
): ContiguousChunkSequence | null {
  if (chunkRecords.length === 0) {
    return null;
  }

  const orderedRecords = [...chunkRecords].sort(
    (left, right) => left.sequence - right.sequence
  );

  for (let index = 0; index < orderedRecords.length; index += 1) {
    const record = orderedRecords[index];

    if (!record || !Number.isInteger(record.sequence) || record.sequence !== index) {
      return null;
    }
  }

  return {
    orderedRecords,
    chunkCount: orderedRecords.length,
    lastSequence: orderedRecords.length - 1
  };
}

function summarizeChunkSequences(sequences: number[]): ChunkSequenceSummary {
  if (sequences.length === 0) {
    return {
      chunkCount: 0,
      lastSequence: -1,
      isComplete: false
    };
  }

  const ordered = [...sequences].sort((left, right) => left - right);
  const unique = new Set<number>();

  for (let index = 0; index < ordered.length; index += 1) {
    const sequence = ordered[index] ?? -1;
    unique.add(sequence);

    if (!Number.isInteger(sequence) || sequence !== index) {
      return {
        chunkCount: ordered.length,
        lastSequence: ordered[ordered.length - 1] ?? -1,
        isComplete: false
      };
    }
  }

  return {
    chunkCount: ordered.length,
    lastSequence: ordered[ordered.length - 1] ?? -1,
    isComplete: unique.size === ordered.length
  };
}

function getSessionIdAndSequenceFromChunkKey(key: IDBValidKey) {
  if (!Array.isArray(key) || key.length < 2) {
    return null;
  }

  const [sessionId, sequence] = key;

  if (typeof sessionId !== "string" || typeof sequence !== "number") {
    return null;
  }

  return {
    sessionId,
    sequence
  };
}

export async function prepareLiveRecordingArchive(
  sessionId: string,
  mimeType: string
) {
  return withDatabase(async (database) => {
    const transaction = database.transaction([sessionStoreName, chunkStoreName], "readwrite");
    const sessionStore = transaction.objectStore(sessionStoreName);
    const chunkStore = transaction.objectStore(chunkStoreName);
    const index = chunkStore.index("bySessionId");
    const chunkKeys = await requestValue(index.getAllKeys(IDBKeyRange.only(sessionId)));

    for (const key of chunkKeys) {
      chunkStore.delete(key);
    }

    sessionStore.put({
      sessionId,
      mimeType,
      createdAt: new Date().toISOString()
    } satisfies ArchiveSessionRecord);

    await waitForTransaction(transaction);
    return true;
  });
}

export async function appendLiveRecordingChunk(
  sessionId: string,
  sequence: number,
  chunk: Blob
) {
  return withDatabase(async (database) => {
    const transaction = database.transaction(chunkStoreName, "readwrite");
    transaction.objectStore(chunkStoreName).add({
      sessionId,
      sequence,
      chunk
    } satisfies ArchiveChunkRecord);
    await waitForTransaction(transaction);
    return true;
  });
}

export async function setLiveRecordingArchiveMimeType(
  sessionId: string,
  mimeType: string
) {
  return withDatabase(async (database) => {
    const transaction = database.transaction(sessionStoreName, "readwrite");
    const sessionStore = transaction.objectStore(sessionStoreName);
    const existing = await requestValue(
      sessionStore.get(sessionId) as IDBRequest<ArchiveSessionRecord | undefined>
    );

    if (existing) {
      sessionStore.put({
        ...existing,
        mimeType
      } satisfies ArchiveSessionRecord);
    }

    await waitForTransaction(transaction);
    return true;
  });
}

export async function finalizeLiveRecordingArchive(sessionId: string) {
  return withDatabase(async (database) => {
    const readTransaction = database.transaction([sessionStoreName, chunkStoreName], "readonly");
    const sessionStore = readTransaction.objectStore(sessionStoreName);
    const chunkStore = readTransaction.objectStore(chunkStoreName);
    const sessionRecord = await requestValue(
      sessionStore.get(sessionId) as IDBRequest<ArchiveSessionRecord | undefined>
    );
    const chunkIndex = chunkStore.index("bySessionId");
    const chunkRecords = await requestValue(
      chunkIndex.getAll(IDBKeyRange.only(sessionId)) as IDBRequest<ArchiveChunkRecord[]>
    );
    await waitForTransaction(readTransaction);

    if (!sessionRecord || chunkRecords.length === 0) {
      return null;
    }

    const chunkSequence = getContiguousChunkSequence(chunkRecords);

    if (!chunkSequence) {
      return null;
    }

    const orderedChunks = chunkSequence.orderedRecords.map((record) => record.chunk);
    const blob = new Blob(orderedChunks, { type: sessionRecord.mimeType });
    return blob;
  });
}

export async function listRecoverableLiveRecordingArchives() {
  return withDatabase(async (database) => {
    const transaction = database.transaction([sessionStoreName, chunkStoreName], "readonly");
    const sessionStore = transaction.objectStore(sessionStoreName);
    const chunkStore = transaction.objectStore(chunkStoreName);
    const sessionRecordsRequest = sessionStore.getAll() as IDBRequest<
      ArchiveSessionRecord[]
    >;
    const chunkKeysRequest = chunkStore.getAllKeys() as IDBRequest<IDBValidKey[]>;
    const [sessionRecords, chunkRecords] = await Promise.all([
      requestValue(sessionRecordsRequest),
      requestValue(chunkKeysRequest)
    ]);
    await waitForTransaction(transaction);

    const sequencesBySessionId = new Map<string, number[]>();

    for (const key of chunkRecords) {
      const parsed = getSessionIdAndSequenceFromChunkKey(key);

      if (!parsed) {
        continue;
      }

      const existing = sequencesBySessionId.get(parsed.sessionId) ?? [];
      existing.push(parsed.sequence);
      sequencesBySessionId.set(parsed.sessionId, existing);
    }

    return sessionRecords
      .map((sessionRecord) => {
        const chunkSequence = summarizeChunkSequences(
          sequencesBySessionId.get(sessionRecord.sessionId) ?? []
        );

        return {
          sessionId: sessionRecord.sessionId,
          mimeType: sessionRecord.mimeType,
          createdAt: sessionRecord.createdAt,
          chunkCount: chunkSequence.chunkCount,
          lastSequence: chunkSequence.lastSequence,
          isComplete: chunkSequence.isComplete
        } satisfies RecoverableLiveRecordingArchive;
      })
      .filter((session) => session.chunkCount > 0)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  });
}

export async function discardLiveRecordingArchive(sessionId: string) {
  return withDatabase(async (database) => {
    const transaction = database.transaction([sessionStoreName, chunkStoreName], "readwrite");
    transaction.objectStore(sessionStoreName).delete(sessionId);
    const index = transaction.objectStore(chunkStoreName).index("bySessionId");
    const keys = await requestValue(index.getAllKeys(IDBKeyRange.only(sessionId)));

    for (const key of keys) {
      transaction.objectStore(chunkStoreName).delete(key);
    }

    await waitForTransaction(transaction);
    return true;
  });
}
