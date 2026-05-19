import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  clearSourceAudioPath: vi.fn(),
  commitVerifiedSourceAudio: vi.fn(),
  findReusableSourceAudioUpload: vi.fn(),
  getSessionSnapshot: vi.fn(),
  recordAuditEvent: vi.fn(),
  recordSourceAudioUpload: vi.fn(),
  refreshStore: vi.fn(),
  writeSourceAudioCandidateFromFile: vi.fn()
}));

const sourceAudioMocks = vi.hoisted(() => ({
  assertStagedSourceAudioIsAcceptable: vi.fn(),
  decodeAudioBase64: vi.fn(),
  readPersistedSourceAudioIntegrity: vi.fn(),
  verifyPersistedSourceAudio: vi.fn(),
  withStagedSourceAudio: vi.fn()
}));

const sonioxMocks = vi.hoisted(() => ({
  uploadSourceAudioFile: vi.fn()
}));

const uploadLockMocks = vi.hoisted(() => ({
  withSessionSourceAudioLock: vi.fn()
}));

vi.mock("../lib/store", async () => {
  const actual = await vi.importActual<typeof import("../lib/store")>("../lib/store");

  return {
    ...actual,
    clearSourceAudioPath: storeMocks.clearSourceAudioPath,
    commitVerifiedSourceAudio: storeMocks.commitVerifiedSourceAudio,
    findReusableSourceAudioUpload: storeMocks.findReusableSourceAudioUpload,
    getSessionSnapshot: storeMocks.getSessionSnapshot,
    recordAuditEvent: storeMocks.recordAuditEvent,
    recordSourceAudioUpload: storeMocks.recordSourceAudioUpload,
    refreshStore: storeMocks.refreshStore,
    writeSourceAudioCandidateFromFile: storeMocks.writeSourceAudioCandidateFromFile
  };
});

vi.mock("../lib/source-audio-upload", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/source-audio-upload")>(
      "../lib/source-audio-upload"
    );

  return {
    ...actual,
    assertStagedSourceAudioIsAcceptable: sourceAudioMocks.assertStagedSourceAudioIsAcceptable,
    decodeAudioBase64: sourceAudioMocks.decodeAudioBase64,
    readPersistedSourceAudioIntegrity: sourceAudioMocks.readPersistedSourceAudioIntegrity,
    verifyPersistedSourceAudio: sourceAudioMocks.verifyPersistedSourceAudio,
    withStagedSourceAudio: sourceAudioMocks.withStagedSourceAudio
  };
});

vi.mock("../lib/source-audio-upload-lock", () => ({
  withSessionSourceAudioLock: uploadLockMocks.withSessionSourceAudioLock
}));

vi.mock("../lib/soniox", async () => {
  const actual = await vi.importActual<typeof import("../lib/soniox")>("../lib/soniox");

  return {
    ...actual,
    uploadSourceAudioFile: sonioxMocks.uploadSourceAudioFile
  };
});

import { uploadRoutes } from "./uploads";

function buildMultipartPayload(input: {
  sessionId: string;
  fileName: string;
  contentType: string;
  content: string;
}) {
  const boundary = "----mystt-test-boundary";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="sessionId"',
    "",
    input.sessionId,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${input.fileName}"`,
    `Content-Type: ${input.contentType}`,
    "",
    input.content,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  return {
    boundary,
    body
  };
}

