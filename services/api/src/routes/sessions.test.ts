import Fastify, { type FastifyInstance } from "fastify";
import { createSessionRecord } from "@mystt/audio-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSessionSnapshot: vi.fn(),
  getStoredTranscription: vi.fn(),
  listAuditEvents: vi.fn(),
  listSessions: vi.fn(),
  recordAuditEvent: vi.fn(),
  refreshStore: vi.fn(),
  saveTranscriptionMetadata: vi.fn(),
  updateSessionTitle: vi.fn(),
  updateSessionStatus: vi.fn()
}));

const queueMocks = vi.hoisted(() => ({
  enqueueSessionProcessingJob: vi.fn(),
  removeQueuedSessionProcessingJob: vi.fn()
}));

const processMocks = vi.hoisted(() => ({
  processSessionVerticalSlice: vi.fn(),
  waitForTerminalSessionSnapshot: vi.fn()
}));

const sonioxMocks = vi.hoisted(() => ({
  cleanupAsyncTranscriptionResources: vi.fn()
}));

const persistenceMocks = vi.hoisted(() => ({
  readPersistedArtifactBuffer: vi.fn(),
  readPersistedArtifact: vi.fn()
}));

vi.mock("../lib/store", async () => {
  const actual = await vi.importActual<typeof import("../lib/store")>("../lib/store");

  return {
    ...actual,
    createSession: storeMocks.createSession,
    deleteSession: storeMocks.deleteSession,
    getSessionSnapshot: storeMocks.getSessionSnapshot,
    getStoredTranscription: storeMocks.getStoredTranscription,
    listAuditEvents: storeMocks.listAuditEvents,
    listSessions: storeMocks.listSessions,
    recordAuditEvent: storeMocks.recordAuditEvent,
    refreshStore: storeMocks.refreshStore,
    saveTranscriptionMetadata: storeMocks.saveTranscriptionMetadata,
    updateSessionTitle: storeMocks.updateSessionTitle,
    updateSessionStatus: storeMocks.updateSessionStatus
  };
});

vi.mock("../lib/queue", async () => {
  const actual = await vi.importActual<typeof import("../lib/queue")>("../lib/queue");

  return {
    ...actual,
    enqueueSessionProcessingJob: queueMocks.enqueueSessionProcessingJob,
    removeQueuedSessionProcessingJob: queueMocks.removeQueuedSessionProcessingJob
  };
});

vi.mock("../lib/session-process", async () => {
  const actual = await vi.importActual<typeof import("../lib/session-process")>(
    "../lib/session-process"
  );

  return {
    ...actual,
    processSessionVerticalSlice: processMocks.processSessionVerticalSlice,
    waitForTerminalSessionSnapshot: processMocks.waitForTerminalSessionSnapshot
  };
});

vi.mock("../lib/soniox", async () => {
  const actual = await vi.importActual<typeof import("../lib/soniox")>("../lib/soniox");

  return {
    ...actual,
    cleanupAsyncTranscriptionResources: sonioxMocks.cleanupAsyncTranscriptionResources
  };
});

vi.mock("../lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("../lib/persistence")>(
    "../lib/persistence"
  );

  return {
    ...actual,
    readPersistedArtifactBuffer: persistenceMocks.readPersistedArtifactBuffer,
    readPersistedArtifact: persistenceMocks.readPersistedArtifact
  };
});

import { sessionRoutes } from "./sessions";

function buildUnsafeSnapshot(status: "queued" | "transcribing" | "completed" | "failed") {
  return {
    session: {
      ...createSessionRecord({
        id: "sess_process",
        title: "Portal Safe Response",
        mode: "meeting",
        localAudioPath:
          "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_process/source-audio.m4a"
      }),
      status,
      artifacts: [
        {
          kind: "clean_transcript_md" as const,
          status: "ready" as const,
          location: "minio://artifacts/sessions/sess_process/clean_transcript.md"
        }
      ]
    },
    transcriptText: "Transcript stays available",
    notes: {
      model: "gpt-5.4-mini",
      createdAt: "2026-04-18T01:23:45.000Z",
      notes: {
        mode: "meeting" as const,
        title: "Portal Safe Response",
        summary: "Notes stay available",
        decisions: [],
        actionItems: [],
        risks: [],
        openQuestions: [],
        nextAgenda: [],
        speakerHighlights: []
      }
    }
  };
}

