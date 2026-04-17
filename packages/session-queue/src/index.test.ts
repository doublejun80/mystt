import { describe, expect, it } from "vitest";

import {
  createSessionProcessJob,
  parseSessionProcessJob,
  serializeSessionProcessJob
} from "./index";

describe("session queue payloads", () => {
  it("round-trips a session process job", () => {
    const job = createSessionProcessJob({
      sessionId: "session-1",
      audioUrl: "https://example.com/audio.mp3",
      pollIntervalMs: 1_000,
      timeoutMs: 120_000
    });

    expect(parseSessionProcessJob(serializeSessionProcessJob(job))).toEqual(job);
  });

  it("rejects payloads without a process source", () => {
    expect(() =>
      parseSessionProcessJob(
        JSON.stringify({
          jobId: "job-1",
          sessionId: "session-1",
          createdAt: new Date().toISOString()
        })
      )
    ).toThrow("audioUrl or fileId");
  });
});
