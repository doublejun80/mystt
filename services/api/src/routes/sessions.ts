import { basename } from "node:path";

import type { FastifyPluginAsync } from "fastify";
import { artifactKinds, sessionModes } from "@mystt/audio-core";
import { z } from "zod";

import {
  readPersistedArtifact,
  readPersistedArtifactBuffer
} from "../lib/persistence";
import {
  processSessionVerticalSlice,
  waitForTerminalSessionSnapshot
} from "../lib/session-process";
import { enqueueSessionProcessingJob } from "../lib/queue";
import {
  cleanupAsyncTranscriptionResources
} from "../lib/soniox";
import {
  createSession,
  deleteSession,
  getStoredTranscription,
  getSessionSnapshot,
  listAuditEvents,
  listSessions,
  recordAuditEvent,
  saveTranscriptionMetadata,
  refreshStore
} from "../lib/store";

const createSessionBody = z.object({
  title: z.string().min(1),
  mode: z.enum(sessionModes),
  projectKey: z.string().optional(),
  languageHints: z.array(z.string().min(2)).max(8).optional(),
  realtimeOptions: z
    .object({
      enableMixedLanguage: z.boolean(),
      enableSpeakerDiarization: z.boolean(),
      highlightLowConfidence: z.boolean(),
      enableLiveTranslation: z.boolean(),
      endpointDelayMs: z.number().int().min(500).max(5_000).optional(),
      contextTerms: z.array(z.string().min(1)).max(64).optional(),
      inputDeviceLabel: z.string().nullable().optional()
    })
    .optional()
});

