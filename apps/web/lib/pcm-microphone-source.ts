"use client";

import type { AudioSource, AudioSourceHandlers } from "@soniox/client";

type AudioContextCtor = typeof AudioContext;

type LegacyNavigator = Navigator & {
  getUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    failure: (error: Error) => void
  ) => void;
  webkitGetUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    failure: (error: Error) => void
  ) => void;
  mozGetUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    failure: (error: Error) => void
  ) => void;
};

function getAudioContextCtor() {
  if (typeof window === "undefined") {
    return null;
  }

  const maybeWindow = window as Window & typeof globalThis & {
    webkitAudioContext?: AudioContextCtor;
  };

  return maybeWindow.AudioContext ?? maybeWindow.webkitAudioContext ?? null;
}

function getGetUserMedia() {
  if (typeof navigator === "undefined") {
    return null;
  }

  const legacyNavigator = navigator as LegacyNavigator;

  if (typeof navigator.mediaDevices?.getUserMedia === "function") {
    return (constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints);
  }

  const legacyGetUserMedia =
    legacyNavigator.getUserMedia ??
    legacyNavigator.webkitGetUserMedia ??
    legacyNavigator.mozGetUserMedia;

  if (!legacyGetUserMedia) {
    return null;
  }

  return (constraints: MediaStreamConstraints) =>
    new Promise<MediaStream>((resolve, reject) => {
      legacyGetUserMedia.call(legacyNavigator, constraints, resolve, reject);
    });
}

function floatTo16BitPcmBuffer(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(
      index * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true
    );
  }

  return buffer;
}

function mergeUint8Arrays(chunks: Uint8Array[], totalBytes: number) {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function buildWavBlob(
  chunks: Uint8Array[],
  totalBytes: number,
  sampleRate: number,
  numChannels: number
) {
  const pcmData = mergeUint8Arrays(chunks, totalBytes);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;

  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + pcmData.byteLength, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, pcmData.byteLength, true);

  return new Blob([header, pcmData], { type: "audio/wav" });
}

export function supportsPcmMicrophoneSource() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(
    window.WebSocket && getGetUserMedia() && getAudioContextCtor()
  );
}

export class PcmMicrophoneSource implements AudioSource {
  private readonly constraints: MediaTrackConstraints;
  private readonly numChannels: number;
  private readonly processorBufferSize: number;
  private readonly targetSampleRate: number;
  private readonly archiveAudio: boolean;

  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private muteNode: GainNode | null = null;
  private stream: MediaStream | null = null;
  private handlers: AudioSourceHandlers | null = null;
  private paused = false;
  private startGeneration = 0;
  private archivedChunks: Uint8Array[] = [];
  private archivedByteLength = 0;
  private pendingChunks: Uint8Array[] = [];
  private pendingByteLength = 0;
  private chunkCount = 0;
  private readonly onDebug?: (debug: {
    chunkCount: number;
    rms: number;
    peak: number;
    pendingBytes: number;
    sampleRate: number;
    muted: boolean;
  }) => void;
  private readonly onTrackState?: (state: {
    muted: boolean;
    readyState: MediaStreamTrackState | "missing";
    label: string;
  }) => void;
  private readonly onStream?: (stream: MediaStream) => void;
  private trackMuted = false;

  sampleRate: number;

  constructor(options?: {
    constraints?: MediaTrackConstraints;
    numChannels?: number;
    processorBufferSize?: number;
    targetSampleRate?: number;
    onDebug?: (debug: {
      chunkCount: number;
      rms: number;
      peak: number;
      pendingBytes: number;
      sampleRate: number;
      muted: boolean;
    }) => void;
    onTrackState?: (state: {
      muted: boolean;
      readyState: MediaStreamTrackState | "missing";
      label: string;
    }) => void;
    onStream?: (stream: MediaStream) => void;
    archiveAudio?: boolean;
  }) {
    this.constraints = options?.constraints ?? {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };
    this.numChannels = options?.numChannels ?? 1;
    this.processorBufferSize = options?.processorBufferSize ?? 4096;
    this.targetSampleRate = options?.targetSampleRate ?? 16_000;
    this.sampleRate = this.targetSampleRate;
    this.archiveAudio = options?.archiveAudio ?? true;
    this.onDebug = options?.onDebug;
    this.onTrackState = options?.onTrackState;
    this.onStream = options?.onStream;
  }

  async prepare() {
    const AudioContextClass = getAudioContextCtor();

    if (!AudioContextClass) {
      throw new Error("이 브라우저에서는 Web Audio API를 사용할 수 없습니다.");
    }

    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContextClass({
        sampleRate: this.targetSampleRate
      });
    }