describe("/v1/uploads/source-audio", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetAllMocks();

    storeMocks.refreshStore.mockResolvedValue(undefined);
    storeMocks.getSessionSnapshot.mockReturnValue({
      session: {
        id: "sess_upload",
        localAudioPath: ""
      }
    });
    storeMocks.writeSourceAudioCandidateFromFile.mockResolvedValue(
      "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a"
    );
    storeMocks.commitVerifiedSourceAudio.mockResolvedValue(
      "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a"
    );
    storeMocks.findReusableSourceAudioUpload.mockReturnValue(undefined);
    storeMocks.recordSourceAudioUpload.mockResolvedValue(undefined);
    storeMocks.recordAuditEvent.mockResolvedValue(undefined);
    storeMocks.clearSourceAudioPath.mockResolvedValue(undefined);
    uploadLockMocks.withSessionSourceAudioLock.mockImplementation(
      async (_sessionId: string, fn: () => Promise<unknown>) => fn()
    );
    sourceAudioMocks.assertStagedSourceAudioIsAcceptable.mockReturnValue(undefined);
    sourceAudioMocks.decodeAudioBase64.mockImplementation((value: string) =>
      Buffer.from(value, "base64")
    );
    sourceAudioMocks.readPersistedSourceAudioIntegrity.mockRejectedValue(
      Object.assign(new Error("source audio not found"), { code: "ENOENT" })
    );
    sourceAudioMocks.verifyPersistedSourceAudio.mockResolvedValue({
      byteLength: 12,
      sha256: "deadbeef"
    });
    sourceAudioMocks.withStagedSourceAudio.mockImplementation(
      async (_input, handler: (staged: {
        byteLength: number;
        cleanup: () => Promise<void>;
        sha256: string;
        tempDir: string;
        tempPath: string;
      }) => Promise<unknown>) =>
        handler({
          tempDir: "/private/var/folders/test-upload",
          tempPath: "/private/var/folders/test-upload/source-audio.m4a",
          byteLength: 12,
          sha256: "deadbeef",
          cleanup: async () => undefined
        })
    );
    sonioxMocks.uploadSourceAudioFile.mockResolvedValue({
      fileId: "11111111-1111-4111-8111-111111111111",
      fileName: "source-audio.m4a",
      byteLength: 12,
      createdAt: "2026-04-18T01:23:45.000Z"
    });

    app = Fastify();
    await app.register(multipart);
    await app.register(uploadRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("does not expose internal persistence locations in the public upload response", async () => {
    const { boundary, body } = buildMultipartPayload({
      sessionId: "sess_upload",
      fileName: "source-audio.m4a",
      contentType: "audio/mp4",
      content: "audio-bytes"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio",
      payload: body,
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`
      }
    });

    expect(response.statusCode).toBe(201);

    const payload = response.json();

    expect(payload).toEqual({
      data: {
        sessionId: "sess_upload",
        fileId: "11111111-1111-4111-8111-111111111111",
        fileName: "source-audio.m4a",
        byteLength: 12,
        sha256: "deadbeef",
        createdAt: "2026-04-18T01:23:45.000Z"
      }
    });
    expect(JSON.stringify(payload)).not.toContain("minio://");
    expect(JSON.stringify(payload)).not.toContain("/Volumes/mac_dock/");
    expect(JSON.stringify(payload)).not.toContain("/private/var/");
    expect(storeMocks.recordSourceAudioUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_upload",
        sha256: "deadbeef",
        byteLength: 12,
        sourceLocation:
          "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a",
        sonioxFileId: "11111111-1111-4111-8111-111111111111",
        sonioxFileName: "source-audio.m4a"
      })
    );
    expect(uploadLockMocks.withSessionSourceAudioLock).toHaveBeenCalledWith(
      "sess_upload",
      expect.any(Function)
    );
  });

  it("accepts raw audio uploads for mobile browsers that fail multipart form uploads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=safari.m4a",
      payload: Buffer.from("audio-bytes"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(sourceAudioMocks.withStagedSourceAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_upload",
        fileName: "safari.m4a",
        contentType: "audio/mp4"
      }),
      expect.any(Function)
    );
    expect(response.json()).toEqual({
      data: {
        sessionId: "sess_upload",
        fileId: "11111111-1111-4111-8111-111111111111",
        fileName: "source-audio.m4a",
        byteLength: 12,
        sha256: "deadbeef",
        createdAt: "2026-04-18T01:23:45.000Z"
      }
    });
  });

  it("persists new source audio under a hash-qualified object key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("audio-bytes"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(storeMocks.writeSourceAudioCandidateFromFile).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_upload",
        fileName: "source-deadbeef-source-audio.m4a",
        filePath: "/private/var/folders/test-upload/source-audio.m4a",
        byteLength: 12,
        sha256: "deadbeef"
      })
    );
    expect(storeMocks.commitVerifiedSourceAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_upload",
        location:
          "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a",
        fileName: "source-deadbeef-source-audio.m4a",
        byteLength: 12,
        sha256: "deadbeef"
      })
    );
  });

  it("accepts base64 JSON uploads for iOS Safari binary upload fallback", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/base64",
      payload: {
        sessionId: "sess_upload",
        fileName: "ios-json.m4a",
        contentType: "audio/mp4",
        audioBase64: Buffer.from("audio-bytes").toString("base64")
      }
    });

    expect(response.statusCode).toBe(201);
    expect(sourceAudioMocks.withStagedSourceAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_upload",
        fileName: "ios-json.m4a",
        contentType: "audio/mp4"
      }),
      expect.any(Function)
    );
    expect(response.json()).toEqual({
      data: {
        sessionId: "sess_upload",
        fileId: "11111111-1111-4111-8111-111111111111",
        fileName: "source-audio.m4a",
        byteLength: 12,
        sha256: "deadbeef",
        createdAt: "2026-04-18T01:23:45.000Z"
      }
    });
  });

  it("treats a retry with the same existing source audio hash as idempotent", async () => {
    storeMocks.getSessionSnapshot.mockReturnValue({
      session: {
        id: "sess_upload",
        localAudioPath:
          "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a"
      }
    });
    sourceAudioMocks.readPersistedSourceAudioIntegrity.mockResolvedValue({
      byteLength: 12,
      sha256: "deadbeef"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("audio-bytes"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(sourceAudioMocks.readPersistedSourceAudioIntegrity).toHaveBeenCalledWith(
      "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a"
    );
    expect(storeMocks.writeSourceAudioCandidateFromFile).not.toHaveBeenCalled();
    expect(storeMocks.commitVerifiedSourceAudio).not.toHaveBeenCalled();
    expect(sonioxMocks.uploadSourceAudioFile).toHaveBeenCalled();
  });

  it("reuses a verified same-hash Soniox upload instead of uploading again", async () => {
    storeMocks.getSessionSnapshot.mockReturnValue({
      session: {
        id: "sess_upload",
        localAudioPath:
          "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a"
      }
    });
    sourceAudioMocks.readPersistedSourceAudioIntegrity.mockResolvedValue({
      byteLength: 12,
      sha256: "deadbeef"
    });
    storeMocks.findReusableSourceAudioUpload.mockReturnValue({
      sessionId: "sess_upload",
      sha256: "deadbeef",
      byteLength: 12,
      sourceLocation:
        "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a",
      sonioxFileId: "previous-file-id",
      sonioxFileName: "source-audio.m4a",
      uploadedAt: "2026-04-18T00:00:00.000Z"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("audio-bytes"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(sonioxMocks.uploadSourceAudioFile).not.toHaveBeenCalled();
    expect(storeMocks.recordSourceAudioUpload).not.toHaveBeenCalled();
    expect(storeMocks.findReusableSourceAudioUpload).toHaveBeenCalledWith({
      sessionId: "sess_upload",
      sha256: "deadbeef",
      byteLength: 12
    });
    expect(response.json()).toEqual({
      data: {
        sessionId: "sess_upload",
        fileId: "previous-file-id",
        fileName: "source-audio.m4a",
        byteLength: 12,
        sha256: "deadbeef",
        createdAt: "2026-04-18T00:00:00.000Z"
      }
    });
  });

  it("does not reuse ledger file ids after transcription cleanup may have deleted them", async () => {
    storeMocks.getSessionSnapshot.mockReturnValue({
      session: {
        id: "sess_upload",
        localAudioPath:
          "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a"
      },
      transcription: {
        transcriptionId: "tr_done",
        status: "completed",
        createdAt: "2026-04-18T00:10:00.000Z",
        fileId: "previous-file-id",
        cleanupStatus: "completed"
      }
    });
    sourceAudioMocks.readPersistedSourceAudioIntegrity.mockResolvedValue({
      byteLength: 12,
      sha256: "deadbeef"
    });
    storeMocks.findReusableSourceAudioUpload.mockReturnValue({
      sessionId: "sess_upload",
      sha256: "deadbeef",
      byteLength: 12,
      sourceLocation:
        "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a",
      sonioxFileId: "previous-file-id",
      sonioxFileName: "source-audio.m4a",
      uploadedAt: "2026-04-18T00:00:00.000Z"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("audio-bytes"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(storeMocks.findReusableSourceAudioUpload).not.toHaveBeenCalled();
    expect(sonioxMocks.uploadSourceAudioFile).toHaveBeenCalledTimes(1);
    expect(response.json().data.fileId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects a retry that would overwrite different existing source audio", async () => {
    storeMocks.getSessionSnapshot.mockReturnValue({
      session: {
        id: "sess_upload",
        localAudioPath:
          "/Volumes/mac_dock/github/mystt/.data/audio/sessions/sess_upload/source-audio.m4a"
      }
    });
    sourceAudioMocks.readPersistedSourceAudioIntegrity.mockResolvedValue({
      byteLength: 12,
      sha256: "cafebabe"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("different-audio"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: "Source audio already exists with a different hash",
      retryable: false
    });
    expect(storeMocks.writeSourceAudioCandidateFromFile).not.toHaveBeenCalled();
    expect(storeMocks.commitVerifiedSourceAudio).not.toHaveBeenCalled();
    expect(sonioxMocks.uploadSourceAudioFile).not.toHaveBeenCalled();
    expect(storeMocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("fails retryably when persisted source audio readback does not match the staged stream", async () => {
    sourceAudioMocks.verifyPersistedSourceAudio.mockRejectedValue(
      Object.assign(new Error("Persisted source audio hash verification failed"), {
        statusCode: 503,
        retryable: true
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("audio-bytes"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      message: "Persisted source audio hash verification failed",
      retryable: true
    });
    expect(storeMocks.writeSourceAudioCandidateFromFile).toHaveBeenCalled();
    expect(storeMocks.commitVerifiedSourceAudio).not.toHaveBeenCalled();
    expect(storeMocks.clearSourceAudioPath).not.toHaveBeenCalled();
    expect(sonioxMocks.uploadSourceAudioFile).not.toHaveBeenCalled();
    expect(storeMocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("does not upload to Soniox if the verified source audio pointer cannot be committed", async () => {
    storeMocks.commitVerifiedSourceAudio.mockResolvedValueOnce(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("audio-bytes"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      message: "Session not found",
      retryable: false
    });
    expect(sourceAudioMocks.verifyPersistedSourceAudio).toHaveBeenCalled();
    expect(sonioxMocks.uploadSourceAudioFile).not.toHaveBeenCalled();
    expect(storeMocks.recordSourceAudioUpload).not.toHaveBeenCalled();
  });

  it("fails retryably when Soniox reports a different uploaded byte size", async () => {
    sonioxMocks.uploadSourceAudioFile.mockResolvedValueOnce({
      fileId: "22222222-2222-4222-8222-222222222222",
      fileName: "source-audio.m4a",
      byteLength: 11,
      createdAt: "2026-04-18T01:23:45.000Z"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("audio-bytes"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      message: "Upstream source audio upload verification failed",
      retryable: true
    });
    expect(storeMocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("returns a generic retryable envelope for unexpected upload failures", async () => {
    sonioxMocks.uploadSourceAudioFile.mockRejectedValueOnce(
      new Error("provider file file_secret failed at /private/tmp/source-audio.m4a")
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("audio-bytes"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      message: "Source audio upload failed; please retry",
      retryable: true
    });
    expect(JSON.stringify(response.json())).not.toContain("file_secret");
    expect(JSON.stringify(response.json())).not.toContain("/private/tmp");
  });

  it("rejects malformed base64 before staging or persisting audio", async () => {
    sourceAudioMocks.decodeAudioBase64.mockImplementationOnce(() => {
      throw Object.assign(new Error("audioBase64 is not valid base64"), {
        statusCode: 400,
        retryable: false
      });
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/base64",
      payload: {
        sessionId: "sess_upload",
        fileName: "ios-json.m4a",
        contentType: "audio/mp4",
        audioBase64: "not valid base64!"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: "audioBase64 is not valid base64",
      retryable: false
    });
    expect(sourceAudioMocks.withStagedSourceAudio).not.toHaveBeenCalled();
    expect(storeMocks.writeSourceAudioCandidateFromFile).not.toHaveBeenCalled();
    expect(storeMocks.commitVerifiedSourceAudio).not.toHaveBeenCalled();
    expect(sonioxMocks.uploadSourceAudioFile).not.toHaveBeenCalled();
  });

  it("rejects obvious non-audio payloads before persistence", async () => {
    sourceAudioMocks.assertStagedSourceAudioIsAcceptable.mockImplementationOnce(() => {
      throw Object.assign(new Error("Uploaded file does not look like audio"), {
        statusCode: 400,
        retryable: false
      });
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/source-audio/raw?sessionId=sess_upload&fileName=source-audio.m4a",
      payload: Buffer.from("%PDF-1.7"),
      headers: {
        "content-type": "audio/mp4"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: "Uploaded file does not look like audio",
      retryable: false
    });
    expect(storeMocks.writeSourceAudioCandidateFromFile).not.toHaveBeenCalled();
    expect(storeMocks.commitVerifiedSourceAudio).not.toHaveBeenCalled();
    expect(sonioxMocks.uploadSourceAudioFile).not.toHaveBeenCalled();
  });
});
