import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistedApiState } from "./persistence";

const persistenceMocks = vi.hoisted(() => ({
  deletePersistedSessionFiles: vi.fn(),
  deletePersistedSessionState: vi.fn(),
  loadPersistedApiState: vi.fn(),
  persistApiState: vi.fn(),
  writeSessionSourceAudioFromFile: vi.fn()
}));

vi.mock("./persistence", async () => {
  const actual = await vi.importActual<typeof import("./persistence")>("./persistence");

  return {
    ...actual,
    deletePersistedSessionFiles: persistenceMocks.deletePersistedSessionFiles,
    deletePersistedSessionState: persistenceMocks.deletePersistedSessionState,
    loadPersistedApiState: persistenceMocks.loadPersistedApiState,
    persistApiState: persistenceMocks.persistApiState,
    writeSessionSourceAudioFromFile: persistenceMocks.writeSessionSourceAudioFromFile
  };
});

import {
  applySonioxWebhook,
  createSession,
  deleteSession,
  findReusableSourceAudioUpload,
  getSessionIdByTranscriptionId,
  getSessionSnapshot,
  listAuditEvents,
  refreshStore,
  recordSourceAudioUpload,
  commitVerifiedSourceAudio,
  getStoredTranscription,
  saveTranscriptionMetadata,
  updateSessionTitle,
  writeSourceAudioCandidateFromFile
} from "./store";

function buildEmptyState(): PersistedApiState {
  return {
    sessions: [],
    webhookFingerprints: [],
    sessionByTranscriptionId: {},
    transcriptionBySessionId: {},
    sourceAudioUploadsBySessionId: {},
    normalizedTranscripts: {},
    rawTranscriptText: {},
    notesBySessionId: {},
    providerChecks: {},
    auditEvents: []
  };
}

