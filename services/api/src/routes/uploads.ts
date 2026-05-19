import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { Readable } from "node:stream";
import { z } from "zod";

import {
  assertStagedSourceAudioIsAcceptable,
  decodeAudioBase64,
  isSourceAudioUploadError,
  readPersistedSourceAudioIntegrity,
  SourceAudioUploadError,
  verifyPersistedSourceAudio,
  withStagedSourceAudio,
  type StagedSourceAudio
} from "../lib/source-audio-upload";
import { withSessionSourceAudioLock } from "../lib/source-audio-upload-lock";
import { uploadSourceAudioFile } from "../lib/soniox";
import { buildPortalSourceAudioUpload } from "../lib/session-presenters";
import {
  commitVerifiedSourceAudio,
  findReusableSourceAudioUpload,
  getSessionSnapshot,
  recordAuditEvent,
  recordSourceAudioUpload,
  refreshStore,
  writeSourceAudioCandidateFromFile
} from "../lib/store";

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-z0-9._-]+/gi, "-").replace(/-{2,}/g, "-");
}

function buildPersistedSourceAudioFileName(input: {
  fileName: string;
  sha256: string;
}) {
  const hashPrefix = input.sha256.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 16);
  const safeFileName = sanitizeFileName(input.fileName || "source-audio");
  return `source-${hashPrefix || "unverified"}-${safeFileName}`;
}

function getMultipartFieldValue(input: unknown) {
  const field = Array.isArray(input) ? input[0] : input;

  if (!field || typeof field !== "object" || !("value" in field)) {
    return undefined;
  }

  const value = Reflect.get(field, "value");
  return typeof value === "string" ? value : undefined;
}

function getErrorCode(error: unknown) {
  return error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
}

function getErrorName(error: unknown) {
  return error && typeof error === "object" ? Reflect.get(error, "name") : undefined;
}

function getErrorHttpStatus(error: unknown) {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const metadata = Reflect.get(error, "$metadata");
  return metadata && typeof metadata === "object"
    ? Reflect.get(metadata, "httpStatusCode")
    : undefined;
}

function isPersistedSourceAudioNotFound(error: unknown) {
  const code = getErrorCode(error);
  const name = getErrorName(error);
  const status = getErrorHttpStatus(error);

  return (
    code === "ENOENT" ||
    code === "ENOTDIR" ||
    code === "NoSuchKey" ||
    name === "NoSuchKey" ||
    status === 404
  );
}

function sendSourceAudioUploadError(reply: FastifyReply, error: unknown) {
  if (isSourceAudioUploadError(error)) {
    return reply.code(error.statusCode).send({
      message: getPublicSourceAudioUploadErrorMessage(error),
      retryable: error.retryable
    });
  }

  return reply.code(503).send({
    message: "Source audio upload failed; please retry",
    retryable: true
  });
}

function getPublicSourceAudioUploadErrorMessage(error: SourceAudioUploadError) {
  if (
    error.code === "soniox_source_audio_size_missing" ||
    error.code === "soniox_source_audio_size_mismatch"
  ) {
    return "Upstream source audio upload verification failed";
  }

  if (error.code === "source_audio_readback_mismatch") {
    return "Persisted source audio verification failed";
  }

  return error.message;
}

function canReuseSourceAudioUpload(
  snapshot: NonNullable<ReturnType<typeof getSessionSnapshot>>
) {
  return !snapshot.transcription;
}

async function resolveExistingSourceAudio(input: {
  location?: string;
  staged: StagedSourceAudio;
}): Promise<{ reusable: boolean; location?: string }> {
  const location = input.location?.trim();

  if (!location) {
    return { reusable: false };
  }

  try {
    const existing = await readPersistedSourceAudioIntegrity(location);

    if (
      existing.byteLength === input.staged.byteLength &&
      existing.sha256 === input.staged.sha256
    ) {
      return {
        reusable: true,
        location
      };
    }

    throw new SourceAudioUploadError("Source audio already exists with a different hash", {
      statusCode: 409,
      retryable: false,
      code: "source_audio_hash_conflict"
    });
  } catch (error) {
    if (isSourceAudioUploadError(error)) {
      throw error;
    }

    if (isPersistedSourceAudioNotFound(error)) {
      return { reusable: false };
    }

    throw new SourceAudioUploadError("Existing source audio could not be verified", {
      statusCode: 503,
      retryable: true,
      code: "source_audio_existing_read_failed"
    });
  }
}