function expectPortalSafeSnapshot(payload: unknown) {
  const snapshot = payload as {
    data: {
      notes?: { notes?: { summary?: string } };
      session: {
        artifacts: Array<Record<string, unknown>>;
        localAudioPath: string;
      };
      transcriptText?: string;
    };
  };
  const serialized = JSON.stringify(payload);

  expect(snapshot.data.session.localAudioPath).toBe("source-audio.m4a");
  expect(snapshot.data.session.artifacts[0]).not.toHaveProperty("location");
  expect(snapshot.data.transcriptText).toBe("Transcript stays available");
  expect(snapshot.data.notes?.notes?.summary).toBe("Notes stay available");
  expect(serialized).not.toContain("minio://");
  expect(serialized).not.toContain("/Volumes/mac_dock/");
}

describe("/v1/sessions/:sessionId/process", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetAllMocks();

    storeMocks.refreshStore.mockResolvedValue(undefined);
    storeMocks.recordAuditEvent.mockResolvedValue(undefined);
    persistenceMocks.readPersistedArtifactBuffer.mockResolvedValue(
      Buffer.from("audio")
    );
    persistenceMocks.readPersistedArtifact.mockResolvedValue("artifact");
    storeMocks.updateSessionTitle.mockImplementation(async (_sessionId, title) => ({
      ...buildUnsafeSnapshot("completed").session,
      title
    }));
    storeMocks.updateSessionStatus.mockResolvedValue(buildUnsafeSnapshot("transcribing").session);
    storeMocks.getSessionSnapshot.mockReturnValue(buildUnsafeSnapshot("queued"));
    queueMocks.removeQueuedSessionProcessingJob.mockResolvedValue(false);
    processMocks.waitForTerminalSessionSnapshot.mockResolvedValue({
      timedOut: false,
      snapshot: buildUnsafeSnapshot("completed")
    });
    processMocks.processSessionVerticalSlice.mockResolvedValue({
      accepted: true,
      snapshot: buildUnsafeSnapshot("transcribing")
    });

    app = Fastify();
    await app.register(sessionRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("updates a saved session title", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/sessions/sess_process",
      payload: {
        title: "빠른 녹음 제목 변경"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(storeMocks.updateSessionTitle).toHaveBeenCalledWith(
      "sess_process",
      "빠른 녹음 제목 변경"
    );
    expect(response.json().data.title).toBe("빠른 녹음 제목 변경");
  });

  it("rejects invalid saved session titles with a stable client error", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/sessions/sess_process",
      payload: {
        title: " ".repeat(3)
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: "Title must be 1-140 characters"
    });
    expect(storeMocks.updateSessionTitle).not.toHaveBeenCalled();
  });

  it("rejects overlong saved session titles with a stable client error", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/sessions/sess_process",
      payload: {
        title: "가".repeat(141)
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: "Title must be 1-140 characters"
    });
    expect(storeMocks.updateSessionTitle).not.toHaveBeenCalled();
  });

  it("treats deleting an already-missing session as idempotent", async () => {
    storeMocks.deleteSession.mockResolvedValue(false);

    const response = await app.inject({
      method: "DELETE",
      url: "/v1/sessions/already-gone"
    });

    expect(response.statusCode).toBe(204);
  });

  it("treats repeated Soniox cleanup as already completed", async () => {
    storeMocks.getSessionSnapshot.mockReturnValue(buildUnsafeSnapshot("completed"));
    storeMocks.getStoredTranscription.mockReturnValue({
      transcriptionId: "tx_done",
      status: "completed",
      createdAt: "2026-04-17T09:00:00.000Z",
      fileId: "file_done",
      cleanupStatus: "completed",
      cleanupCompletedAt: "2026-04-17T09:10:00.000Z"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/cleanup/soniox"
    });

    expect(response.statusCode).toBe(200);
    expect(sonioxMocks.cleanupAsyncTranscriptionResources).not.toHaveBeenCalled();
    expect(storeMocks.saveTranscriptionMetadata).not.toHaveBeenCalled();
    expect(response.json().cleanup).toEqual({
      skipped: true,
      reason: "already_completed"
    });
  });

  it("does not expose provider cleanup targets in cleanup responses", async () => {
    storeMocks.getSessionSnapshot.mockReturnValue(buildUnsafeSnapshot("completed"));
    storeMocks.getStoredTranscription.mockReturnValue({
      transcriptionId: "tx_done",
      status: "completed",
      createdAt: "2026-04-17T09:00:00.000Z",
      fileId: "file_done",
      cleanupStatus: "pending"
    });
    sonioxMocks.cleanupAsyncTranscriptionResources.mockResolvedValue({
      cleanupTargets: ["transcriptions/tx_done", "files/file_done"],
      deletedTargets: ["transcriptions/tx_done", "files/file_done"],
      skippedTargets: []
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/cleanup/soniox"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().cleanup).toEqual({
      completed: true
    });
    expect(JSON.stringify(response.json())).not.toContain("tx_done");
    expect(JSON.stringify(response.json())).not.toContain("file_done");
  });

  it("does not expose provider cleanup errors in cleanup responses", async () => {
    storeMocks.getSessionSnapshot.mockReturnValue(buildUnsafeSnapshot("completed"));
    storeMocks.getStoredTranscription.mockReturnValue({
      transcriptionId: "tx_done",
      status: "completed",
      createdAt: "2026-04-17T09:00:00.000Z",
      fileId: "file_done",
      cleanupStatus: "pending"
    });
    sonioxMocks.cleanupAsyncTranscriptionResources.mockRejectedValueOnce(
      new Error("DELETE files/file_done failed at /private/tmp/audio.m4a")
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/cleanup/soniox"
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().message).toBe("Soniox cleanup failed; retry later");
    expect(JSON.stringify(response.json())).not.toContain("file_done");
    expect(JSON.stringify(response.json())).not.toContain("/private/tmp");
    expect(storeMocks.saveTranscriptionMetadata).toHaveBeenCalledWith(
      "sess_process",
      expect.objectContaining({
        cleanupStatus: "failed",
        cleanupLastError: "provider_cleanup_failed"
      })
    );
  });

  it("uses the current session title for source audio download filenames", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/sessions/sess_process/source-audio"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="Portal_Safe_Response.m4a"'
    );
  });

  it("encodes non-ASCII source audio download filenames without crashing", async () => {
    const snapshot = buildUnsafeSnapshot("completed");
    storeMocks.getSessionSnapshot.mockReturnValue({
      ...snapshot,
      session: {
        ...snapshot.session,
        title: "복구 녹음"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/sessions/sess_process/source-audio"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=\"mystt-recording.m4a\"; filename*=UTF-8''%EB%B3%B5%EA%B5%AC_%EB%85%B9%EC%9D%8C.m4a"
    );
  });

  it("sanitizes queued wait=false responses before returning them to the portal", async () => {
    queueMocks.enqueueSessionProcessingJob.mockResolvedValue({
      enqueued: true,
      job: {
        jobId: "job_wait_false"
      },
      depth: 2
    });
    storeMocks.getSessionSnapshot.mockReturnValue(buildUnsafeSnapshot("queued"));

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/process",
      payload: {
        fileId: "11111111-1111-4111-8111-111111111111",
        wait: false
      }
    });

    expect(response.statusCode).toBe(202);

    const payload = response.json();

    expect(payload.queued).toBe(true);
    expectPortalSafeSnapshot(payload);
  });

  it("sanitizes queued waited terminal snapshots", async () => {
    queueMocks.enqueueSessionProcessingJob.mockResolvedValue({
      enqueued: true,
      job: {
        jobId: "job_waited"
      },
      depth: 1
    });
    processMocks.waitForTerminalSessionSnapshot.mockResolvedValue({
      timedOut: false,
      snapshot: buildUnsafeSnapshot("completed")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/process",
      payload: {
        fileId: "11111111-1111-4111-8111-111111111111",
        wait: true
      }
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json();

    expect(payload).toMatchObject({
      queued: true,
      timedOut: false
    });
    expectPortalSafeSnapshot(payload);
  });

  it("sanitizes queued timeout responses", async () => {
    queueMocks.enqueueSessionProcessingJob.mockResolvedValue({
      enqueued: true,
      job: {
        jobId: "job_timeout"
      },
      depth: 3
    });
    processMocks.waitForTerminalSessionSnapshot.mockResolvedValue({
      timedOut: true,
      snapshot: buildUnsafeSnapshot("transcribing")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/process",
      payload: {
        fileId: "11111111-1111-4111-8111-111111111111",
        wait: true
      }
    });

    expect(response.statusCode).toBe(202);

    const payload = response.json();

    expect(payload).toMatchObject({
      queued: true,
      timedOut: true
    });
    expectPortalSafeSnapshot(payload);
  });

  it("audits queued wait timeouts when the job was already claimed and cannot be rescued inline", async () => {
    queueMocks.enqueueSessionProcessingJob.mockResolvedValue({
      enqueued: true,
      job: {
        jobId: "job_claimed_timeout"
      },
      depth: 1
    });
    queueMocks.removeQueuedSessionProcessingJob.mockResolvedValue(false);
    processMocks.waitForTerminalSessionSnapshot.mockResolvedValue({
      timedOut: true,
      snapshot: buildUnsafeSnapshot("transcribing")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/process",
      payload: {
        fileId: "11111111-1111-4111-8111-111111111111",
        wait: true
      }
    });

    expect(response.statusCode).toBe(202);
    expect(processMocks.processSessionVerticalSlice).not.toHaveBeenCalled();
    expect(storeMocks.recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "sess_process",
      kind: "session.process.queue_timeout_still_claimed",
      payload: {
        jobId: "job_claimed_timeout"
      }
    });
    expect(response.json()).toMatchObject({
      queued: true,
      timedOut: true
    });
    expectPortalSafeSnapshot(response.json());
  });

  it("rescues queued wait requests inline when the worker did not claim the job", async () => {
    queueMocks.enqueueSessionProcessingJob.mockResolvedValue({
      enqueued: true,
      job: {
        jobId: "job_timeout_inline"
      },
      depth: 1
    });
    queueMocks.removeQueuedSessionProcessingJob.mockResolvedValue(true);
    processMocks.waitForTerminalSessionSnapshot.mockResolvedValue({
      timedOut: true,
      snapshot: buildUnsafeSnapshot("transcribing")
    });
    processMocks.processSessionVerticalSlice.mockResolvedValue({
      accepted: false,
      snapshot: buildUnsafeSnapshot("completed")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/process",
      payload: {
        fileId: "11111111-1111-4111-8111-111111111111",
        wait: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(processMocks.processSessionVerticalSlice).toHaveBeenCalledWith({
      sessionId: "sess_process",
      fileId: "11111111-1111-4111-8111-111111111111",
      wait: true
    });
    expect(response.json()).toMatchObject({
      queued: true,
      rescuedInline: true
    });
    expectPortalSafeSnapshot(response.json());
  });

  it("sanitizes queued failure snapshots", async () => {
    queueMocks.enqueueSessionProcessingJob.mockResolvedValue({
      enqueued: true,
      job: {
        jobId: "job_failed"
      },
      depth: 1
    });
    processMocks.waitForTerminalSessionSnapshot.mockResolvedValue({
      timedOut: false,
      snapshot: buildUnsafeSnapshot("failed")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/process",
      payload: {
        fileId: "11111111-1111-4111-8111-111111111111",
        wait: true
      }
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json();

    expect(payload).toMatchObject({
      queued: true,
      timedOut: false
    });
    expectPortalSafeSnapshot(payload);
  });

  it("sanitizes inline fallback responses when the queue is unavailable", async () => {
    queueMocks.enqueueSessionProcessingJob.mockResolvedValue({
      enqueued: false
    });
    processMocks.processSessionVerticalSlice.mockResolvedValue({
      accepted: true,
      snapshot: buildUnsafeSnapshot("transcribing")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/process",
      payload: {
        fileId: "11111111-1111-4111-8111-111111111111",
        wait: true
      }
    });

    expect(response.statusCode).toBe(202);
    expectPortalSafeSnapshot(response.json());
  });

  it("sanitizes inline fallback failure responses", async () => {
    queueMocks.enqueueSessionProcessingJob.mockResolvedValue({
      enqueued: false
    });
    processMocks.processSessionVerticalSlice.mockResolvedValue({
      accepted: false,
      snapshot: buildUnsafeSnapshot("failed")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/process",
      payload: {
        fileId: "11111111-1111-4111-8111-111111111111",
        wait: true
      }
    });

    expect(response.statusCode).toBe(200);
    expectPortalSafeSnapshot(response.json());
  });

  it("does not expose internal processing errors to clients", async () => {
    queueMocks.enqueueSessionProcessingJob.mockResolvedValue({
      enqueued: false
    });
    processMocks.processSessionVerticalSlice.mockRejectedValueOnce(
      new Error("Soniox HTTP 500 for file_secret at /Volumes/mac_dock/audio.m4a")
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/process",
      payload: {
        fileId: "11111111-1111-4111-8111-111111111111",
        wait: true
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      message: "Session processing failed; retry later",
      retryable: true
    });
    expect(JSON.stringify(response.json())).not.toContain("file_secret");
    expect(JSON.stringify(response.json())).not.toContain("/Volumes/mac_dock");
  });

  it("marks client-side upload failures as failed instead of leaving sessions recording", async () => {
    const failedSnapshot = buildUnsafeSnapshot("failed");

    storeMocks.getSessionSnapshot.mockReturnValue(buildUnsafeSnapshot("queued"));
    storeMocks.updateSessionStatus.mockResolvedValue(failedSnapshot.session);

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_process/fail",
      payload: {
        reason: "raw upload failed",
        phase: "source_audio_upload"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(storeMocks.recordAuditEvent).toHaveBeenCalledWith({
      sessionId: "sess_process",
      kind: "client.session.failed",
      payload: {
        reason: "raw upload failed",
        phase: "source_audio_upload"
      }
    });
    expect(storeMocks.updateSessionStatus).toHaveBeenCalledWith(
      "sess_process",
      "failed"
    );
    expect(response.json().data.status).toBe("failed");
  });

  it("renders cleaned notes HTML from current notes instead of serving stale persisted content", async () => {
    storeMocks.getSessionSnapshot.mockReturnValue({
      ...buildUnsafeSnapshot("completed"),
      notes: {
        model: "gpt-5.4-mini",
        createdAt: "2026-05-10T00:00:00.000Z",
        notes: {
          mode: "meeting" as const,
          title: "Clean Artifact",
          summary: "null:: 정리된 요약입니다. [evidence: , ]",
          decisions: [],
          actionItems: [],
          risks: [],
          openQuestions: [],
          nextAgenda: [],
          speakerHighlights: []
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/sessions/sess_process/artifacts/meeting_notes_html"
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("정리된 요약입니다.");
    expect(response.body).not.toContain("null::");
    expect(response.body).not.toContain("evidence:");
  });
});
