import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSessionSnapshot: vi.fn(),
  recordAuditEvent: vi.fn(),
  refreshStore: vi.fn(),
  saveNormalizedTranscript: vi.fn(),
  saveSourceAudio: vi.fn(),
  saveStructuredNotes: vi.fn(),
  saveTranscriptionMetadata: vi.fn(),
  updateSessionStatus: vi.fn()
}));

const sonioxMocks = vi.hoisted(() => ({
  cleanupAsyncTranscriptionResources: vi.fn(),
  convertTranscriptToPackageShape: vi.fn(),
  createAsyncTranscriptionJob: vi.fn(),
  getAsyncTranscript: vi.fn(),
  getAsyncTranscription: vi.fn()
}));

vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");

  return {
    ...actual,
    getSession: storeMocks.getSession,
    getSessionSnapshot: storeMocks.getSessionSnapshot,
    recordAuditEvent: storeMocks.recordAuditEvent,
    refreshStore: storeMocks.refreshStore,
    saveNormalizedTranscript: storeMocks.saveNormalizedTranscript,
    saveSourceAudio: storeMocks.saveSourceAudio,
    saveStructuredNotes: storeMocks.saveStructuredNotes,
    saveTranscriptionMetadata: storeMocks.saveTranscriptionMetadata,
    updateSessionStatus: storeMocks.updateSessionStatus
  };
});

vi.mock("./soniox", async () => {
  const actual = await vi.importActual<typeof import("./soniox")>("./soniox");

  return {
    ...actual,
    cleanupAsyncTranscriptionResources: sonioxMocks.cleanupAsyncTranscriptionResources,
    convertTranscriptToPackageShape: sonioxMocks.convertTranscriptToPackageShape,
    createAsyncTranscriptionJob: sonioxMocks.createAsyncTranscriptionJob,
    getAsyncTranscript: sonioxMocks.getAsyncTranscript,
    getAsyncTranscription: sonioxMocks.getAsyncTranscription
  };
});

vi.mock("./openai", () => ({
  generateStructuredNotes: vi.fn()
}));

import { processSessionVerticalSlice } from "./session-process";
import { waitForTerminalSessionSnapshot } from "./session-process";

