import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  assertStagedSourceAudioIsAcceptable,
  decodeAudioBase64,
  stageIncomingSourceAudio,
  verifyPersistedSourceAudio,
  withStagedSourceAudio
} from "./source-audio-upload";

describe("stageIncomingSourceAudio", () => {
  it("writes multipart chunks to disk while computing sha256 and byte length", async () => {
    const staged = await stageIncomingSourceAudio({
      sessionId: "session_1",
      fileName: "meeting.m4a",
      chunks: [Buffer.from("abc"), Buffer.from("def")],
      contentType: "audio/mp4"
    });

    try {
      expect(staged.byteLength).toBe(6);
      expect(staged.sha256).toBe(
        "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721"
      );
      expect(staged.tempPath.endsWith(".m4a")).toBe(true);
      await expect(readFile(staged.tempPath)).resolves.toEqual(Buffer.from("abcdef"));
    } finally {
      await staged.cleanup();
    }
  });
});

describe("decodeAudioBase64", () => {
  it("rejects malformed base64 instead of silently decoding partial bytes", () => {
    expect(() => decodeAudioBase64("not valid base64!")).toThrow(
      "audioBase64 is not valid base64"
    );
  });
});

describe("assertStagedSourceAudioIsAcceptable", () => {
  it("rejects obvious non-audio signatures before persistence", async () => {
    const staged = await stageIncomingSourceAudio({
      sessionId: "session_pdf",
      fileName: "meeting.m4a",
      chunks: [Buffer.from("%PDF-1.7\nnot audio")],
      contentType: "audio/mp4"
    });

    try {
      expect(() => assertStagedSourceAudioIsAcceptable(staged)).toThrow(
        "Uploaded file does not look like audio"
      );
    } finally {
      await staged.cleanup();
    }
  });
});

describe("verifyPersistedSourceAudio", () => {
  it("reads persisted bytes back and verifies sha256 and byte length", async () => {
    const staged = await stageIncomingSourceAudio({
      sessionId: "session_verify",
      fileName: "meeting.m4a",
      chunks: [Buffer.from("verified")]
    });

    try {
      await expect(
        verifyPersistedSourceAudio({
          location: staged.tempPath,
          byteLength: staged.byteLength,
          sha256: staged.sha256
        })
      ).resolves.toEqual({
        byteLength: 8,
        sha256: "1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb"
      });
    } finally {
      await staged.cleanup();
    }
  });

  it("fails retryably when persisted bytes do not match the staged stream", async () => {
    const staged = await stageIncomingSourceAudio({
      sessionId: "session_verify_mismatch",
      fileName: "meeting.m4a",
      chunks: [Buffer.from("different")]
    });

    try {
      await expect(
        verifyPersistedSourceAudio({
          location: staged.tempPath,
          byteLength: staged.byteLength,
          sha256: "expected-sha"
        })
      ).rejects.toMatchObject({
        message: "Persisted source audio hash verification failed",
        statusCode: 503,
        retryable: true
      });
    } finally {
      await staged.cleanup();
    }
  });
});

describe("withStagedSourceAudio", () => {
  it("removes the staged temp file after a successful fan-out", async () => {
    let observedPath = "";

    await withStagedSourceAudio(
      {
        sessionId: "session_success",
        fileName: "meeting.m4a",
        chunks: [Buffer.from("success")]
      },
      async (staged) => {
        observedPath = staged.tempPath;
        await expect(readFile(staged.tempPath)).resolves.toEqual(Buffer.from("success"));
      }
    );

    await expect(access(observedPath)).rejects.toThrow();
  });

  it("removes the staged temp file after a failed fan-out", async () => {
    let observedPath = "";

    await expect(
      withStagedSourceAudio(
        {
          sessionId: "session_failure",
          fileName: "meeting.m4a",
          chunks: [Buffer.from("failure")]
        },
        async (staged) => {
          observedPath = staged.tempPath;
          throw new Error("fan-out failed");
        }
      )
    ).rejects.toThrow("fan-out failed");

    await expect(access(observedPath)).rejects.toThrow();
  });
});
