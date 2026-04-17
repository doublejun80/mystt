import type { FastifyPluginAsync } from "fastify";

import { getAsyncTranscription } from "../lib/soniox";
import { applySonioxWebhook } from "../lib/store";
import { getSonioxClient } from "../lib/providers";
import { saveTranscriptionMetadata } from "../lib/store";
import { transcriptionSummary } from "../lib/soniox";

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/webhooks/soniox", async (request, reply) => {
    const soniox = getSonioxClient();
    const handled = soniox.webhooks.handleFastify(request, soniox.webhooks.getAuthFromEnv());

    if (!handled.ok || !handled.event) {
      return reply.code(handled.status).send({
        message: handled.error ?? "Webhook rejected"
      });
    }

    const body = {
      transcriptionId: handled.event.id,
      status: handled.event.status,
      deliveredAt: new Date().toISOString()
    } as const;

    const result = await applySonioxWebhook(body);

    const transcription = await getAsyncTranscription(handled.event.id);

    if (transcription?.client_reference_id) {
      const summary = transcriptionSummary(transcription);
      await saveTranscriptionMetadata(transcription.client_reference_id, {
        transcriptionId: summary.transcriptionId,
        status: summary.status,
        createdAt: summary.createdAt,
        filename: summary.filename,
        audioUrl: summary.audioUrl,
        fileId: summary.fileId,
        errorMessage: summary.errorMessage
      });
    }

    return reply.code(result.duplicate ? 202 : 200).send({
      data: result
    });
  });
};
