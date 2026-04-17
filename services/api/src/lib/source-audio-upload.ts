import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { finished } from "node:stream/promises";

export interface StagedSourceAudio {
  tempDir: string;
  tempPath: string;
  contentType?: string;
  byteLength: number;
  sha256: string;
  cleanup: () => Promise<void>;
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
