import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { getNotesPrompt, getResponseShape } from "@mystt/notes-schema";
import { sessionModes } from "@mystt/audio-core";
import { normalizeSonioxTranscript } from "@mystt/transcript-normalizer";

import { apiConfig } from "../config";
import { generateStructuredNotes } from "../lib/openai";
import {
  getSession,
  getSessionIdByTranscriptionId,
  getSessionSnapshot,
  refreshStore,
  saveNormalizedTranscript,
  saveStructuredNotes,
  updateSessionStatus
} from "../lib/store";
import { convertTranscriptToPackageShape, getAsyncTranscript } from "../lib/soniox";

const previewBody = z.object({
  mode: z.enum(sessionModes),
  transcript: z.string().min(20),
  title: z.string().optional()
});

const generateBody = z
  .object({
    sessionId: z.string().optional(),
    transcriptionId: z.string().uuid().optional(),
    mode: z.enum(sessionModes).optional(),
    transcript: z.string().min(20).optional()
  })
  .refine(
    (value) => Boolean(value.transcriptionId || value.transcript),
    "transcriptionId or transcript is required"
  );

export const notesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/notes/preview", async (request) => {
    const body = previewBody.parse(request.body);
    const notes = await generateStructuredNotes({
      mode: body.mode,
      transcript: body.transcript,
      sessionTitle: body.title
    });

    return {
      data: {
        model: apiConfig.OPENAI_MODEL,
        prompt: getNotesPrompt(body.mode),
        responseShape: getResponseShape(body.mode),
        transcriptPreview: body.transcript.slice(0, 400),
        notes
      }
    };
  });

  app.post("/v1/notes/generate", async (request, reply) => {
    await refreshStore();
    const body = generateBody.parse(request.body);

    const resolvedSessionId =
      body.sessionId ??
      (body.transcriptionId
        ? getSessionIdByTranscriptionId(body.transcriptionId)
        : undefined);

    if (resolvedSessionId && body.transcript && !body.transcriptionId) {
      return reply.code(400).send({
        message:
          "session-backed final notes must be generated from Soniox transcription output"
      });
    }

    const session = resolvedSessionId ? getSession(resolvedSessionId) : undefined;
    const mode = body.mode ?? session?.mode;

    if (!mode) {
      return reply.code(400).send({ message: "mode is required when sessionId is unknown" });
    }

    let transcriptText = body.transcript;

    if (body.transcriptionId) {
      const transcript = await getAsyncTranscript(body.transcriptionId);

      if (!transcript) {
        return reply.code(404).send({ message: "Transcript not found" });
      }

      if (resolvedSessionId) {
        const packageShape = convertTranscriptToPackageShape(resolvedSessionId, transcript);
        const normalized = normalizeSonioxTranscript({
          mode,
          transcript: packageShape
        });
        await saveNormalizedTranscript(resolvedSessionId, {
          rawTranscript: packageShape,
          normalizedTranscript: normalized
        });
        transcriptText = normalized.text;
      } else {
        transcriptText = transcript.text;
      }
    }

    if (!transcriptText) {
      return reply.code(400).send({ message: "Transcript text could not be resolved" });
    }

    const notes = await generateStructuredNotes({
      mode,
      transcript: transcriptText,
      sessionTitle: session?.title
    });

    if (resolvedSessionId) {
      await saveStructuredNotes(resolvedSessionId, {
        model: apiConfig.OPENAI_MODEL,
        notes
      });
      await updateSessionStatus(resolvedSessionId, "completed");
    }

    return {
      data: resolvedSessionId ? getSessionSnapshot(resolvedSessionId) : { notes }
    };
  });
};
