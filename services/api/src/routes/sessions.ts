import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

import type { FastifyPluginAsync } from "fastify";
import { artifactKinds, sessionModes } from "@mystt/audio-core";
import { z } from "zod";

import {
  renderCleanTranscriptMarkdown,
  renderEmailPreviewHtml,
  renderSessionNotesDocx,
  renderSessionNotesHtml
} from "../lib/artifacts";
import {
  readPersistedArtifact,
  readPersistedArtifactBuffer
} from "../lib/persistence";
import {
  processSessionVerticalSlice,
  waitForTerminalSessionSnapshot
} from "../lib/session-process";
import {
  enqueueSessionProcessingJob,
  removeQueuedSessionProcessingJob
} from "../lib/queue";
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
  updateSessionTitle,
  updateSessionStatus,
  saveTranscriptionMetadata,
  refreshStore
} from "../lib/store";
import {
  buildPortalAuditEvent,
  buildPortalSessionRecord,
  buildPortalSessionSnapshot
} from "../lib/session-presenters";

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

const failSessionBody = z.object({
  reason: z.string().min(1).max(2_000),
  phase: z.string().min(1).max(120).optional()
});
const updateSessionBody = z.object({
  title: z.string().trim().min(1).max(140)
});

const execFileAsync = promisify(execFile);

