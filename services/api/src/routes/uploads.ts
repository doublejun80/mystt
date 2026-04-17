import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { withStagedSourceAudio } from "../lib/source-audio-upload";
import { uploadSourceAudioFile } from "../lib/soniox";
import {
  getSessionSnapshot,
  recordAuditEvent,
  refreshStore,
  saveSourceAudioFromFile
} from "../lib/store";

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-z0-9._-]+/gi, "-").replace(/-{2,}/g, "-");
}

function getMultipartFieldValue(input: unknown) {
  const field = Array.isArray(input) ? input[0] : input;

  if (!field || typeof field !== "object" || !("value" in field)) {
    return undefined;
  }

  const value = Reflect.get(field, "value");
  return typeof value === "string" ? value : undefined;
}

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/uploads/source-audio", async (request, reply) => {
    await refreshStore();
    const part = await request.file();

    if (!part) {
      return reply.code(400).send({ message: "file is required" });
    }

    const sessionId = z.string().min(1).parse(getMultipartFieldValue(part.fields.sessionId));
    const snapshot = getSessionSnapshot(sessionId);

    if (!snapshot) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const fileName = sanitizeFileName(part.filename || `${sessionId}.m4a`);
    const contentType = part.mimetype || undefined;
    const result = await withStagedSourceAudio(
      {
        sessionId,
        fileName,
        chunks: part.file,
        contentType
      },
      async (staged) => {
        if (staged.byteLength === 0) {
          return {
            empty: true as const
          };
        }

        const location = await saveSourceAudioFromFile({
          sessionId,
          fileName,
          filePath: staged.tempPath,
          byteLength: staged.byteLength,
          sha256: staged.sha256,
          contentType
        });
        const uploadedFile = await uploadSourceAudioFile({
          sessionId,
          fileName,
          filePath: staged.tempPath
        });

        await recordAuditEvent({
          sessionId,
          kind: "source_audio.soniox_uploaded",
          payload: {
            fileId: uploadedFile.fileId,
            location,
            fileName: uploadedFile.fileName,
            byteLength: staged.byteLength,
            sha256: staged.sha256,
            contentType: contentType ?? null
          }
        });

        return {
          empty: false as const,
          location,
          uploadedFile,
          staged
        };
      }
    );

    if (result.empty) {
      return reply.code(400).send({ message: "Uploaded file is empty" });
    }

    return reply.code(201).send({
      data: {
        sessionId,
        fileId: result.uploadedFile.fileId,
        location: result.location,
        fileName: result.uploadedFile.fileName,
        byteLength: result.staged.byteLength,
        sha256: result.staged.sha256,
        createdAt: result.uploadedFile.createdAt
      }
    });
  });
};