describe("saveTranscriptionMetadata", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    persistenceMocks.deletePersistedSessionFiles.mockResolvedValue(undefined);
    persistenceMocks.deletePersistedSessionState.mockResolvedValue(undefined);
    persistenceMocks.loadPersistedApiState.mockImplementation(async () => buildEmptyState());
    persistenceMocks.persistApiState.mockResolvedValue(undefined);
    persistenceMocks.writeSessionSourceAudioFromFile.mockResolvedValue(
      "/tmp/sess/source-deadbeef-source-audio.m4a"
    );
    await refreshStore();
  });

  it("clears cleanupLastError when a later update explicitly sets it undefined", async () => {
    const session = await createSession({
      title: "Cleanup Retry",
      mode: "meeting"
    });
    const transcriptionId = "11111111-1111-4111-8111-111111111111";

    await saveTranscriptionMetadata(session.id, {
      transcriptionId,
      status: "error",
      createdAt: "2026-04-17T09:00:00.000Z",
      cleanupStatus: "failed",
      cleanupLastError: "delete failed"
    });

    await saveTranscriptionMetadata(session.id, {
      transcriptionId,
      status: "error",
      createdAt: "2026-04-17T09:00:00.000Z",
      cleanupStatus: "completed",
      cleanupCompletedAt: "2026-04-17T09:30:00.000Z",
      cleanupLastError: undefined
    });

    expect(getSessionSnapshot(session.id)?.transcription?.cleanupLastError).toBeUndefined();
    expect(getSessionSnapshot(session.id)?.transcription?.cleanupStatus).toBe("completed");
    expect(getSessionSnapshot(session.id)?.transcription?.cleanupCompletedAt).toBe(
      "2026-04-17T09:30:00.000Z"
    );

    const persistedState = persistenceMocks.persistApiState.mock.calls.at(-1)?.[0] as
      | PersistedApiState
      | undefined;
    expect(
      persistedState?.transcriptionBySessionId[session.id]?.cleanupLastError
    ).toBeUndefined();
    expect(
      persistedState?.transcriptionBySessionId[session.id]?.cleanupCompletedAt
    ).toBe("2026-04-17T09:30:00.000Z");

    persistenceMocks.loadPersistedApiState.mockImplementation(async () => persistedState ?? buildEmptyState());
    await refreshStore();

    expect(getStoredTranscription(session.id)?.cleanupLastError).toBeUndefined();
    expect(getStoredTranscription(session.id)?.cleanupCompletedAt).toBe(
      "2026-04-17T09:30:00.000Z"
    );
  });

  it("deletes from local fallback state but keeps audio files when remote state deletion fails", async () => {
    const session = await createSession({
      title: "Delete Ordering",
      mode: "meeting"
    });
    const failure = new Error("postgres unavailable");
    persistenceMocks.deletePersistedSessionState.mockRejectedValueOnce(failure);
    persistenceMocks.persistApiState.mockClear();

    await expect(deleteSession(session.id)).resolves.toBe(true);

    expect(persistenceMocks.persistApiState).toHaveBeenCalled();
    expect(persistenceMocks.deletePersistedSessionFiles).not.toHaveBeenCalled();
    expect(getSessionSnapshot(session.id)).toBeUndefined();
  });

  it("cleans persisted audio files only after session deletion is persisted", async () => {
    const session = await createSession({
      title: "Delete Files After State",
      mode: "meeting"
    });
    persistenceMocks.persistApiState.mockClear();

    await expect(deleteSession(session.id)).resolves.toBe(true);

    expect(persistenceMocks.deletePersistedSessionState).toHaveBeenCalledWith(session.id);
    expect(persistenceMocks.persistApiState).toHaveBeenCalled();
    expect(persistenceMocks.deletePersistedSessionFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id
      })
    );
    const stateDeleteOrder =
      persistenceMocks.deletePersistedSessionState.mock.invocationCallOrder[0];
    const statePersistOrder = persistenceMocks.persistApiState.mock.invocationCallOrder[0];
    const fileDeleteOrder =
      persistenceMocks.deletePersistedSessionFiles.mock.invocationCallOrder[0];

    expect(stateDeleteOrder).toBeDefined();
    expect(statePersistOrder).toBeDefined();
    expect(fileDeleteOrder).toBeDefined();
    expect(stateDeleteOrder as number).toBeLessThan(statePersistOrder as number);
    expect(statePersistOrder as number).toBeLessThan(fileDeleteOrder as number);
    expect(getSessionSnapshot(session.id)).toBeUndefined();
  });

  it("audits saved title updates with previous and next titles", async () => {
    const session = await createSession({
      title: "Untitled quick recording",
      mode: "meeting"
    });

    await updateSessionTitle(session.id, "고객 미팅");

    expect(getSessionSnapshot(session.id)?.session.title).toBe("고객 미팅");
    expect(
      listAuditEvents({ sessionId: session.id }).find(
        (event) => event.kind === "session.title.updated"
      )?.payload
    ).toMatchObject({
      from: "Untitled quick recording",
      to: "고객 미팅",
      title: "고객 미팅"
    });
  });

  it("persists reusable source audio upload ledger entries across refreshes", async () => {
    const session = await createSession({
      title: "Upload Ledger",
      mode: "meeting"
    });

    await recordSourceAudioUpload({
      sessionId: session.id,
      sha256: "deadbeef",
      byteLength: 12,
      sourceLocation: "/tmp/source-audio.m4a",
      sonioxFileId: "soniox-file-id",
      sonioxFileName: "source-audio.m4a",
      uploadedAt: "2026-04-18T01:23:45.000Z",
      contentType: "audio/mp4",
      sourceFileName: "source-audio.m4a"
    });

    expect(
      findReusableSourceAudioUpload({
        sessionId: session.id,
        sha256: "deadbeef",
        byteLength: 12
      })
    ).toMatchObject({
      sonioxFileId: "soniox-file-id",
      sourceLocation: "/tmp/source-audio.m4a"
    });

    const persistedState = persistenceMocks.persistApiState.mock.calls.at(-1)?.[0] as
      | PersistedApiState
      | undefined;
    expect(persistedState?.sourceAudioUploadsBySessionId[session.id]).toEqual([
      expect.objectContaining({
        sha256: "deadbeef",
        byteLength: 12,
        sonioxFileId: "soniox-file-id"
      })
    ]);

    persistenceMocks.loadPersistedApiState.mockImplementation(async () => persistedState ?? buildEmptyState());
    await refreshStore();

    expect(
      findReusableSourceAudioUpload({
        sessionId: session.id,
        sha256: "deadbeef",
        byteLength: 12
      })?.sonioxFileId
    ).toBe("soniox-file-id");
  });

  it("commits localAudioPath only after the persisted source audio is verified", async () => {
    const session = await createSession({
      title: "Verified Source Pointer",
      mode: "meeting"
    });
    persistenceMocks.persistApiState.mockClear();

    const location = await writeSourceAudioCandidateFromFile({
      sessionId: session.id,
      fileName: "source-deadbeef-source-audio.m4a",
      filePath: "/tmp/staged/source-audio.m4a",
      byteLength: 12,
      sha256: "deadbeef",
      contentType: "audio/mp4"
    });

    expect(location).toBe("/tmp/sess/source-deadbeef-source-audio.m4a");
    expect(getSessionSnapshot(session.id)?.session.localAudioPath).toBe("");
    const stagedState = persistenceMocks.persistApiState.mock.calls.at(-1)?.[0] as
      | PersistedApiState
      | undefined;
    expect(
      stagedState?.sessions.find((candidate) => candidate.id === session.id)?.localAudioPath
    ).toBe("");

    await expect(
      commitVerifiedSourceAudio({
        sessionId: session.id,
        location,
        fileName: "source-deadbeef-source-audio.m4a",
        byteLength: 12,
        sha256: "deadbeef",
        contentType: "audio/mp4"
      })
    ).resolves.toBe(location);

    expect(getSessionSnapshot(session.id)?.session.localAudioPath).toBe(location);
    const committedState = persistenceMocks.persistApiState.mock.calls.at(-1)?.[0] as
      | PersistedApiState
      | undefined;
    expect(
      committedState?.sessions.find((candidate) => candidate.id === session.id)?.localAudioPath
    ).toBe(location);
    expect(
      listAuditEvents({ sessionId: session.id }).map((event) => event.kind)
    ).toEqual(expect.arrayContaining(["source_audio.staged", "source_audio.verified"]));
  });

  it("keeps the previous cleanupLastError when a later update does not include the field", async () => {
    const session = await createSession({
      title: "Cleanup Retry",
      mode: "meeting"
    });
    const transcriptionId = "22222222-2222-4222-8222-222222222222";

    await saveTranscriptionMetadata(session.id, {
      transcriptionId,
      status: "error",
      createdAt: "2026-04-17T09:00:00.000Z",
      cleanupStatus: "failed",
      cleanupLastError: "delete failed"
    });

    await saveTranscriptionMetadata(session.id, {
      transcriptionId,
      status: "error",
      createdAt: "2026-04-17T09:00:00.000Z",
      cleanupStatus: "pending"
    });

    expect(getSessionSnapshot(session.id)?.transcription?.cleanupLastError).toBe(
      "delete failed"
    );

    const persistedState = persistenceMocks.persistApiState.mock.calls.at(-1)?.[0] as
      | PersistedApiState
      | undefined;
    expect(
      persistedState?.transcriptionBySessionId[session.id]?.cleanupLastError
    ).toBe("delete failed");
  });

  it("replaces the active transcription and removes the old transcriptionId lookup when reprocessing", async () => {
    const session = await createSession({
      title: "Reprocessing",
      mode: "meeting"
    });
    const oldTranscriptionId = "33333333-3333-4333-8333-333333333333";
    const newTranscriptionId = "44444444-4444-4444-8444-444444444444";

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: oldTranscriptionId,
      status: "completed",
      createdAt: "2026-04-17T08:00:00.000Z",
      filename: "old.m4a",
      audioUrl: "https://example.com/old.m4a",
      fileId: "old-file"
    });

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: newTranscriptionId,
      status: "processing",
      createdAt: "2026-04-17T09:00:00.000Z",
      filename: "new.m4a",
      audioUrl: "https://example.com/new.m4a",
      fileId: "new-file",
      cleanupTargets: ["transcription:new-file"],
      cleanupStatus: "pending",
      cleanupRequestedAt: "2026-04-17T09:01:00.000Z"
    });

    expect(getSessionIdByTranscriptionId(oldTranscriptionId)).toBeUndefined();
    expect(getSessionIdByTranscriptionId(newTranscriptionId)).toBe(session.id);
    expect(getStoredTranscription(session.id)?.transcriptionId).toBe(newTranscriptionId);
    expect(getStoredTranscription(session.id)?.status).toBe("processing");
  });

  it("accepts a newer transcription replacement without requiring the cleanup envelope", async () => {
    const session = await createSession({
      title: "Reprocessing",
      mode: "meeting"
    });
    const oldTranscriptionId = "34343434-3434-4434-8434-343434343434";
    const newTranscriptionId = "45454545-4545-4455-8455-454545454545";

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: oldTranscriptionId,
      status: "error",
      createdAt: "2026-04-17T08:00:00.000Z",
      filename: "old.m4a",
      cleanupStatus: "failed",
      cleanupLastError: "old cleanup failed"
    });

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: newTranscriptionId,
      status: "processing",
      createdAt: "2026-04-17T09:00:00.000Z",
      filename: "new.m4a",
      audioUrl: "https://example.com/new.m4a",
      fileId: "new-file"
    });

    const transcription = getStoredTranscription(session.id);

    expect(transcription?.transcriptionId).toBe(newTranscriptionId);
    expect(transcription?.filename).toBe("new.m4a");
    expect(transcription?.audioUrl).toBe("https://example.com/new.m4a");
    expect(transcription?.cleanupTargets).toEqual([]);
    expect(transcription?.cleanupStatus).toBe("pending");
    expect(transcription?.cleanupRequestedAt).toBeUndefined();
    expect(transcription?.cleanupLastError).toBeUndefined();
    expect(getSessionIdByTranscriptionId(oldTranscriptionId)).toBeUndefined();
    expect(getSessionIdByTranscriptionId(newTranscriptionId)).toBe(session.id);
  });

  it("ignores a stale transcription update from an older transcriptionId after reprocessing", async () => {
    const session = await createSession({
      title: "Reprocessing",
      mode: "meeting"
    });
    const oldTranscriptionId = "55555555-5555-4555-8555-555555555555";
    const newTranscriptionId = "66666666-6666-4666-8666-666666666666";

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: oldTranscriptionId,
      status: "processing",
      createdAt: "2026-04-17T08:00:00.000Z",
      filename: "old.m4a",
      audioUrl: "https://example.com/old.m4a",
      fileId: "old-file"
    });

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: newTranscriptionId,
      status: "completed",
      createdAt: "2026-04-17T09:00:00.000Z",
      filename: "new.m4a",
      audioUrl: "https://example.com/new.m4a",
      fileId: "new-file",
      cleanupTargets: ["transcription:new-file"],
      cleanupStatus: "pending",
      cleanupRequestedAt: "2026-04-17T09:01:00.000Z"
    });

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: oldTranscriptionId,
      status: "completed",
      createdAt: "2026-04-17T08:00:00.000Z",
      filename: "old-completed.m4a",
      audioUrl: "https://example.com/old-completed.m4a",
      fileId: "old-file"
    });

    expect(getSessionIdByTranscriptionId(oldTranscriptionId)).toBeUndefined();
    expect(getSessionSnapshot(session.id)?.transcription?.transcriptionId).toBe(newTranscriptionId);
    expect(getSessionSnapshot(session.id)?.transcription?.filename).toBe("new.m4a");
    expect(getSessionSnapshot(session.id)?.transcription?.status).toBe("completed");

    const persistedState = persistenceMocks.persistApiState.mock.calls.at(-1)?.[0] as
      | PersistedApiState
      | undefined;
    persistenceMocks.loadPersistedApiState.mockImplementation(async () => persistedState ?? buildEmptyState());
    await refreshStore();

    expect(getSessionIdByTranscriptionId(oldTranscriptionId)).toBeUndefined();
    expect(getSessionIdByTranscriptionId(newTranscriptionId)).toBe(session.id);
    expect(getStoredTranscription(session.id)?.transcriptionId).toBe(newTranscriptionId);
    expect(getStoredTranscription(session.id)?.filename).toBe("new.m4a");
  });

  it("does not carry forward cleanupLastError when switching to a new transcriptionId", async () => {
    const session = await createSession({
      title: "Reprocessing",
      mode: "meeting"
    });
    const oldTranscriptionId = "88888888-8888-4888-8888-888888888888";
    const newTranscriptionId = "99999999-9999-4999-8999-999999999999";

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: oldTranscriptionId,
      status: "error",
      createdAt: "2026-04-17T08:00:00.000Z",
      cleanupStatus: "failed",
      cleanupLastError: "old cleanup failed"
    });

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: newTranscriptionId,
      status: "processing",
      createdAt: "2026-04-17T09:00:00.000Z",
      cleanupTargets: ["transcription:new-file"],
      cleanupStatus: "pending",
      cleanupRequestedAt: "2026-04-17T09:01:00.000Z"
    });

    const transcription = getStoredTranscription(session.id);

    expect(transcription?.transcriptionId).toBe(newTranscriptionId);
    expect(getSessionIdByTranscriptionId(oldTranscriptionId)).toBeUndefined();
    expect(transcription?.cleanupStatus).toBe("pending");
    expect(transcription?.cleanupRequestedAt).toBe("2026-04-17T09:01:00.000Z");
    expect(transcription?.cleanupLastError).toBeUndefined();
    expect(transcription?.cleanupCompletedAt).toBeUndefined();
  });

  it("clears cleanupCompletedAt when a later cleanup retry fails after a successful cleanup", async () => {
    const session = await createSession({
      title: "Cleanup Retry",
      mode: "meeting"
    });
    const transcriptionId = "77777777-7777-4777-8777-777777777777";

    await saveTranscriptionMetadata(session.id, {
      transcriptionId,
      status: "completed",
      createdAt: "2026-04-17T09:00:00.000Z",
      cleanupStatus: "completed",
      cleanupCompletedAt: "2026-04-17T09:30:00.000Z",
      cleanupLastError: undefined
    });

    await saveTranscriptionMetadata(session.id, {
      transcriptionId,
      status: "completed",
      createdAt: "2026-04-17T09:00:00.000Z",
      cleanupStatus: "failed",
      cleanupLastError: "delete failed"
    });

    expect(getSessionSnapshot(session.id)?.transcription?.cleanupStatus).toBe("failed");
    expect(getSessionSnapshot(session.id)?.transcription?.cleanupCompletedAt).toBeUndefined();
    expect(getSessionSnapshot(session.id)?.transcription?.cleanupLastError).toBe("delete failed");

    const persistedState = persistenceMocks.persistApiState.mock.calls.at(-1)?.[0] as
      | PersistedApiState
      | undefined;
    expect(
      persistedState?.transcriptionBySessionId[session.id]?.cleanupLastError
    ).toBe("delete failed");
    expect(persistedState?.transcriptionBySessionId[session.id]?.cleanupCompletedAt).toBeUndefined();
  });

  it("dedupes repeated Soniox webhooks by stable event identity instead of deliveredAt", async () => {
    const session = await createSession({
      title: "Webhook Deduplication",
      mode: "meeting"
    });
    const transcriptionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await saveTranscriptionMetadata(session.id, {
      transcriptionId,
      status: "processing",
      createdAt: "2026-04-17T09:00:00.000Z"
    });

    const firstResult = await applySonioxWebhook({
      transcriptionId,
      status: "processing",
      deliveredAt: "2026-04-17T09:01:00.000Z"
    });

    const secondResult = await applySonioxWebhook({
      transcriptionId,
      status: "processing",
      deliveredAt: "2026-04-17T09:02:00.000Z"
    });

    expect(firstResult.duplicate).toBe(false);
    expect(secondResult.duplicate).toBe(true);

    const nonDuplicateTransitions = listAuditEvents({
      sessionId: session.id
    }).filter((event) => event.kind === "soniox.webhook.received");

    expect(nonDuplicateTransitions).toHaveLength(1);
  });
});
