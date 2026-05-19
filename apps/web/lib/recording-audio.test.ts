import { describe, expect, it } from "vitest";

import {
  buildDesktopDownloadFileName,
  buildPreferredRecordingUpload,
  buildRecordingFileName,
  chooseCanonicalRecordingBlob,
  shouldArchivePcmWavForUpload,
  shouldUseInlineAudioPreview
} from "./recording-audio";

function buildSilentPcmWavBlob(durationMs: number) {
  const sampleRate = 16_000;
  const channels = 1;
  const bytesPerSample = 2;
  const dataLength = Math.floor((durationMs / 1000) * sampleRate * channels * bytesPerSample);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + dataLength, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataLength, true);

  return new Blob([header, new Uint8Array(dataLength)], { type: "audio/wav" });
}

describe("recording audio helpers", () => {
  it("prefers PCM wav blobs as the canonical upload source", () => {
    const wavBlob = new Blob(["wav"], { type: "audio/wav" });
    const m4aBlob = new Blob(["m4a"], { type: "audio/mp4" });

    expect(
      chooseCanonicalRecordingBlob({
        pcmWavBlob: wavBlob,
        archiveBlob: m4aBlob
      })
    ).toBe(wavBlob);
  });

  it("falls back to the archive blob when no PCM wav blob exists", () => {
    const archiveBlob = new Blob(["m4a"], { type: "audio/mp4" });

    expect(
      chooseCanonicalRecordingBlob({
        pcmWavBlob: null,
        archiveBlob
      })
    ).toBe(archiveBlob);
  });

  it("prefers an encoded mp3 upload when PCM wav audio is available", async () => {
    const wavBlob = new Blob(["wav"], { type: "audio/wav" });
    const mp3Blob = new Blob(["mp3"], { type: "audio/mpeg" });

    await expect(
      buildPreferredRecordingUpload({
        pcmWavBlob: wavBlob,
        archiveBlob: null,
        encodePcmWavToMp3: async () => mp3Blob
      })
    ).resolves.toBe(mp3Blob);
  });

  it("uses the archive blob instead of a PCM blob that is too short for the recording wall time", async () => {
    const shortWavBlob = buildSilentPcmWavBlob(6 * 60 * 1000);
    const archiveBlob = new Blob([new Uint8Array(5 * 1024 * 1024)], {
      type: "audio/webm"
    });
    const encodePcmWavToMp3 = async () => new Blob(["short mp3"], { type: "audio/mpeg" });

    await expect(
      buildPreferredRecordingUpload({
        pcmWavBlob: shortWavBlob,
        archiveBlob,
        expectedDurationMs: 60 * 60 * 1000,
        encodePcmWavToMp3
      })
    ).resolves.toBe(archiveBlob);
  });

  it("refuses to upload a known-short PCM blob when no archive fallback exists", async () => {
    const shortWavBlob = buildSilentPcmWavBlob(6 * 60 * 1000);

    await expect(
      buildPreferredRecordingUpload({
        pcmWavBlob: shortWavBlob,
        archiveBlob: null,
        expectedDurationMs: 60 * 60 * 1000,
        encodePcmWavToMp3: async () => new Blob(["short mp3"], { type: "audio/mpeg" })
      })
    ).resolves.toBeNull();
  });

  it("refuses archive fallback too when its duration is also known to be short", async () => {
    const shortWavBlob = buildSilentPcmWavBlob(6 * 60 * 1000);
    const shortArchiveBlob = new Blob(["short archive"], { type: "audio/webm" });

    await expect(
      buildPreferredRecordingUpload({
        pcmWavBlob: shortWavBlob,
        archiveBlob: shortArchiveBlob,
        expectedDurationMs: 60 * 60 * 1000,
        resolveBlobDurationMs: async (blob) =>
          blob === shortArchiveBlob ? 6 * 60 * 1000 : null
      })
    ).resolves.toBeNull();
  });

  it("refuses an archive fallback that is implausibly small for a long recording", async () => {
    const shortWavBlob = buildSilentPcmWavBlob(6 * 60 * 1000);
    const tinyArchiveBlob = new Blob([new Uint8Array(3 * 1024 * 1024)], {
      type: "audio/webm"
    });

    await expect(
      buildPreferredRecordingUpload({
        pcmWavBlob: shortWavBlob,
        archiveBlob: tinyArchiveBlob,
        expectedDurationMs: 60 * 60 * 1000,
        resolveBlobDurationMs: async () => null
      })
    ).resolves.toBeNull();
  });

  it("falls back to the PCM wav upload when mp3 encoding fails", async () => {
    const wavBlob = new Blob(["wav"], { type: "audio/wav" });

    await expect(
      buildPreferredRecordingUpload({
        pcmWavBlob: wavBlob,
        archiveBlob: null,
        encodePcmWavToMp3: async () => {
          throw new Error("encoder failed");
        }
      })
    ).resolves.toBe(wavBlob);
  });

  it("builds filenames from the selected blob mime type", () => {
    expect(
      buildRecordingFileName({
        blob: new Blob(["wav"], { type: "audio/wav" })
      })
    ).toBe("mystt-recording.wav");

    expect(
      buildRecordingFileName({
        blob: new Blob(["mp3"], { type: "audio/mpeg" }),
        baseName: "session-audio"
      })
    ).toBe("session-audio.mp3");
  });

  it("rewrites desktop downloads to mp3 names", () => {
    expect(buildDesktopDownloadFileName("mystt-recording.wav")).toBe(
      "mystt-recording.mp3"
    );
    expect(buildDesktopDownloadFileName("meeting")).toBe("meeting.mp3");
  });

  it("keeps a PCM wav archive for desktop uploads even when MediaRecorder exists", () => {
    expect(
      shouldArchivePcmWavForUpload({
        isDesktopShell: true,
        supportsArchiveRecorder: true
      })
    ).toBe(true);

    expect(
      shouldArchivePcmWavForUpload({
        isDesktopShell: false,
        supportsArchiveRecorder: true
      })
    ).toBe(false);

    expect(
      shouldArchivePcmWavForUpload({
        isDesktopShell: false,
        supportsArchiveRecorder: false
      })
    ).toBe(true);
  });

  it("keeps a PCM wav archive when the browser MediaRecorder blob is not stable enough for upload", () => {
    expect(
      shouldArchivePcmWavForUpload({
        isDesktopShell: false,
        supportsArchiveRecorder: true,
        prefersStableBrowserBlob: true
      })
    ).toBe(true);
  });

  it("does not offer inline audio preview inside the desktop shell", () => {
    expect(shouldUseInlineAudioPreview({ isDesktopShell: true })).toBe(false);
    expect(shouldUseInlineAudioPreview({ isDesktopShell: false })).toBe(true);
  });
});
