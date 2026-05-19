import { describe, expect, it } from "vitest";

import { encodePcmWavBlobToMp3 } from "./mp3-encoder";

function buildSyntheticPcmWavBlob() {
  const sampleRate = 16_000;
  const durationSeconds = 1;
  const frameCount = sampleRate * durationSeconds;
  const bytesPerSample = 2;
  const dataLength = frameCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.round(
      Math.sin((frame / sampleRate) * 440 * Math.PI * 2) * 12_000
    );
    view.setInt16(44 + frame * 2, sample, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

describe("mp3 encoder", () => {
  it("encodes PCM wav blobs into smaller mp3 blobs", async () => {
    const wavBlob = buildSyntheticPcmWavBlob();

    const mp3Blob = await encodePcmWavBlobToMp3(wavBlob, { kbps: 64 });

    expect(mp3Blob.type).toBe("audio/mpeg");
    expect(mp3Blob.size).toBeGreaterThan(0);
    expect(mp3Blob.size).toBeLessThan(wavBlob.size);
  });
});
