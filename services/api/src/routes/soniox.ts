import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { buildCleanupTargets } from "@mystt/soniox-client";

import { getSession } from "../lib/store";
import {
  createAsyncTranscriptionJob,
  createRealtimeTemporaryKey,
  getAsyncTranscription,
  transcriptionSummary
} from "../lib/soniox";
import { saveTranscriptionMetadata, updateSessionStatus } from "../lib/store";

const tempKeyBody = z.object({
  sessionId: z.string().min(1),
  ttlSeconds: z.coerce.number().int().min(60).max(3600).default(900)
});

const createAsyncJobBody = z.object({
  sessionId: z.string().min(1),
  audioUrl: z.string().url().optional(),
  fileId: z.string().optional()
});

export const sonioxRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/soniox/temp-key", async (request) => {
    const body = tempKeyBody.parse(request.body);
    const temporaryKey = await createRealtimeTemporaryKey(body);

    return {
      data: {
        provider: "soniox",
        sessionId: body.sessionId,
        ttlSeconds: body.ttlSeconds,
        issuedAt: new Date().toISOString(),
        expiresAt: temporaryKey.expires_at,
        apiKey: temporaryKey.api_key,
        note: "temporary API key issued"
      }
    };
  });

  app.post("/v1/soniox/async-jobs", async (request, reply) => {
    const body = createAsyncJobBody.parse(request.body);
    const session = getSession(body.sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    await updateSessionStatus(session.id, "transcribing");

    const transcription = await createAsyncTranscriptionJob({
      sessionId: session.id,
      mode: session.mode,
      audioUrl: body.audioUrl,
      fileId: body.fileId,
      languageHints: session.languageHints,
      context: [
        `Project: ${session.projectKey ?? "general"}`,
        `Title: ${session.title}`
      ]
    });
    const summary = transcriptionSummary(transcription);

    await saveTranscriptionMetadata(session.id, {
      transcriptionId: summary.transcriptionId,
      status: summary.status,
      createdAt: summary.createdAt,
      filename: summary.filename,
      audioUrl: summary.audioUrl,
      fileId: summary.fileId,
      cleanupTargets: buildCleanupTargets({
        transcriptionId: summary.transcriptionId,
        fileId: summary.fileId
      }),
      cleanupStatus: "pending",
      cleanupRequestedAt: new Date().toISOString(),
      errorMessage: summary.errorMessage
    });

    return reply.code(201).send({
      data: {
        ...summary,
        cleanupTargets: buildCleanupTargets({
          transcriptionId: summary.transcriptionId,
          fileId: summary.fileId
        })
      }
    });
  });

  app.get("/v1/soniox/async-jobs/:transcriptionId", async (request, reply) => {
    const params = z
      .object({ transcriptionId: z.string().uuid() })
      .parse(request.params);
    const transcription = await getAsyncTranscription(params.transcriptionId);

    if (!transcription) {
      return reply.code(404).send({ message: "Transcription not found" });
    }

    const summary = transcriptionSummary(transcription);
    return {
      data: summary
    };
  });
};
