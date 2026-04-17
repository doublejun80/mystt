import { describe, expect, it, vi } from "vitest";

import type { SessionSnapshotRecord } from "./api";

async function loadFinalizePortalRecordingModule() {
  try {
    return await import("./finalize-portal-recording");
  } catch {
    return null;
  }
}

describe("finalizePortalRecording", () => {
  it("uploads raw audio and then processes the session through Soniox async", async () => {
    const mod = await loadFinalizePortalRecordingModule();

    expect(mod).not.toBeNull();
    expect(mod).toHaveProperty("finalizePortalRecording");

    const uploadPortalSourceAudio = vi.fn().mockResolvedValue({
      fileId: "11111111-1111-4111-8111-111111111111",
      sessionId: "session_1",
      location: "minio://audio/session_1/meeting.m4a",
      fileName: "meeting.m4a",
      byteLength: 1024,
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

    const snapshot = await mod!.finalizePortalRecording({
      sessionId: "session_1",
      file: new Blob(["audio"]),
      fileName: "meeting.m4a",
      wait: true,
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
      wait: true
    });
    expect(snapshot.session.status).toBe("completed");
  });
});
