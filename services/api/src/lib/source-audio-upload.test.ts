import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  stageIncomingSourceAudio,
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