const processSessionBody = z
  .object({
    audioUrl: z.string().url().optional(),
    fileId: z.string().uuid().optional(),
    wait: z.boolean().optional().default(true),
    pollIntervalMs: z.number().int().min(500).max(10_000).optional(),
    timeoutMs: z.number().int().min(5_000).max(600_000).optional()
  })
  .refine((value) => Boolean(value.audioUrl || value.fileId), {
    message: "audioUrl or fileId is required"
  });

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  function guessAudioContentType(fileName: string) {
    const normalized = fileName.toLowerCase();

    if (normalized.endsWith(".mp3")) {
      return "audio/mpeg";
    }

    if (normalized.endsWith(".wav")) {
      return "audio/wav";
    }

    if (normalized.endsWith(".m4a") || normalized.endsWith(".mp4")) {
      return "audio/mp4";
    }

    return "application/octet-stream";
  }

  app.get("/v1/sessions", async () => {
    await refreshStore();
    const snapshots = listSessions();

    return {
      data: snapshots.map((snapshot) => snapshot.session),
      snapshots
    };
  });

  app.get("/v1/sessions/:sessionId", async (request, reply) => {
    await refreshStore();
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const session = getSessionSnapshot(params.sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return {
      data: session.session,
      snapshot: session
    };
  });

  app.get("/v1/sessions/:sessionId/audit-events", async (request, reply) => {
    await refreshStore();
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).optional()
      })
      .parse(request.query);
    const session = getSessionSnapshot(params.sessionId);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return {
      data: listAuditEvents({
        sessionId: params.sessionId,
        limit: query.limit ?? 100
      })
    };
  });

  app.delete("/v1/sessions/:sessionId", async (request, reply) => {
    await refreshStore();
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const deleted = await deleteSession(params.sessionId);

    if (!deleted) {
      return reply.code(404).send({ message: "Session not found" });
    }

    return reply.code(204).send();
  });

  app.post("/v1/sessions", async (request, reply) => {
    const body = createSessionBody.parse(request.body);
    const session = await createSession(body);

    return reply.code(201).send({
      data: session
    });
  });

  app.post("/v1/sessions/:sessionId/process", async (request, reply) => {
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const body = processSessionBody.parse(request.body);
    await refreshStore();

    const existing = getSessionSnapshot(params.sessionId);

    if (!existing) {
      return reply.code(404).send({ message: "Session not found" });
    }

    try {
      const enqueueResult = await enqueueSessionProcessingJob({
        sessionId: params.sessionId,
        audioUrl: body.audioUrl,
        fileId: body.fileId,
        pollIntervalMs: body.pollIntervalMs,
        timeoutMs: body.timeoutMs
      });

      if (enqueueResult.enqueued && enqueueResult.job) {
        await recordAuditEvent({
          sessionId: params.sessionId,
          kind: "session.process.enqueued",
          payload: {
            jobId: enqueueResult.job.jobId,
            queueDepth: enqueueResult.depth ?? null,
            source: body.audioUrl ? "audio_url" : "file_id"
          }
        });

        if (!body.wait) {
          await refreshStore();
          return reply.code(202).send({
            data: getSessionSnapshot(params.sessionId),
            queued: true
          });
        }

        const waited = await waitForTerminalSessionSnapshot({
          sessionId: params.sessionId,
          pollIntervalMs: body.pollIntervalMs,
          timeoutMs: body.timeoutMs
        });

        return reply.code(waited.timedOut ? 202 : 200).send({
          data: waited.snapshot,
          queued: true,
          timedOut: waited.timedOut
        });
      }

      await recordAuditEvent({
        sessionId: params.sessionId,
        kind: "session.process.inline_fallback",
        payload: {
          source: body.audioUrl ? "audio_url" : "file_id"
        }
      });

      const result = await processSessionVerticalSlice({
        sessionId: params.sessionId,
        ...body
      });

      return reply.code(result.accepted ? 202 : 200).send({
        data: result.snapshot
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Failed to process session"
      });
    }
  });

  app.post("/v1/sessions/:sessionId/cleanup/soniox", async (request, reply) => {
    await refreshStore();
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const snapshot = getSessionSnapshot(params.sessionId);

    if (!snapshot) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const transcription = getStoredTranscription(params.sessionId);

    if (!transcription) {
      return reply.code(404).send({ message: "Transcription metadata not found" });
    }

    if (transcription.status !== "completed" && transcription.status !== "error") {
      return reply.code(409).send({
        message: "Cleanup is only allowed after transcription reaches completed or error status"
      });
    }

    try {
      const result = await cleanupAsyncTranscriptionResources({
        transcriptionId: transcription.transcriptionId,
        fileId: transcription.fileId
      });

      await saveTranscriptionMetadata(params.sessionId, {
        transcriptionId: transcription.transcriptionId,
        status: transcription.status,
        createdAt: transcription.createdAt,
        cleanupStatus: "completed",
        cleanupCompletedAt: new Date().toISOString(),
        cleanupLastError: undefined
      });

      await refreshStore();
      return {
        data: getSessionSnapshot(params.sessionId),
        cleanup: result
      };
    } catch (error) {
      await saveTranscriptionMetadata(params.sessionId, {
        transcriptionId: transcription.transcriptionId,
        status: transcription.status,
        createdAt: transcription.createdAt,
        cleanupStatus: "failed",
        cleanupLastError: error instanceof Error ? error.message : String(error)
      });
      await refreshStore();
      return reply.code(500).send({
        message: error instanceof Error ? error.message : "Cleanup failed",
        data: getSessionSnapshot(params.sessionId)
      });
    }
  });

  app.get("/v1/sessions/:sessionId/artifacts/:kind", async (request, reply) => {
    await refreshStore();
    const params = z
      .object({
        sessionId: z.string().min(1),
        kind: z.enum(artifactKinds)
      })
      .parse(request.params);
    const snapshot = getSessionSnapshot(params.sessionId);

    if (!snapshot) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const artifact = snapshot.session.artifacts.find((item) => item.kind === params.kind);

    if (!artifact?.location) {
      return reply.code(404).send({ message: "Artifact not found" });
    }

    if (params.kind.endsWith("_docx")) {
      return reply
        .type("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        .send(await readPersistedArtifactBuffer(artifact.location));
    }

    const content = await readPersistedArtifact(artifact.location);

    if (params.kind.endsWith("_json")) {
      return reply.type("application/json").send(JSON.parse(content));
    }

    if (params.kind.endsWith("_html")) {
      return reply.type("text/html; charset=utf-8").send(content);
    }

    return reply.type("text/plain; charset=utf-8").send(content);
  });

  app.get("/v1/sessions/:sessionId/source-audio", async (request, reply) => {
    await refreshStore();
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const query = z
      .object({
        inline: z.string().optional()
      })
      .parse(request.query ?? {});
    const snapshot = getSessionSnapshot(params.sessionId);

    if (!snapshot) {
      return reply.code(404).send({ message: "Session not found" });
    }

    if (!snapshot.session.localAudioPath) {
      return reply.code(404).send({ message: "Source audio not found" });
    }

    const fileName = basename(snapshot.session.localAudioPath);
    let buffer: Buffer;

    try {
      buffer = await readPersistedArtifactBuffer(snapshot.session.localAudioPath);
    } catch {
      return reply.code(404).send({ message: "Source audio not available yet" });
    }

    const inline = query.inline === "1" || query.inline === "true";

    return reply
      .header(
        "content-disposition",
        `${inline ? "inline" : "attachment"}; filename="${fileName}"`
      )
      .type(guessAudioContentType(fileName))
      .send(buffer);
  });
};
