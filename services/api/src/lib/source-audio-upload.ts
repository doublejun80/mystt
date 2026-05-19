import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { closeSync, createWriteStream, openSync, readSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { finished } from "node:stream/promises";

import { readPersistedArtifactBuffer } from "./persistence";

export interface StagedSourceAudio {
  tempDir: string;
  tempPath: string;
  contentType?: string;
  byteLength: number;
  sha256: string;
  cleanup: () => Promise<void>;
}

export interface SourceAudioIntegrity {
  byteLength: number;
  sha256: string;
}

export class SourceAudioUploadError extends Error {
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly code: string;

  constructor(
    message: string,
    input?: {
      statusCode?: number;
      retryable?: boolean;
      code?: string;
    }
  ) {
    super(message);
    this.name = "SourceAudioUploadError";
    this.statusCode = input?.statusCode ?? 400;
    this.retryable = input?.retryable ?? false;
    this.code = input?.code ?? "source_audio_upload_error";
  }
}

export function isSourceAudioUploadError(error: unknown): error is SourceAudioUploadError {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (
    error instanceof SourceAudioUploadError ||
    (typeof Reflect.get(error, "statusCode") === "number" &&
      typeof Reflect.get(error, "retryable") === "boolean")
  );
}

function buildIntegrity(buffer: Buffer | Uint8Array): SourceAudioIntegrity {
  const content = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  return {
    byteLength: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex")
  };
}

export function decodeAudioBase64(value: string): Buffer {
  const trimmed = value.trim();
  const dataUrlMatch = trimmed.match(/^data:audio\/[a-z0-9.+-]+;base64,(.*)$/is);
  const payload = (dataUrlMatch?.[1] ?? trimmed).replace(/\s+/g, "");

  if (
    payload.length === 0 ||
    payload.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload) ||
    /=/.test(payload.slice(0, Math.max(0, payload.length - 2)))
  ) {
    throw new SourceAudioUploadError("audioBase64 is not valid base64", {
      statusCode: 400,
      retryable: false,
      code: "invalid_base64_audio"
    });
  }

  const buffer = Buffer.from(payload, "base64");
  const withoutPadding = payload.replace(/=+$/, "");
  const decodedWithoutPadding = buffer.toString("base64").replace(/=+$/, "");

  if (buffer.byteLength === 0 || decodedWithoutPadding !== withoutPadding) {
    throw new SourceAudioUploadError("audioBase64 is not valid base64", {
      statusCode: 400,
      retryable: false,
      code: "invalid_base64_audio"
    });
  }

  return buffer;
}

function readFileHeader(filePath: string, byteLength = 64): Buffer {
  const descriptor = openSync(filePath, "r");

  try {
    const buffer = Buffer.alloc(byteLength);
    const bytesRead = readSync(descriptor, buffer, 0, byteLength, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

function startsWithAscii(buffer: Buffer, value: string): boolean {
  return buffer.subarray(0, value.length).toString("latin1") === value;
}

function looksLikeObviousNonAudio(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  const textPrefix = buffer
    .toString("utf8", 0, Math.min(buffer.length, 64))
    .trimStart()
    .toLowerCase();

  return (
    startsWithAscii(buffer, "%PDF-") ||
    startsWithAscii(buffer, "\x89PNG\r\n\x1a\n") ||
    startsWithAscii(buffer, "GIF87a") ||
    startsWithAscii(buffer, "GIF89a") ||
    startsWithAscii(buffer, "PK\x03\x04") ||
    startsWithAscii(buffer, "PK\x05\x06") ||
    startsWithAscii(buffer, "PK\x07\x08") ||
    startsWithAscii(buffer, "\x7fELF") ||
    startsWithAscii(buffer, "MZ") ||
    startsWithAscii(buffer, "\x1f\x8b") ||
    textPrefix.startsWith("<!doctype html") ||
    textPrefix.startsWith("<html") ||
    textPrefix.startsWith("<?xml") ||
    textPrefix.startsWith("{") ||
    textPrefix.startsWith("[")
  );
}

export function assertStagedSourceAudioIsAcceptable(staged: StagedSourceAudio): void {
  if (staged.byteLength === 0) {
    return;
  }

  const header = readFileHeader(staged.tempPath);

  if (looksLikeObviousNonAudio(header)) {
    throw new SourceAudioUploadError("Uploaded file does not look like audio", {
      statusCode: 400,
      retryable: false,
      code: "invalid_audio_signature"
    });
  }
}

export async function readPersistedSourceAudioIntegrity(
  location: string
): Promise<SourceAudioIntegrity> {
  const buffer = await readPersistedArtifactBuffer(location);
  return buildIntegrity(buffer);
}

export async function verifyPersistedSourceAudio(input: {
  location: string;
  byteLength: number;
  sha256: string;
}): Promise<SourceAudioIntegrity> {
  const integrity = await readPersistedSourceAudioIntegrity(input.location);

  if (integrity.byteLength !== input.byteLength || integrity.sha256 !== input.sha256) {
    throw new SourceAudioUploadError("Persisted source audio hash verification failed", {
      statusCode: 503,
      retryable: true,
      code: "source_audio_readback_mismatch"
    });
  }

  return integrity;
}

export async function stageIncomingSourceAudio(input: {
  sessionId: string;
  fileName: string;
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  contentType?: string;
}): Promise<StagedSourceAudio> {
  const safeFileName = basename(input.fileName);
  const tempDir = await mkdtemp(join(tmpdir(), `mystt-source-${input.sessionId}-`));
  const tempPath = join(tempDir, safeFileName);
  const hash = createHash("sha256");
  const writer = createWriteStream(tempPath);
  let byteLength = 0;

  try {
    for await (const chunk of input.chunks) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      hash.update(buffer);

      if (!writer.write(buffer)) {
        await new Promise<void>((resolve, reject) => {
          writer.once("drain", resolve);
          writer.once("error", reject);
        });
      }
    }

    writer.end();
    await finished(writer);
  } catch (error) {
    writer.destroy();
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    tempDir,
    tempPath,
    contentType: input.contentType,
    byteLength,
    sha256: hash.digest("hex"),
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

export async function withStagedSourceAudio<T>(
  input: {
    sessionId: string;
    fileName: string;
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
    contentType?: string;
  },
  handler: (staged: StagedSourceAudio) => Promise<T>
): Promise<T> {
  const staged = await stageIncomingSourceAudio(input);

  try {
    return await handler(staged);
  } finally {
    await staged.cleanup();
  }
}
