import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  getAuthFromEnv: vi.fn(),
  handleFastify: vi.fn()
}));

const sonioxMocks = vi.hoisted(() => ({
  cleanupAsyncTranscriptionResources: vi.fn(),
  getAsyncTranscription: vi.fn()
}));

const storeMocks = vi.hoisted(() => ({
  applySonioxWebhook: vi.fn(),
  getSessionIdByTranscriptionId: vi.fn(),
  getStoredTranscription: vi.fn(),
  recordAuditEvent: vi.fn(),
  saveTranscriptionMetadata: vi.fn()
}));

const sessionProcessMocks = vi.hoisted(() => ({
  processSessionVerticalSlice: vi.fn()
}));

vi.mock("../lib/providers", () => ({
  getSonioxClient: () => ({
    webhooks: {
      getAuthFromEnv: providerMocks.getAuthFromEnv,
      handleFastify: providerMocks.handleFastify
    }
  })
}));

vi.mock("../lib/soniox", async () => {
  const actual = await vi.importActual<typeof import("../lib/soniox")>(
    "../lib/soniox"
  );

  return {
    ...actual,
    cleanupAsyncTranscriptionResources: sonioxMocks.cleanupAsyncTranscriptionResources,
    getAsyncTranscription: sonioxMocks.getAsyncTranscription
  };
});

vi.mock("../lib/store", async () => {
  const actual = await vi.importActual<typeof import("../lib/store")>(
    "../lib/store"
  );

  return {
    ...actual,
    applySonioxWebhook: storeMocks.applySonioxWebhook,
    getSessionIdByTranscriptionId: storeMocks.getSessionIdByTranscriptionId,
    getStoredTranscription: storeMocks.getStoredTranscription,
    recordAuditEvent: storeMocks.recordAuditEvent,
    saveTranscriptionMetadata: storeMocks.saveTranscriptionMetadata
  };
});

vi.mock("../lib/session-process", () => ({
  processSessionVerticalSlice: sessionProcessMocks.processSessionVerticalSlice
}));

import { webhookRoutes } from "./webhooks";

