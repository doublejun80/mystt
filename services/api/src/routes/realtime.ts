import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { transcribeAudioChunk } from "../lib/openai";

const captionChunkBody = z.object({
  sessionId: z.string().min(1),
  chunkId: z.string().min(1),
  mimeType: z.string().min(1),
  audioBase64: z.string().min(16),
  language: z.string().default("ko"),
  prompt: z.string().max(400).optional()
});

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/realtime/caption-chunk", async (request) => {
    const body = captionChunkBody.parse(request.body);
    const audio = Buffer.from(body.audioBase64, "base64");

    const transcription = await transcribeAudioChunk({
      audio,
      mimeType: body.mimeType,
      chunkId: body.chunkId,
      language: body.language,
      prompt: body.prompt
    });

    return {
      data: {
        sessionId: body.sessionId,
        chunkId: body.chunkId,
        ...transcription
      }
    };
  });
};