function sanitizeDownloadFileStem(value: string) {
  return (
    value
      .trim()
      .replace(/[^\w.\-가-힣]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "mystt-recording"
  );
}

function buildSessionAudioDownloadFileName(input: {
  title: string;
  sourceFileName: string;
  format?: "original" | "mp3";
}) {
  if (input.format === "mp3") {
    return `${sanitizeDownloadFileStem(input.title)}.mp3`;
  }

  const extension = extname(input.sourceFileName) || ".audio";
  return `${sanitizeDownloadFileStem(input.title)}${extension}`;
}

function sanitizeAsciiDownloadFileName(value: string) {
  const sourceExtension = extname(value);
  const extension = sourceExtension.replace(/[^A-Za-z0-9.]/g, "") || ".audio";
  const stem = sourceExtension ? value.slice(0, -sourceExtension.length) : value;
  const asciiStem = stem
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${asciiStem || "mystt-recording"}${extension}`;
}

function encodeContentDispositionFileName(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildContentDispositionHeader(input: {
  disposition: "attachment" | "inline";
  fileName: string;
}) {
  const asciiFileName = sanitizeAsciiDownloadFileName(input.fileName);
  const needsUtf8FileName = asciiFileName !== input.fileName;

  if (!needsUtf8FileName) {
    return `${input.disposition}; filename="${asciiFileName}"`;
  }

  return `${input.disposition}; filename="${asciiFileName}"; filename*=UTF-8''${encodeContentDispositionFileName(input.fileName)}`;
}

async function transcodeAudioBufferToMp3(input: {
  buffer: Buffer;
  fileName: string;
}) {
  if (extname(input.fileName).toLowerCase() === ".mp3") {
    return input.buffer;
  }

  const sourceExtension = extname(input.fileName) || ".audio";
  const tempBaseName = `mystt-source-audio-${randomUUID()}`;
  const inputPath = join(tmpdir(), `${tempBaseName}-input${sourceExtension}`);
  const outputPath = join(tmpdir(), `${tempBaseName}-output.mp3`);

  try {
    await fs.writeFile(inputPath, input.buffer);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "2",
      outputPath
    ]);

    return await fs.readFile(outputPath);
  } catch {
    throw new Error("mp3 변환 실패");
  } finally {
    await Promise.all([
      fs.rm(inputPath, { force: true }).catch(() => undefined),
      fs.rm(outputPath, { force: true }).catch(() => undefined)
    ]);
  }
}

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  function buildPortalSnapshotData(snapshot: ReturnType<typeof getSessionSnapshot>) {
    return snapshot ? buildPortalSessionSnapshot(snapshot) : snapshot;
  }

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
      data: snapshots.map((snapshot) => buildPortalSessionRecord(snapshot.session)),
      snapshots: snapshots.map((snapshot) => buildPortalSessionSnapshot(snapshot))
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
      data: buildPortalSessionRecord(session.session),
      snapshot: buildPortalSessionSnapshot(session)
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
      }).map(buildPortalAuditEvent)
    };
  });

  app.delete("/v1/sessions/:sessionId", async (request, reply) => {
    await refreshStore();
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    await deleteSession(params.sessionId);

    return reply.code(204).send();
  });

  app.patch("/v1/sessions/:sessionId", async (request, reply) => {
    await refreshStore();
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const bodyResult = updateSessionBody.safeParse(request.body);

    if (!bodyResult.success) {
      return reply.code(400).send({
        message: "Title must be 1-140 characters"
      });
    }

    const body = bodyResult.data;
    const session = await updateSessionTitle(params.sessionId, body.title);

    if (!session) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const snapshot = getSessionSnapshot(params.sessionId);

    return reply.send({
      data: buildPortalSessionRecord(session),
      ...(snapshot ? { snapshot: buildPortalSessionSnapshot(snapshot) } : {})
    });
  });

  app.post("/v1/sessions", async (request, reply) => {
    const body = createSessionBody.parse(request.body);
    const session = await createSession(body);

    return reply.code(201).send({
      data: session
    });
  });

  app.post("/v1/sessions/:sessionId/fail", async (request, reply) => {
    await refreshStore();
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const body = failSessionBody.parse(request.body);
    const existing = getSessionSnapshot(params.sessionId);

    if (!existing) {
      return reply.code(404).send({ message: "Session not found" });
    }

    await recordAuditEvent({
      sessionId: params.sessionId,
      kind: "client.session.failed",
      payload: {
        reason: body.reason,
        phase: body.phase ?? null
      }
    });
    const session = await updateSessionStatus(params.sessionId, "failed");

    return reply.send({
      data: buildPortalSessionRecord(session ?? existing.session)
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

	      if (enqueueResult.duplicate && enqueueResult.job) {
	        await recordAuditEvent({
	          sessionId: params.sessionId,
	          kind: "session.process.duplicate_suppressed",
	          payload: {
	            jobId: enqueueResult.job.jobId,
	            queueDepth: enqueueResult.depth ?? null,
	            source: body.audioUrl ? "audio_url" : "file_id"
	          }
	        });

	        if (!body.wait) {
	          await refreshStore();
	          return reply.code(202).send({
	            data: buildPortalSnapshotData(getSessionSnapshot(params.sessionId)),
	            queued: true,
	            duplicate: true
	          });
	        }

	        const waited = await waitForTerminalSessionSnapshot({
	          sessionId: params.sessionId,
	          pollIntervalMs: body.pollIntervalMs,
	          timeoutMs: Math.min(body.timeoutMs ?? 180_000, 15_000)
	        });

	        return reply.code(waited.timedOut ? 202 : 200).send({
	          data: buildPortalSnapshotData(waited.snapshot),
	          queued: true,
	          duplicate: true,
	          timedOut: waited.timedOut
	        });
	      }

	      if (enqueueResult.enqueued && enqueueResult.job) {
        await updateSessionStatus(params.sessionId, "transcribing");
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
            data: buildPortalSnapshotData(getSessionSnapshot(params.sessionId)),
            queued: true
          });
        }

        const waited = await waitForTerminalSessionSnapshot({
          sessionId: params.sessionId,
          pollIntervalMs: body.pollIntervalMs,
          timeoutMs: Math.min(body.timeoutMs ?? 180_000, 15_000)
        });

        if (waited.timedOut) {
          const removedQueuedJob = await removeQueuedSessionProcessingJob({
            job: enqueueResult.job
          });

          if (removedQueuedJob) {
            await recordAuditEvent({
              sessionId: params.sessionId,
              kind: "session.process.queue_timeout_inline_fallback",
              payload: {
                jobId: enqueueResult.job.jobId
              }
            });

            const result = await processSessionVerticalSlice({
              sessionId: params.sessionId,
              ...body
            });

            return reply.code(result.accepted ? 202 : 200).send({
              data: buildPortalSnapshotData(result.snapshot),
              queued: true,
              timedOut: true,
              rescuedInline: true
            });
          }

          await recordAuditEvent({
            sessionId: params.sessionId,
            kind: "session.process.queue_timeout_still_claimed",
            payload: {
              jobId: enqueueResult.job.jobId
            }
          });
        }

        return reply.code(waited.timedOut ? 202 : 200).send({
          data: buildPortalSnapshotData(waited.snapshot),
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
        data: buildPortalSnapshotData(result.snapshot)
      });
    } catch (error) {
      app.log.warn(
        {
          err: error,
          sessionId: params.sessionId
        },
        "Session processing failed"
      );
      return reply.code(503).send({
        message: "Session processing failed; retry later",
        retryable: true
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

    if (transcription.cleanupStatus === "completed") {
      return {
        data: buildPortalSnapshotData(snapshot),
        cleanup: {
          skipped: true,
          reason: "already_completed"
        }
      };
    }

    try {
      await cleanupAsyncTranscriptionResources({
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
        data: buildPortalSnapshotData(getSessionSnapshot(params.sessionId)),
        cleanup: {
          completed: true
        }
      };
    } catch (error) {
      app.log.warn(
        {
          err: error,
          sessionId: params.sessionId
        },
        "Soniox cleanup failed"
      );
      await saveTranscriptionMetadata(params.sessionId, {
        transcriptionId: transcription.transcriptionId,
        status: transcription.status,
        createdAt: transcription.createdAt,
        cleanupStatus: "failed",
        cleanupLastError: "provider_cleanup_failed"
      });
      await refreshStore();
      return reply.code(502).send({
        message: "Soniox cleanup failed; retry later",
        data: buildPortalSnapshotData(getSessionSnapshot(params.sessionId))
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

    if (params.kind === "clean_transcript_md" && snapshot.normalizedTranscript) {
      return reply.type("text/plain; charset=utf-8").send(
        renderCleanTranscriptMarkdown({
          session: snapshot.session,
          transcript: snapshot.normalizedTranscript
        })
      );
    }

    if (snapshot.notes?.notes) {
      if (params.kind === "meeting_notes_html") {
        return reply
          .type("text/html; charset=utf-8")
          .send(
            renderSessionNotesHtml({
              session: snapshot.session,
              notes: snapshot.notes.notes
            })
          );
      }

      if (params.kind === "email_preview_html") {
        return reply
          .type("text/html; charset=utf-8")
          .send(
            renderEmailPreviewHtml({
              session: snapshot.session,
              notes: snapshot.notes.notes
            })
          );
      }

      if (params.kind === "meeting_notes_docx") {
        return reply
          .type("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
          .send(
            await renderSessionNotesDocx({
              session: snapshot.session,
              notes: snapshot.notes.notes
            })
          );
      }
    }

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
        inline: z.string().optional(),
        format: z.enum(["original", "mp3"]).optional()
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
    const outputFileName =
      inline
        ? fileName
        : buildSessionAudioDownloadFileName({
            title: snapshot.session.title,
            sourceFileName: fileName,
            format: query.format
          });
    const outputContentType =
      query.format === "mp3" ? "audio/mpeg" : guessAudioContentType(fileName);
    let outputBuffer: Buffer;

    try {
      outputBuffer =
        query.format === "mp3"
          ? await transcodeAudioBufferToMp3({ buffer, fileName })
          : buffer;
    } catch (error) {
      app.log.warn(
        {
          err: error,
          sessionId: params.sessionId
        },
        "Source audio mp3 conversion failed"
      );
      return reply.code(503).send({
        message: "Source audio conversion failed; retry later",
        retryable: true
      });
    }

    return reply
      .header(
        "content-disposition",
        buildContentDispositionHeader({
          disposition: inline ? "inline" : "attachment",
          fileName: outputFileName
        })
      )
      .type(outputContentType)
      .send(outputBuffer);
  });
};
