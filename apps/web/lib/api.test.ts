import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deletePortalSession,
  getSessionSourceAudioHref,
  processPortalSession,
  updatePortalSessionTitle,
  uploadPortalSourceAudio
} from "./api";

describe("source audio download hrefs", () => {
  it("can request an mp3 download without changing the preview URL", () => {
    expect(getSessionSourceAudioHref("session_1")).toBe(
      "http://127.0.0.1:4100/v1/sessions/session_1/source-audio"
    );
    expect(getSessionSourceAudioHref("session_1", { format: "mp3" })).toBe(
      "http://127.0.0.1:4100/v1/sessions/session_1/source-audio?format=mp3"
    );
  });
});

describe("processPortalSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the long async processing window for final recordings", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            session: {
              id: "session_1",
              title: "긴 녹음",
              mode: "meeting",
              status: "transcribing",
              startedAt: "2026-05-12T00:00:00.000Z",
              participants: [],
              languageHints: ["ko"],
              localAudioPath: "source-audio.mp3",
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
          }
        }),
        {
          status: 202,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    await processPortalSession({
      sessionId: "session_1",
      fileId: "11111111-1111-4111-8111-111111111111",
      wait: true
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      fileId: "11111111-1111-4111-8111-111111111111",
      wait: true,
      timeoutMs: 600_000
    });
  });
});

describe("uploadPortalSourceAudio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uploads raw blobs first for mobile browsers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              sessionId: "session_1",
              fileId: "11111111-1111-4111-8111-111111111111",
              fileName: "safari.m4a",
              byteLength: 1024,
              sha256: "deadbeef",
              createdAt: "2026-05-09T14:40:00.000Z"
            }
          }),
          {
            status: 201,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const upload = await uploadPortalSourceAudio({
      sessionId: "session_1",
      file: new Blob(["audio"], { type: "audio/mp4" }),
      fileName: "safari.m4a"
    });

    expect(upload.fileId).toBe("11111111-1111-4111-8111-111111111111");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/uploads/source-audio/raw?sessionId=session_1&fileName=safari.m4a"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: expect.any(Blob),
      headers: {
        "content-type": "audio/mp4"
      }
    });
  });

  it("falls back to multipart when raw upload fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              sessionId: "session_1",
              fileId: "11111111-1111-4111-8111-111111111111",
              fileName: "safari.m4a",
              byteLength: 1024,
              sha256: "deadbeef",
              createdAt: "2026-05-09T14:40:00.000Z"
            }
          }),
          {
            status: 201,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    await uploadPortalSourceAudio({
      sessionId: "session_1",
      file: new Blob(["audio"], { type: "audio/mp4" }),
      fileName: "safari.m4a"
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/uploads/source-audio/raw?sessionId=session_1&fileName=safari.m4a"
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/v1/uploads/source-audio"
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: expect.any(FormData)
    });
  });

  it("uses base64 JSON first on iOS Safari because binary uploads can hang before reaching the API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              sessionId: "session_1",
              fileId: "11111111-1111-4111-8111-111111111111",
              fileName: "safari.m4a",
              byteLength: 5,
              sha256: "deadbeef",
              createdAt: "2026-05-09T14:40:00.000Z"
            }
          }),
          {
            status: 201,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5
    });

    await uploadPortalSourceAudio({
      sessionId: "session_1",
      file: new Blob(["audio"], { type: "audio/mp4" }),
      fileName: "safari.m4a"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/uploads/source-audio/base64"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json"
      }
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      sessionId: "session_1",
      fileName: "safari.m4a",
      contentType: "audio/mp4",
      audioBase64: "YXVkaW8="
    });
  });

  it("uses binary upload instead of base64 for large iOS recordings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              sessionId: "session_1",
              fileId: "11111111-1111-4111-8111-111111111111",
              fileName: "long-safari.m4a",
              byteLength: 68_157_440,
              sha256: "deadbeef",
              createdAt: "2026-05-09T14:40:00.000Z"
            }
          }),
          {
            status: 201,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );
    const largeBlob = new Blob(["audio"], { type: "audio/mp4" });
    Object.defineProperty(largeBlob, "size", { value: 65 * 1024 * 1024 });
    const arrayBuffer = vi
      .spyOn(largeBlob, "arrayBuffer")
      .mockRejectedValue(new Error("large recording should not be buffered"));

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5
    });

    await uploadPortalSourceAudio({
      sessionId: "session_1",
      file: largeBlob,
      fileName: "long-safari.m4a"
    });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/uploads/source-audio/raw?sessionId=session_1&fileName=long-safari.m4a"
    );
  });

  it("uses a long enough binary upload window for 30 minute recordings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              sessionId: "session_1",
              fileId: "11111111-1111-4111-8111-111111111111",
              fileName: "long-meeting.webm",
              byteLength: 180 * 1024 * 1024,
              sha256: "deadbeef",
              createdAt: "2026-05-09T14:40:00.000Z"
            }
          }),
          {
            status: 201,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const longRecordingBlob = new Blob(["audio"], { type: "audio/webm" });
    Object.defineProperty(longRecordingBlob, "size", {
      value: 180 * 1024 * 1024
    });

    vi.stubGlobal("fetch", fetchMock);

    await uploadPortalSourceAudio({
      sessionId: "session_1",
      file: longRecordingBlob,
      fileName: "long-meeting.webm"
    });

    const uploadTimeoutMs = timeoutSpy.mock.calls.find(
      (call) => typeof call[1] === "number"
    )?.[1];

    expect(uploadTimeoutMs).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });

  it("falls back to base64 when both binary upload modes fail", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("raw failed"))
      .mockRejectedValueOnce(new TypeError("multipart failed"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              sessionId: "session_1",
              fileId: "11111111-1111-4111-8111-111111111111",
              fileName: "safari.m4a",
              byteLength: 5,
              sha256: "deadbeef",
              createdAt: "2026-05-09T14:40:00.000Z"
            }
          }),
          {
            status: 201,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    await uploadPortalSourceAudio({
      sessionId: "session_1",
      file: new Blob(["audio"], { type: "audio/mp4" }),
      fileName: "safari.m4a"
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "/v1/uploads/source-audio/base64"
    );
  });

  it("does not use base64 fallback for large recordings after binary modes fail", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("raw failed"))
      .mockRejectedValueOnce(new TypeError("multipart failed"));
    const largeBlob = new Blob(["audio"], { type: "audio/mp4" });
    Object.defineProperty(largeBlob, "size", { value: 65 * 1024 * 1024 });
    const arrayBuffer = vi
      .spyOn(largeBlob, "arrayBuffer")
      .mockRejectedValue(new Error("large recording should not be buffered"));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadPortalSourceAudio({
        sessionId: "session_1",
        file: largeBlob,
        fileName: "long-recording.m4a"
      })
    ).rejects.toThrow("base64");

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("session record mutations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats delete 404 as already removed", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Session not found" }), {
        status: 404,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(deletePortalSession("session_gone")).resolves.toBeUndefined();
  });

  it("patches a saved session title", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: "session_1",
            title: "새 제목",
            mode: "meeting",
            status: "completed",
            startedAt: "2026-05-12T00:00:00.000Z",
            updatedAt: "2026-05-12T00:00:00.000Z",
            pendingChunkCount: 0,
            artifacts: []
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await updatePortalSessionTitle({
      sessionId: "session_1",
      title: "새 제목"
    });

    expect(snapshot.session.title).toBe("새 제목");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4100/v1/sessions/session_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "새 제목" })
      })
    );
  });
});