    this.sampleRate = this.audioContext.sampleRate;

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    return this.sampleRate;
  }

  async start(handlers: AudioSourceHandlers) {
    this.stop();
    this.clear();
    this.handlers = handlers;
    this.paused = false;
    this.trackMuted = false;

    const requestMicrophone = getGetUserMedia();

    if (!requestMicrophone) {
      throw new Error(
        "이 환경에서는 마이크 API를 찾지 못했습니다. 브라우저 권한이나 데스크톱 셸의 microphone 허용 상태를 확인해 주세요."
      );
    }

    const generation = ++this.startGeneration;
    await this.prepare();

    const stream = await requestMicrophone({
      audio: {
        ...this.constraints,
        channelCount: this.numChannels
      }
    });

    if (generation !== this.startGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    this.stream = stream;
    this.onStream?.(stream);

    const audioContext = this.audioContext;

    if (!audioContext) {
      throw new Error("Audio context is not available.");
    }

    const sourceNode = audioContext.createMediaStreamSource(stream);
    const processorNode = audioContext.createScriptProcessor(
      this.processorBufferSize,
      this.numChannels,
      this.numChannels
    );
    const muteNode = audioContext.createGain();

    muteNode.gain.value = 0;

    processorNode.onaudioprocess = (event) => {
      if (!this.handlers || this.paused) {
        return;
      }

      const channel = event.inputBuffer.getChannelData(0);

      if (!channel || channel.length === 0) {
        return;
      }

      let sumSquares = 0;
      let peak = 0;

      for (let index = 0; index < channel.length; index += 1) {
        const absolute = Math.abs(channel[index] ?? 0);
        sumSquares += absolute * absolute;
        if (absolute > peak) {
          peak = absolute;
        }
      }

      const rms = Math.sqrt(sumSquares / channel.length);
      const pcmBuffer = floatTo16BitPcmBuffer(channel);
      const pendingCopy = new Uint8Array(pcmBuffer.slice(0));

      this.chunkCount += 1;
      if (this.archiveAudio) {
        const archiveCopy = new Uint8Array(pcmBuffer.slice(0));
        this.archivedChunks.push(archiveCopy);
        this.archivedByteLength += archiveCopy.byteLength;
      }
      this.pendingChunks.push(pendingCopy);
      this.pendingByteLength += pendingCopy.byteLength;
      this.onDebug?.({
        chunkCount: this.chunkCount,
        rms,
        peak,
        pendingBytes: this.pendingByteLength,
        sampleRate: this.sampleRate,
        muted: this.trackMuted
      });
      this.handlers.onData(pcmBuffer);
    };

    const audioTrack = stream.getAudioTracks()[0];
    this.onTrackState?.({
      muted: audioTrack?.muted ?? false,
      readyState: audioTrack?.readyState ?? "missing",
      label: audioTrack?.label ?? ""
    });
    audioTrack?.addEventListener("mute", () => {
      this.trackMuted = true;
      this.onTrackState?.({
        muted: true,
        readyState: audioTrack.readyState,
        label: audioTrack.label
      });
      handlers.onMuted?.();
    });
    audioTrack?.addEventListener("unmute", () => {
      this.trackMuted = false;
      this.onTrackState?.({
        muted: false,
        readyState: audioTrack.readyState,
        label: audioTrack.label
      });
      handlers.onUnmuted?.();
    });

    sourceNode.connect(processorNode);
    processorNode.connect(muteNode);
    muteNode.connect(audioContext.destination);

    this.sourceNode = sourceNode;
    this.processorNode = processorNode;
    this.muteNode = muteNode;
  }

  stop() {
    this.startGeneration += 1;
    this.handlers = null;
    this.paused = false;

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.muteNode) {
      this.muteNode.disconnect();
      this.muteNode = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      const context = this.audioContext;
      this.audioContext = null;
      void context.close().catch(() => undefined);
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  clear() {
    this.archivedChunks = [];
    this.archivedByteLength = 0;
    this.chunkCount = 0;
    this.clearPending();
  }

  clearPending() {
    this.pendingChunks = [];
    this.pendingByteLength = 0;
  }

  hasPendingAudio() {
    return this.pendingByteLength > 0;
  }

  consumePendingWavBlob(options?: {
    minBytes?: number;
    force?: boolean;
    maxBytes?: number;
  }) {
    const minBytes = options?.minBytes ?? 0;
    const force = options?.force ?? false;
    const maxBytes = options?.maxBytes;

    if (
      this.pendingByteLength === 0 ||
      (!force && this.pendingByteLength < minBytes)
    ) {
      return null;
    }

    let chunks = this.pendingChunks;
    let totalBytes = this.pendingByteLength;

    if (typeof maxBytes === "number" && maxBytes > 0 && totalBytes > maxBytes) {
      const consumedChunks: Uint8Array[] = [];
      const remainingChunks: Uint8Array[] = [];
      let consumedBytes = 0;
      let remainingBytes = 0;

      for (const chunk of this.pendingChunks) {
        if (consumedBytes >= maxBytes) {
          remainingChunks.push(chunk);
          remainingBytes += chunk.byteLength;
          continue;
        }

        const room = maxBytes - consumedBytes;

        if (chunk.byteLength <= room) {
          consumedChunks.push(chunk);
          consumedBytes += chunk.byteLength;
          continue;
        }

        consumedChunks.push(chunk.subarray(0, room));
        consumedBytes += room;

        const tail = chunk.subarray(room);
        if (tail.byteLength > 0) {
          remainingChunks.push(tail);
          remainingBytes += tail.byteLength;
        }
      }

      this.pendingChunks = remainingChunks;
      this.pendingByteLength = remainingBytes;
      chunks = consumedChunks;
      totalBytes = consumedBytes;
    } else {
      this.clearPending();
    }

    return buildWavBlob(chunks, totalBytes, this.sampleRate, this.numChannels);
  }

  getWavBlob() {
    if (this.archivedByteLength === 0) {
      return null;
    }

    return buildWavBlob(
      this.archivedChunks,
      this.archivedByteLength,
      this.sampleRate,
      this.numChannels
    );
  }
}