describe("processSessionVerticalSlice", () => {
  let sessionState: {
    id: string;
    mode: "meeting";
    title: string;
    languageHints: string[];
    projectKey: string;
    status: "uploading" | "failed";
  };

  beforeEach(() => {
    vi.resetAllMocks();

    sessionState = {
      id: "session_1",
      mode: "meeting",
      title: "Weekly Sync",
      languageHints: ["en"],
      projectKey: "project_1",
      status: "uploading"
    };

    storeMocks.getSession.mockImplementation(() => ({
      id: sessionState.id,
      mode: sessionState.mode,
      title: sessionState.title,
      languageHints: sessionState.languageHints,
      projectKey: sessionState.projectKey
    }));
    storeMocks.getSessionSnapshot.mockImplementation(() => ({
      session: {
        id: sessionState.id,
        mode: sessionState.mode,
        title: sessionState.title,
        languageHints: sessionState.languageHints,
        projectKey: sessionState.projectKey,
        status: sessionState.status
      }
    }));
    storeMocks.recordAuditEvent.mockResolvedValue(undefined);
    storeMocks.saveNormalizedTranscript.mockResolvedValue(undefined);
    storeMocks.saveSourceAudio.mockRejectedValue(new Error("disk full"));
    storeMocks.saveStructuredNotes.mockResolvedValue(undefined);
    storeMocks.saveTranscriptionMetadata.mockResolvedValue(undefined);
    storeMocks.updateSessionStatus.mockImplementation(async (_sessionId, status) => {
      sessionState = { ...sessionState, status };
    });
    sonioxMocks.cleanupAsyncTranscriptionResources.mockResolvedValue({
      cleanupTargets: [],
      deletedTargets: [],
      skippedTargets: []
    });
    sonioxMocks.convertTranscriptToPackageShape.mockReturnValue({
      sessionId: "session_1",
      transcriptionId: "transcription_1",
      languageHints: [],
      segments: [],
      tokens: []
    });
    sonioxMocks.createAsyncTranscriptionJob.mockResolvedValue({
      id: "transcription_1",
      status: "queued",
      created_at: "2026-04-17T00:00:00.000Z",
      filename: "meeting.m4a",
      audio_url: "https://example.com/audio.m4a",
      file_id: null,
      client_reference_id: "session_1",
      error_message: null
    });
    sonioxMocks.getAsyncTranscript.mockResolvedValue({
      id: "transcript_1",
      text: "",
      tokens: []
    });
    sonioxMocks.getAsyncTranscription.mockResolvedValue({
      id: "transcription_1",
      status: "completed",
      created_at: "2026-04-17T00:00:00.000Z",
      filename: "meeting.m4a",
      audio_url: "https://example.com/audio.m4a",
      file_id: null,
      client_reference_id: "session_1",
      error_message: null
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "audio/mp4" }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4))
      })
    );
  });

  it("keeps polling when a terminal snapshot is briefly missing", async () => {
    let snapshotCalls = 0;
    storeMocks.getSessionSnapshot.mockImplementation(() => {
      snapshotCalls += 1;

      if (snapshotCalls === 1) {
        return undefined;
      }

      return {
        session: {
          id: "session_1",
          mode: sessionState.mode,
          title: sessionState.title,
          languageHints: sessionState.languageHints,
          projectKey: sessionState.projectKey,
          status: "completed"
        }
      };
    });

    const result = await waitForTerminalSessionSnapshot({
      sessionId: "session_1",
      timeoutMs: 25,
      pollIntervalMs: 0
    });

    expect(storeMocks.refreshStore).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      timedOut: false,
      snapshot: {
        session: expect.objectContaining({
          id: "session_1",
          status: "completed"
        })
      }
    });
  });

  it("returns a failed snapshot when staging fails even if audit persistence fails", async () => {
    storeMocks.recordAuditEvent.mockRejectedValueOnce(new Error("audit down"));

    const result = await processSessionVerticalSlice({
      sessionId: "session_1",
      audioUrl: "https://example.com/audio.m4a",
      wait: false
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith("https://example.com/audio.m4a");
    expect(storeMocks.saveSourceAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        sourceUrl: "https://example.com/audio.m4a"
      })
    );
    expect(storeMocks.updateSessionStatus).toHaveBeenCalledWith("session_1", "failed");
    expect(sonioxMocks.createAsyncTranscriptionJob).not.toHaveBeenCalled();
    expect(result).toEqual({
      accepted: false,
      snapshot: {
        session: expect.objectContaining({
          id: "session_1",
          status: "failed"
        })
      }
    });
  });

  it("returns a failed snapshot when transcription startup job creation fails after staging", async () => {
    storeMocks.saveSourceAudio.mockResolvedValueOnce(undefined);
    sonioxMocks.createAsyncTranscriptionJob.mockRejectedValueOnce(new Error("soniox down"));

    const result = await processSessionVerticalSlice({
      sessionId: "session_1",
      audioUrl: "https://example.com/audio.m4a",
      wait: false
    });

    expect(result).toEqual({
      accepted: false,
      snapshot: {
        session: expect.objectContaining({
          id: "session_1",
          status: "failed"
        })
      }
    });
    expect(storeMocks.updateSessionStatus).toHaveBeenCalledWith("session_1", "failed");
    expect(storeMocks.saveTranscriptionMetadata).not.toHaveBeenCalled();
    expect(storeMocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        kind: "transcription.start_failed",
        payload: expect.objectContaining({
          stage: "create_async_transcription_job",
          error: "soniox down"
        })
      })
    );
  });

  it("cleans up the created transcription when startup metadata persistence fails", async () => {
    storeMocks.saveSourceAudio.mockResolvedValueOnce(undefined);
    storeMocks.saveTranscriptionMetadata.mockRejectedValueOnce(new Error("metadata down"));

    const result = await processSessionVerticalSlice({
      sessionId: "session_1",
      audioUrl: "https://example.com/audio.m4a",
      wait: false
    });

    expect(result).toEqual({
      accepted: false,
      snapshot: {
        session: expect.objectContaining({
          id: "session_1",
          status: "failed"
        })
      }
    });
    expect(sonioxMocks.createAsyncTranscriptionJob).toHaveBeenCalledTimes(1);
    expect(sonioxMocks.cleanupAsyncTranscriptionResources).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionId: "transcription_1"
      })
    );
    expect(storeMocks.updateSessionStatus).toHaveBeenCalledWith("session_1", "failed");
    expect(storeMocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        kind: "transcription.start_failed",
        payload: expect.objectContaining({
          stage: "save_transcription_metadata",
          transcriptionId: "transcription_1",
          error: "metadata down"
        })
      })
    );
  });

  it("keeps polling when a single transcription refresh is missing", async () => {
    storeMocks.saveSourceAudio.mockResolvedValueOnce(undefined);
    sonioxMocks.getAsyncTranscription
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: "transcription_1",
        status: "completed",
        created_at: "2026-04-17T00:00:00.000Z",
        filename: "meeting.m4a",
        audio_url: "https://example.com/audio.m4a",
        file_id: null,
        client_reference_id: "session_1",
        error_message: null
      });

    const result = await processSessionVerticalSlice({
      sessionId: "session_1",
      audioUrl: "https://example.com/audio.m4a",
      pollIntervalMs: 0,
      timeoutMs: 25
    });

    expect(sonioxMocks.getAsyncTranscription).toHaveBeenCalledTimes(2);
    expect(storeMocks.updateSessionStatus).toHaveBeenCalledWith("session_1", "completed");
    expect(result).toEqual({
      accepted: false,
      snapshot: {
        session: expect.objectContaining({
          id: "session_1",
          status: "completed"
        })
      }
    });
  });
});
