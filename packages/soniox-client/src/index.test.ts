import { describe, expect, it } from "vitest";

import {
  buildAsyncTranscriptionRequest,
  buildCleanupTargets,
  buildRealtimeStreamConfig
} from "./index";

describe("soniox-client", () => {
  it("builds a realtime config with safe defaults", () => {
    expect(buildRealtimeStreamConfig()).toMatchObject({
      diarization: true,
      enableEndpointDetection: true,
      translationMode: "off"
    });
  });

  it("builds cleanup targets", () => {
    expect(
      buildCleanupTargets({ transcriptionId: "tx_1", fileId: "file_1" })
    ).toEqual(["transcriptions/tx_1", "files/file_1"]);
  });

  it("creates an async transcription payload", () => {
    const payload = buildAsyncTranscriptionRequest({
      sessionId: "sess_1",
      mode: "meeting",
      audioUrl: "https://bucket/session.wav",
      languageHints: ["ko", "en"],
      webhookUrl: "https://api.localhost/v1/webhooks/soniox",
      context: ["Project: mystt"]
    });

    expect(payload).toMatchObject({
      session_id: "sess_1",
      diarization: true
    });
  });
});

