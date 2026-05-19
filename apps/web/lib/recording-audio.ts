function inferFileExtensionFromMimeType(mimeType: string) {
  if (/wav/i.test(mimeType)) {
    return "wav";
  }

  if (/mp4|aac|m4a/i.test(mimeType)) {
    return "m4a";
  }

  if (/mpeg|mp3/i.test(mimeType)) {
    return "mp3";
  }

  if (/ogg/i.test(mimeType)) {
    return "ogg";
  }

  if (/webm/i.test(mimeType)) {
    return "webm";
  }

  return "audio";
}

const minimumDurationIntegrityCheckMs = 60 * 1000;
const defaultMinimumDurationCoverageRatio = 0.85;
const minimumSizeIntegrityCheckMs = 10 * 60 * 1000;
const minimumPlausibleAudioBitsPerSecond = 8_000;

function readAscii(view: DataView, offset: number, length: number) {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }

  return value;
}

async function readPcmWavDurationMs(blob: Blob) {
  if (!/wav/i.test(blob.type)) {
    return null;
  }

  const header = await blob.slice(0, 44).arrayBuffer();

  if (header.byteLength < 44) {
    return null;
  }

  const view = new DataView(header);

  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    return null;
  }

  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataLength = view.getUint32(40, true);
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);

  if (!channels || !sampleRate || !bitsPerSample || !dataLength || !bytesPerSecond) {
    return null;
  }

  return (dataLength / bytesPerSecond) * 1000;
}

function isKnownShortRecording(input: {
  actualDurationMs: number | null;
  expectedDurationMs?: number;
  minimumCoverageRatio?: number;
}) {
  if (
    typeof input.actualDurationMs !== "number" ||
    typeof input.expectedDurationMs !== "number" ||
    input.expectedDurationMs < minimumDurationIntegrityCheckMs
  ) {
    return false;
  }

  return (
    input.actualDurationMs <
    input.expectedDurationMs *
      (input.minimumCoverageRatio ?? defaultMinimumDurationCoverageRatio)
  );
}

function isImplausiblySmallForDuration(input: {
  blob: Blob | null | undefined;
  expectedDurationMs?: number;
}) {
  if (
    !input.blob ||
    typeof input.expectedDurationMs !== "number" ||
    input.expectedDurationMs < minimumSizeIntegrityCheckMs
  ) {
    return false;
  }

  const expectedMinimumBytes =
    (input.expectedDurationMs / 1000) *
    (minimumPlausibleAudioBitsPerSecond / 8);

  return input.blob.size < expectedMinimumBytes;
}

async function archiveBlobIsKnownShort(input: {
  archiveBlob: Blob | null | undefined;
  expectedDurationMs?: number;
  minimumDurationCoverageRatio?: number;
  resolveBlobDurationMs?: (blob: Blob) => Promise<number | null | undefined>;
}) {
  if (
    !input.archiveBlob ||
    input.archiveBlob.size <= 0
  ) {
    return false;
  }

  if (
    isImplausiblySmallForDuration({
      blob: input.archiveBlob,
      expectedDurationMs: input.expectedDurationMs
    })
  ) {
    return true;
  }

  if (!input.resolveBlobDurationMs) {
    return false;
  }

  const archiveDurationMs = await input.resolveBlobDurationMs(input.archiveBlob);

  return isKnownShortRecording({
    actualDurationMs:
      typeof archiveDurationMs === "number" && Number.isFinite(archiveDurationMs)
        ? archiveDurationMs
        : null,
    expectedDurationMs: input.expectedDurationMs,
    minimumCoverageRatio: input.minimumDurationCoverageRatio
  });
}

export function chooseCanonicalRecordingBlob(input: {
  pcmWavBlob: Blob | null | undefined;
  archiveBlob: Blob | null | undefined;
}) {
  if (input.pcmWavBlob && input.pcmWavBlob.size > 0) {
    return input.pcmWavBlob;
  }

  if (input.archiveBlob && input.archiveBlob.size > 0) {
    return input.archiveBlob;
  }

  return null;
}

export async function buildPreferredRecordingUpload(input: {
  pcmWavBlob: Blob | null | undefined;
  archiveBlob: Blob | null | undefined;
  encodePcmWavToMp3?: (blob: Blob) => Promise<Blob | null | undefined>;
  expectedDurationMs?: number;
  minimumDurationCoverageRatio?: number;
  resolveBlobDurationMs?: (blob: Blob) => Promise<number | null | undefined>;
}) {
  if (input.pcmWavBlob && input.pcmWavBlob.size > 0) {
    const pcmDurationMs = await readPcmWavDurationMs(input.pcmWavBlob);
    const pcmIsKnownShort = isKnownShortRecording({
      actualDurationMs: pcmDurationMs,
      expectedDurationMs: input.expectedDurationMs,
      minimumCoverageRatio: input.minimumDurationCoverageRatio
    });

    if (pcmIsKnownShort) {
      if (!input.archiveBlob || input.archiveBlob.size <= 0) {
        return null;
      }

      return (await archiveBlobIsKnownShort(input)) ? null : input.archiveBlob;
    }

    if (input.encodePcmWavToMp3) {
      try {
        const mp3Blob = await input.encodePcmWavToMp3(input.pcmWavBlob);

        if (mp3Blob && mp3Blob.size > 0) {
          return mp3Blob;
        }
      } catch {
        // Keep the original WAV when client-side MP3 encoding is unavailable.
      }
    }

    return input.pcmWavBlob;
  }

  if (input.archiveBlob && input.archiveBlob.size > 0) {
    if (await archiveBlobIsKnownShort(input)) {
      return null;
    }

    return input.archiveBlob;
  }

  return null;
}

export function shouldArchivePcmWavForUpload(input: {
  isDesktopShell: boolean;
  supportsArchiveRecorder: boolean;
  prefersStableBrowserBlob?: boolean;
}) {
  return (
    input.isDesktopShell ||
    Boolean(input.prefersStableBrowserBlob) ||
    !input.supportsArchiveRecorder
  );
}

export function shouldUseInlineAudioPreview(input: { isDesktopShell: boolean }) {
  return !input.isDesktopShell;
}

export function buildRecordingFileName(input: {
  blob: Blob | null | undefined;
  baseName?: string;
}) {
  const baseName = input.baseName?.trim() || "mystt-recording";
  const extension = inferFileExtensionFromMimeType(input.blob?.type || "");
  return `${baseName}.${extension}`;
}

export function buildDesktopDownloadFileName(fileName: string) {
  const trimmed = fileName.trim();

  if (!trimmed) {
    return "mystt-recording.mp3";
  }

  const lastDot = trimmed.lastIndexOf(".");
  const stem = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  return `${stem}.mp3`;
}