const base64UploadBody = z.object({
  sessionId: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1).optional(),
  audioBase64: z.string().min(1)
});

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  const passThroughBodyParser = (
    _request: unknown,
    payload: Readable,
    done: (error: Error | null, body?: Readable) => void
  ) => {
    done(null, payload);
  };

  app.addContentTypeParser(/^audio\/.+$/i, passThroughBodyParser);
  app.addContentTypeParser("application/octet-stream", passThroughBodyParser);

  async function persistSourceAudio(input: {
    sessionId: string;
    fileName: string;
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
    contentType?: string;
  }) {
    const snapshot = getSessionSnapshot(input.sessionId);

    if (!snapshot) {
      return {
        missingSession: true as const
      };
    }

    const fileName = sanitizeFileName(input.fileName || `${input.sessionId}.m4a`);
    const result = await withStagedSourceAudio(
      {
        sessionId: input.sessionId,
        fileName,
        chunks: input.chunks,
        contentType: input.contentType
      },
      async (staged) => {
        if (staged.byteLength === 0) {
          return {
            empty: true as const
          };
        }

        return withSessionSourceAudioLock(input.sessionId, async () => {
          await refreshStore();
          const lockedSnapshot = getSessionSnapshot(input.sessionId);

          if (!lockedSnapshot) {
            throw new SourceAudioUploadError("Session not found", {
              statusCode: 404,
              retryable: false,
              code: "session_not_found"
            });
          }

          assertStagedSourceAudioIsAcceptable(staged);
          const existingSourceAudio = await resolveExistingSourceAudio({
            location: lockedSnapshot.session.localAudioPath,
            staged
          });
          const persistedFileName = buildPersistedSourceAudioFileName({
            fileName,
            sha256: staged.sha256
          });
          const location =
            existingSourceAudio.reusable && existingSourceAudio.location
              ? existingSourceAudio.location
              : await writeSourceAudioCandidateFromFile({
                  sessionId: input.sessionId,
                  fileName: persistedFileName,
                  filePath: staged.tempPath,
                  byteLength: staged.byteLength,
                  sha256: staged.sha256,
                  contentType: input.contentType
                });

          if (!existingSourceAudio.reusable) {
            await verifyPersistedSourceAudio({
              location,
              byteLength: staged.byteLength,
              sha256: staged.sha256
            });
            const committedLocation = await commitVerifiedSourceAudio({
              sessionId: input.sessionId,
              location,
              fileName: persistedFileName,
              byteLength: staged.byteLength,
              sha256: staged.sha256,
              contentType: input.contentType
            });

            if (!committedLocation) {
              throw new SourceAudioUploadError("Session not found", {
                statusCode: 404,
                retryable: false,
                code: "session_not_found"
              });
            }
          }

          const reusableUpload = existingSourceAudio.reusable && canReuseSourceAudioUpload(lockedSnapshot)
            ? findReusableSourceAudioUpload({
                sessionId: input.sessionId,
                sha256: staged.sha256,
                byteLength: staged.byteLength
              })
            : undefined;

          if (reusableUpload) {
            await recordAuditEvent({
              sessionId: input.sessionId,
              kind: "source_audio.soniox_upload_reused",
              payload: {
                fileId: reusableUpload.sonioxFileId,
                location,
                fileName: reusableUpload.sonioxFileName,
                byteLength: staged.byteLength,
                sha256: staged.sha256,
                contentType: input.contentType ?? null,
                sourceFileName: fileName,
                uploadedAt: reusableUpload.uploadedAt
              }
            });

            return {
              empty: false as const,
              location,
              uploadedFile: {
                fileId: reusableUpload.sonioxFileId,
                fileName: reusableUpload.sonioxFileName,
                byteLength: reusableUpload.byteLength,
                createdAt: reusableUpload.uploadedAt
              },
              staged
            };
          }

          const uploadedFile = await uploadSourceAudioFile({
            sessionId: input.sessionId,
            fileName,
            filePath: staged.tempPath
          });

          if (typeof uploadedFile.byteLength !== "number") {
            throw new SourceAudioUploadError(
              "Soniox uploaded source audio size was not reported",
              {
                statusCode: 503,
                retryable: true,
                code: "soniox_source_audio_size_missing"
              }
            );
          }

          if (uploadedFile.byteLength !== staged.byteLength) {
            throw new SourceAudioUploadError(
              "Soniox uploaded source audio size did not match staged audio",
              {
                statusCode: 503,
                retryable: true,
                code: "soniox_source_audio_size_mismatch"
              }
            );
          }

          await recordSourceAudioUpload({
            sessionId: input.sessionId,
            sha256: staged.sha256,
            byteLength: staged.byteLength,
            sourceLocation: location,
            sonioxFileId: uploadedFile.fileId,
            sonioxFileName: uploadedFile.fileName,
            uploadedAt: uploadedFile.createdAt,
            contentType: input.contentType,
            sourceFileName: fileName
          });

          await recordAuditEvent({
            sessionId: input.sessionId,
            kind: "source_audio.soniox_uploaded",
            payload: {
              fileId: uploadedFile.fileId,
              location,
              fileName: uploadedFile.fileName,
              byteLength: staged.byteLength,
              sha256: staged.sha256,
              contentType: input.contentType ?? null,
              reusedExistingSourceAudio: existingSourceAudio.reusable
            }
          });

          return {
            empty: false as const,
            location,
            uploadedFile,
            staged
          };
        });
      }
    );

    return {
      missingSession: false as const,
      result
    };
  }

  app.post("/v1/uploads/source-audio", async (request, reply) => {
    await refreshStore();
    const part = await request.file();

    if (!part) {
      return reply.code(400).send({ message: "file is required" });
    }

    const sessionId = z.string().min(1).parse(getMultipartFieldValue(part.fields.sessionId));
    let result: Awaited<ReturnType<typeof persistSourceAudio>>;

    try {
      result = await persistSourceAudio({
        sessionId,
        fileName: part.filename || `${sessionId}.m4a`,
        chunks: part.file,
        contentType: part.mimetype || undefined
      });
    } catch (error) {
      return sendSourceAudioUploadError(reply, error);
    }

    if (result.missingSession) {
      return reply.code(404).send({ message: "Session not found" });
    }

    if (result.result.empty) {
      return reply.code(400).send({ message: "Uploaded file is empty" });
    }

    return reply.code(201).send({
      data: buildPortalSourceAudioUpload({
        sessionId,
        fileId: result.result.uploadedFile.fileId,
        fileName: result.result.uploadedFile.fileName,
        byteLength: result.result.staged.byteLength,
        sha256: result.result.staged.sha256,
        createdAt: result.result.uploadedFile.createdAt
      })
    });
  });

  app.post("/v1/uploads/source-audio/raw", async (request, reply) => {
    await refreshStore();
    const query = z
      .object({
        sessionId: z.string().min(1),
        fileName: z.string().min(1).optional()
      })
      .parse(request.query);
    const body = request.body as Readable | undefined;

    if (!body || typeof body[Symbol.asyncIterator] !== "function") {
      return reply.code(400).send({ message: "audio body is required" });
    }

    let result: Awaited<ReturnType<typeof persistSourceAudio>>;

    try {
      result = await persistSourceAudio({
        sessionId: query.sessionId,
        fileName: query.fileName ?? `${query.sessionId}.m4a`,
        chunks: body,
        contentType: request.headers["content-type"]?.split(";")[0]
      });
    } catch (error) {
      return sendSourceAudioUploadError(reply, error);
    }

    if (result.missingSession) {
      return reply.code(404).send({ message: "Session not found" });
    }

    if (result.result.empty) {
      return reply.code(400).send({ message: "Uploaded file is empty" });
    }

    return reply.code(201).send({
      data: buildPortalSourceAudioUpload({
        sessionId: query.sessionId,
        fileId: result.result.uploadedFile.fileId,
        fileName: result.result.uploadedFile.fileName,
        byteLength: result.result.staged.byteLength,
        sha256: result.result.staged.sha256,
        createdAt: result.result.uploadedFile.createdAt
      })
    });
  });

  app.post(
    "/v1/uploads/source-audio/base64",
    {
      bodyLimit: 128 * 1024 * 1024
    },
    async (request, reply) => {
      await refreshStore();
      const body = base64UploadBody.parse(request.body);
      let result: Awaited<ReturnType<typeof persistSourceAudio>>;

      try {
        const buffer = decodeAudioBase64(body.audioBase64);
        result = await persistSourceAudio({
          sessionId: body.sessionId,
          fileName: body.fileName,
          chunks: [buffer],
          contentType: body.contentType
        });
      } catch (error) {
        return sendSourceAudioUploadError(reply, error);
      }

      if (result.missingSession) {
        return reply.code(404).send({ message: "Session not found" });
      }

      if (result.result.empty) {
        return reply.code(400).send({ message: "Uploaded file is empty" });
      }

      return reply.code(201).send({
        data: buildPortalSourceAudioUpload({
          sessionId: body.sessionId,
          fileId: result.result.uploadedFile.fileId,
          fileName: result.result.uploadedFile.fileName,
          byteLength: result.result.staged.byteLength,
          sha256: result.result.staged.sha256,
          createdAt: result.result.uploadedFile.createdAt
        })
      });
    }
  );
};