describe("Soniox webhook routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetAllMocks();

    providerMocks.getAuthFromEnv.mockReturnValue({});
    providerMocks.handleFastify.mockReturnValue({
      ok: true,
      event: {
        id: "tr_completed",
        status: "completed"
      }
    });
    sonioxMocks.getAsyncTranscription.mockResolvedValue({
      id: "tr_completed",
      status: "completed",
      created_at: "2026-04-17T09:00:00.000Z",
      filename: "meeting.m4a",
      audio_url: "https://example.com/audio.m4a",
      file_id: "file_1",
      client_reference_id: "session_1",
      error_message: null
    });
    sonioxMocks.cleanupAsyncTranscriptionResources.mockResolvedValue({
      cleanupTargets: [],
      deletedTargets: [],
      skippedTargets: []
    });
    storeMocks.applySonioxWebhook.mockResolvedValue({
      duplicate: false,
      session: {
        id: "session_1"
      }
    });
    storeMocks.getSessionIdByTranscriptionId.mockReturnValue("session_1");
    storeMocks.getStoredTranscription.mockReturnValue({
      transcriptionId: "tr_completed",
      status: "completed",
      createdAt: "2026-04-17T09:00:00.000Z",
      filename: "meeting.m4a",
      fileId: "file_1",
      cleanupStatus: "pending"
    });
    storeMocks.recordAuditEvent.mockResolvedValue(undefined);
    storeMocks.saveTranscriptionMetadata.mockResolvedValue(undefined);
    sessionProcessMocks.processSessionVerticalSlice.mockResolvedValue({
      accepted: false,
      snapshot: {
        session: {
          id: "session_1",
          status: "completed"
        }
      }
    });

    app = Fastify();
    await app.register(webhookRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("allows duplicate terminal webhooks to retry finalizer side effects", async () => {
    storeMocks.applySonioxWebhook
      .mockResolvedValueOnce({
        duplicate: false,
        session: {
          id: "session_1"
        }
      })
      .mockResolvedValueOnce({
        duplicate: true,
        session: {
          id: "session_1"
        }
      });

    const firstResponse = await app.inject({
      method: "POST",
      url: "/v1/webhooks/soniox",
      payload: {}
    });
    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/v1/webhooks/soniox",
      payload: {}
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(duplicateResponse.statusCode).toBe(202);
    expect(storeMocks.applySonioxWebhook).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        transcriptionId: "tr_completed",
        sessionId: "session_1",
        fileId: "file_1"
      })
    );
    expect(storeMocks.applySonioxWebhook).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        transcriptionId: "tr_completed",
        sessionId: "session_1",
        fileId: "file_1"
      })
    );
    expect(sonioxMocks.getAsyncTranscription).toHaveBeenCalledTimes(2);
    expect(storeMocks.saveTranscriptionMetadata).toHaveBeenCalledTimes(2);
    expect(sessionProcessMocks.processSessionVerticalSlice).toHaveBeenCalledTimes(2);
    const finalizerRequiredEvents = storeMocks.recordAuditEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event.kind === "soniox.finalizer.required");
    expect(finalizerRequiredEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          attemptReason: "terminal_webhook",
          duplicateWebhook: false,
          idempotencyKey: "soniox:transcription:tr_completed:terminal:completed:finalizer"
        })
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          attemptReason: "duplicate_terminal_webhook_retry",
          duplicateWebhook: true,
          idempotencyKey: "soniox:transcription:tr_completed:terminal:completed:finalizer"
        })
      })
    ]);
  });

  it("records completed webhook finalizer as failed when cleanup remains retryable", async () => {
    sessionProcessMocks.processSessionVerticalSlice.mockResolvedValueOnce({
      accepted: false,
      finalizerSideEffectsFailed: true,
      finalizerSideEffectError: "Soniox cleanup failed: files/file_1: 503",
      snapshot: {
        session: {
          id: "session_1",
          status: "completed"
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/soniox",
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(storeMocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        kind: "soniox.finalizer.failed",
        payload: expect.objectContaining({
          transcriptionId: "tr_completed",
          error: "Soniox cleanup failed: files/file_1: 503",
          retryable: true,
          idempotencyKey: "soniox:transcription:tr_completed:terminal:completed:finalizer"
        })
      })
    );
    expect(
      storeMocks.recordAuditEvent.mock.calls.some(
        ([event]) => event.kind === "soniox.finalizer.completed"
      )
    ).toBe(false);
  });

  it("uses stored transcription metadata to retry duplicate finalizer when provider lookup is gone", async () => {
    sonioxMocks.getAsyncTranscription.mockRejectedValueOnce(
      new Error("Soniox HTTP 404: not found")
    );
    storeMocks.applySonioxWebhook.mockResolvedValueOnce({
      duplicate: true,
      session: {
        id: "session_1"
      }
    });
    storeMocks.getStoredTranscription.mockReturnValueOnce({
      transcriptionId: "tr_completed",
      status: "completed",
      createdAt: "2026-04-17T09:00:00.000Z",
      filename: "meeting.m4a",
      fileId: "file_1",
      cleanupStatus: "failed",
      cleanupLastError: "provider_cleanup_failed"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/soniox",
      payload: {}
    });

    expect(response.statusCode).toBe(202);
    expect(storeMocks.applySonioxWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionId: "tr_completed",
        sessionId: "session_1",
        fileId: "file_1"
      })
    );
    expect(sessionProcessMocks.processSessionVerticalSlice).toHaveBeenCalledWith({
      sessionId: "session_1",
      fileId: "file_1",
      wait: true
    });
    expect(storeMocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        kind: "soniox.webhook.transcription_lookup_failed",
        payload: expect.objectContaining({
          transcriptionId: "tr_completed",
          recoveredFromStoredMetadata: true
        })
      })
    );
  });

  it("cleans up terminal error webhooks without starting a new transcription", async () => {
    providerMocks.handleFastify.mockReturnValue({
      ok: true,
      event: {
        id: "tr_error",
        status: "error"
      }
    });
    sonioxMocks.getAsyncTranscription.mockResolvedValue({
      id: "tr_error",
      status: "error",
      created_at: "2026-04-17T09:00:00.000Z",
      filename: "meeting.m4a",
      audio_url: "https://example.com/audio.m4a",
      file_id: "file_error",
      client_reference_id: "session_1",
      error_message: "provider failed"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/soniox",
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(sessionProcessMocks.processSessionVerticalSlice).not.toHaveBeenCalled();
    expect(sonioxMocks.cleanupAsyncTranscriptionResources).toHaveBeenCalledWith({
      transcriptionId: "tr_error",
      fileId: "file_error"
    });
    expect(storeMocks.saveTranscriptionMetadata).toHaveBeenCalledWith(
      "session_1",
      expect.objectContaining({
        transcriptionId: "tr_error",
        status: "error",
        cleanupStatus: "completed",
        cleanupLastError: undefined
      })
    );
    expect(storeMocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        kind: "soniox.finalizer.completed",
        payload: expect.objectContaining({
          transcriptionId: "tr_error",
          idempotencyKey: "soniox:transcription:tr_error:terminal:error:finalizer",
          duplicateWebhook: false
        })
      })
    );
  });
});
