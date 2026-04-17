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
    transaction.objectStore(chunkStoreName).put({
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

    const orderedChunks = [...chunkRecords]
      .sort((left, right) => left.sequence - right.sequence)
      .map((record) => record.chunk);
    const blob = new Blob(orderedChunks, { type: sessionRecord.mimeType });

    const cleanupTransaction = database.transaction(
      [sessionStoreName, chunkStoreName],
      "readwrite"
    );
    cleanupTransaction.objectStore(sessionStoreName).delete(sessionId);
    const cleanupIndex = cleanupTransaction.objectStore(chunkStoreName).index("bySessionId");
    const cleanupKeys = await requestValue(
      cleanupIndex.getAllKeys(IDBKeyRange.only(sessionId))
    );

    for (const key of cleanupKeys) {
      cleanupTransaction.objectStore(chunkStoreName).delete(key);
    }

    await waitForTransaction(cleanupTransaction);

    return blob;
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
