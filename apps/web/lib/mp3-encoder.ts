type WavInfo = {
  channels: number;
  sampleRate: number;
  dataOffset: number;
  dataLength: number;
  bitsPerSample: number;
};

type Mp3EncoderInstance = {
  encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array | Int8Array;
  flush(): Uint8Array | Int8Array;
};

type Mp3EncoderConstructor = new (
  channels: number,
  sampleRate: number,
  kbps: number
) => Mp3EncoderInstance;

async function createMp3Encoder(
  channels: number,
  sampleRate: number,
  kbps: number
) {
  const lameModule = await import("@breezystack/lamejs");
  const Mp3Encoder =
    lameModule.Mp3Encoder ??
    (lameModule.default as { Mp3Encoder?: Mp3EncoderConstructor }).Mp3Encoder;

  if (!Mp3Encoder) {
    throw new Error("MP3 encoder is unavailable.");
  }

  return new Mp3Encoder(channels, sampleRate, kbps);
}

function readAscii(view: DataView, offset: number, length: number) {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }

  return value;
}

function readWavInfo(buffer: ArrayBuffer): WavInfo {
  const view = new DataView(buffer);

  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("Expected a PCM WAV blob.");
  }

  let cursor = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataLength = 0;

  while (cursor + 8 <= view.byteLength) {
    const chunkId = readAscii(view, cursor, 4);
    const chunkSize = view.getUint32(cursor + 4, true);
    const chunkDataOffset = cursor + 8;

    if (chunkId === "fmt ") {
      const audioFormat = view.getUint16(chunkDataOffset, true);

      if (audioFormat !== 1) {
        throw new Error("Only PCM WAV input can be encoded to MP3.");
      }

      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    }

    if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataLength = chunkSize;
      break;
    }

    cursor = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!channels || !sampleRate || !bitsPerSample || !dataOffset || !dataLength) {
    throw new Error("WAV metadata is incomplete.");
  }

  return {
    channels,
    sampleRate,
    dataOffset,
    dataLength,
    bitsPerSample
  };
}

function readPcm16Samples(buffer: ArrayBuffer, wav: WavInfo) {
  if (wav.bitsPerSample !== 16) {
    throw new Error("Only 16-bit PCM WAV input can be encoded to MP3.");
  }

  if (wav.channels < 1 || wav.channels > 2) {
    throw new Error("Only mono or stereo WAV input can be encoded to MP3.");
  }

  const view = new DataView(buffer, wav.dataOffset, wav.dataLength);
  const frameCount = wav.dataLength / (2 * wav.channels);
  const left = new Int16Array(frameCount);
  const right = wav.channels === 2 ? new Int16Array(frameCount) : null;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * wav.channels * 2;
    left[frame] = view.getInt16(offset, true);

    if (right) {
      right[frame] = view.getInt16(offset + 2, true);
    }
  }

  return {
    left,
    right
  };
}

function copyToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function encodePcmWavBlobToMp3(
  wavBlob: Blob,
  options?: { kbps?: number }
) {
  const buffer = await wavBlob.arrayBuffer();
  const wav = readWavInfo(buffer);
  const samples = readPcm16Samples(buffer, wav);
  const encoder = await createMp3Encoder(
    wav.channels,
    wav.sampleRate,
    options?.kbps ?? 64
  );
  const chunks: Uint8Array[] = [];
  const frameSize = 1152;

  for (let offset = 0; offset < samples.left.length; offset += frameSize) {
    const left = samples.left.subarray(offset, offset + frameSize);
    const encoded = samples.right
      ? encoder.encodeBuffer(left, samples.right.subarray(offset, offset + frameSize))
      : encoder.encodeBuffer(left);

    if (encoded.length > 0) {
      chunks.push(new Uint8Array(encoded));
    }
  }

  const flushed = encoder.flush();

  if (flushed.length > 0) {
    chunks.push(new Uint8Array(flushed));
  }

  return new Blob(chunks.map(copyToArrayBuffer), { type: "audio/mpeg" });
}
