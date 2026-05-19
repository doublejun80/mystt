import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionSnapshotRecord } from "./api";

async function loadFinalizePortalRecordingModule() {
  try {
    return await import("./finalize-portal-recording");
  } catch {
    return null;
  }
}

describe("finalizePortalRecording", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uploads raw audio and then processes the session through Soniox async", async () => {
    const mod = await loadFinalizePortalRecordingModule();

    expect(mod).not.toBeNull();
    expect(mod).toHaveProperty("finalizePortalRecording");

    const uploadPortalSourceAudio = vi.fn().mockResolvedValue({
      fileId: "11111111-1111-4111-8111-111111111111",
      sessionId: "session_1",
      location: "minio://audio/session_1/meeting.m4a",
      fileName: "meeting.m4a",
      byteLength: 5,
      sha256: "6ed8919ce20490a5e3ad8630a4fab69475297abd07db73918dd5f36fcfaeb11b",
      createdAt: "2026-04-17T09:00:00.000Z"
    });
    const processPortalSession = vi.fn().mockResolvedValue({
      session: {
        id: "session_1",
        title: "Demo session",
        mode: "meeting",
        status: "completed",
        startedAt: "2026-04-17T09:00:00.000Z",
        participants: [],
        languageHints: ["ko"],
        localAudioPath: "recordings/session_1/source-session_1.m4a",
        profile: {
          chunkMinutes: 10,
          uploadStrategy: "rolling-chunks",
          backgroundSurvivalCritical: true,
          allowForegroundRealtime: true,
          minimumBatteryPercentToStream: 25
        },
        realtimePolicy: "foreground-only",
        pendingChunkCount: 0,
        artifacts: []
      },
      notes: {
        model: "gpt-test",
        createdAt: "2026-04-17T09:01:00.000Z",
        notes: {
          mode: "meeting",
          title: "Demo session",
          summary: "done",
          decisions: [],
          actionItems: [],
          risks: [],
          openQuestions: [],
          nextAgenda: [],
          speakerHighlights: []
        }
      }
    } satisfies SessionSnapshotRecord);
    const onSourceAudioUploaded = vi.fn();

    const snapshot = await mod!.finalizePortalRecording({
      sessionId: "session_1",
      file: new Blob(["audio"]),
      fileName: "meeting.m4a",
      wait: true,
      onSourceAudioUploaded,
      uploadPortalSourceAudio,
      processPortalSession
    });

    expect(uploadPortalSourceAudio).toHaveBeenCalledOnce();
    expect(uploadPortalSourceAudio).toHaveBeenCalledWith({
      sessionId: "session_1",
      file: expect.any(Blob),
      fileName: "meeting.m4a"
    });
    expect(processPortalSession).toHaveBeenCalledWith({
      sessionId: "session_1",
      fileId: "11111111-1111-4111-8111-111111111111",
      wait: true,
      timeoutMs: 600_000
    });
    expect(onSourceAudioUploaded).toHaveBeenCalledOnce();
    expect(onSourceAudioUploaded).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "11111111-1111-4111-8111-111111111111",
        sha256: "6ed8919ce20490a5e3ad8630a4fab69475297abd07db73918dd5f36fcfaeb11b"
      })
    );
    expect(snapshot.session.status).toBe("completed");
  });

  it("stops before processing when uploaded audio hash does not match", async () => {
    const mod = await loadFinalizePortalRecordingModule();
    const uploadPortalSourceAudio = vi.fn().mockResolvedValue({
      fileId: "11111111-1111-4111-8111-111111111111",
      sessionId: "session_1",
      location: "minio://audio/session_1/meeting.m4a",
      fileName: "meeting.m4a",
      byteLength: 5,
      sha256: "bad",
      createdAt: "2026-04-17T09:00:00.000Z"
    });
    const processPortalSession = vi.fn();
    const onSourceAudioUploaded = vi.fn();

    await expect(
      mod!.finalizePortalRecording({
        sessionId: "session_1",
        file: new Blob(["audio"]),
        fileName: "meeting.m4a",
        onSourceAudioUploaded,
        uploadPortalSourceAudio,
        processPortalSession
      })
    ).rejects.toThrow("해시 검증");
    expect(processPortalSession).not.toHaveBeenCalled();
    expect(onSourceAudioUploaded).not.toHaveBeenCalled();
  });

  it("fails closed before upload when source audio hashing is unavailable", async () => {
    const mod = await loadFinalizePortalRecordingModule();
    const uploadPortalSourceAudio = vi.fn();
    const processPortalSession = vi.fn();
    const onSourceAudioUploaded = vi.fn();

    vi.stubGlobal("crypto", {});

    await expect(
      mod!.finalizePortalRecording({
        sessionId: "session_1",
        file: new Blob(["audio"]),
        fileName: "meeting.m4a",
        onSourceAudioUploaded,
        uploadPortalSourceAudio,
        processPortalSession
      })
    ).rejects.toThrow("해시 계산");
    expect(uploadPortalSourceAudio).not.toHaveBeenCalled();
    expect(processPortalSession).not.toHaveBeenCalled();
    expect(onSourceAudioUploaded).not.toHaveBeenCalled();
  });

  it("warns when local source audio hashing still requires a whole blob read", async () => {
    const mod = await loadFinalizePortalRecordingModule();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const arrayBuffer = vi
      .fn()
      .mockResolvedValue(new TextEncoder().encode("audio").buffer);
    const largeByteLength = 65 * 1024 * 1024;
    const largeAudio = {
      size: largeByteLength,
      type: "audio/mp4",
      arrayBuffer
    } as unknown as Blob;
    const uploadPortalSourceAudio = vi.fn().mockResolvedValue({
      fileId: "11111111-1111-4111-8111-111111111111",
      sessionId: "session_1",
      location: "minio://audio/session_1/meeting.m4a",
      fileName: "meeting.m4a",
      byteLength: largeByteLength,
      sha256: "6ed8919ce20490a5e3ad8630a4fab69475297abd07db73918dd5f36fcfaeb11b",
      createdAt: "2026-04-17T09:00:00.000Z"
    });
    const processPortalSession = vi.fn().mockResolvedValue({
      session: {
        id: "session_1",
        title: "Demo session",
        mode: "meeting",
        status: "transcribing",
        startedAt: "2026-04-17T09:00:00.000Z",
        participants: [],
        languageHints: ["ko"],
        localAudioPath: "recordings/session_1/source-session_1.m4a",
        profile: {
          chunkMinutes: 10,
          uploadStrategy: "rolling-chunks",
          backgroundSurvivalCritical: true,
          allowForegroundRealtime: true,
          minimumBatteryPercentToStream: 25
        },
        realtimePolicy: "foreground-only",
        pendingChunkCount: 0,
        artifacts: []
      }
    } satisfies SessionSnapshotRecord);

    await mod!.finalizePortalRecording({
      sessionId: "session_1",
      file: largeAudio,
      fileName: "meeting.m4a",
      uploadPortalSourceAudio,
      processPortalSession
    });

    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(consoleWarn).toHaveBeenCalledWith(
      "[mystt] source_audio.client_sha_whole_blob_memory_risk",
      expect.objectContaining({
        byteLength: largeByteLength,
        mitigation: "streaming_sha256_required"
      })
    );
  });

  it("fails closed when the upload response omits sha256 after local hashing", async () => {
    const mod = await loadFinalizePortalRecordingModule();
    const uploadPortalSourceAudio = vi.fn().mockResolvedValue({
      fileId: "11111111-1111-4111-8111-111111111111",
      sessionId: "session_1",
      location: "minio://audio/session_1/meeting.m4a",
      fileName: "meeting.m4a",
      byteLength: 5,
      createdAt: "2026-04-17T09:00:00.000Z"
    });
    const processPortalSession = vi.fn();
    const onSourceAudioUploaded = vi.fn();

    await expect(
      mod!.finalizePortalRecording({
        sessionId: "session_1",
        file: new Blob(["audio"]),
        fileName: "meeting.m4a",
        onSourceAudioUploaded,
        uploadPortalSourceAudio,
        processPortalSession
      })
    ).rejects.toThrow("해시 응답");
    expect(processPortalSession).not.toHaveBeenCalled();
    expect(onSourceAudioUploaded).not.toHaveBeenCalled();
  });

  it("fails before processing when uploaded audio byte length does not match the input file", async () => {
    const mod = await loadFinalizePortalRecordingModule();
    const uploadPortalSourceAudio = vi.fn().mockResolvedValue({
      fileId: "11111111-1111-4111-8111-111111111111",
      sessionId: "session_1",
      location: "minio://audio/session_1/meeting.m4a",
      fileName: "meeting.m4a",
      byteLength: 4,
      sha256: "6ed8919ce20490a5e3ad8630a4fab69475297abd07db73918dd5f36fcfaeb11b",
      createdAt: "2026-04-17T09:00:00.000Z"
    });
    const processPortalSession = vi.fn();
    const onSourceAudioUploaded = vi.fn();

    await expect(
      mod!.finalizePortalRecording({
        sessionId: "session_1",
        file: new Blob(["audio"]),
        fileName: "meeting.m4a",
        onSourceAudioUploaded,
        uploadPortalSourceAudio,
        processPortalSession
      })
    ).rejects.toThrow("크기 검증");
    expect(processPortalSession).not.toHaveBeenCalled();
    expect(onSourceAudioUploaded).not.toHaveBeenCalled();
  });

  it("surfaces process failures after verified upload callbacks run", async () => {
    const mod = await loadFinalizePortalRecordingModule();
    const uploadPortalSourceAudio = vi.fn().mockResolvedValue({
      fileId: "11111111-1111-4111-8111-111111111111",
      sessionId: "session_1",
      location: "minio://audio/session_1/meeting.m4a",
      fileName: "meeting.m4a",
      byteLength: 5,
      sha256: "6ed8919ce20490a5e3ad8630a4fab69475297abd07db73918dd5f36fcfaeb11b",
      createdAt: "2026-04-17T09:00:00.000Z"
    });
    const events: string[] = [];
    const onSourceAudioUploaded = vi.fn(() => {
      events.push("uploaded");
    });
    const processPortalSession = vi.fn().mockImplementation(() => {
      events.push("process");
      throw new Error("process failed");
    });

    await expect(
      mod!.finalizePortalRecording({
        sessionId: "session_1",
        file: new Blob(["audio"]),
        fileName: "meeting.m4a",
        onSourceAudioUploaded,
        uploadPortalSourceAudio,
        processPortalSession
      })
    ).rejects.toThrow("process failed");
    expect(onSourceAudioUploaded).toHaveBeenCalledOnce();
    expect(processPortalSession).toHaveBeenCalledOnce();
    expect(events).toEqual(["uploaded", "process"]);
  });
});
