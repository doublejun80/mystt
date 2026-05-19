import type { FastifyPluginAsync } from "fastify";

import {
  cleanupAsyncTranscriptionResources,
  getAsyncTranscription
} from "../lib/soniox";
import { processSessionVerticalSlice } from "../lib/session-process";
import {
  applySonioxWebhook,
  getSessionIdByTranscriptionId,
  getStoredTranscription
} from "../lib/store";
import { getSonioxClient } from "../lib/providers";
import { recordAuditEvent, saveTranscriptionMetadata } from "../lib/store";
import { transcriptionSummary } from "../lib/soniox";

function isTerminalSonioxStatus(status: string) {
  return status === "completed" || status === "error";
}

function finalizerIdempotencyKey(input: { transcriptionId: string; status: string }) {
  return `soniox:transcription:${input.transcriptionId}:terminal:${input.status}:finalizer`;
}

function finalizerAuditPayload(input: {
  transcriptionId: string;
  status: string;
  duplicate: boolean;
}) {
  return {
    transcriptionId: input.transcriptionId,
    status: input.status,
    idempotencyKey: finalizerIdempotencyKey(input),
    duplicateWebhook: input.duplicate,
    attemptReason: input.duplicate
      ? "duplicate_terminal_webhook_retry"
      : "terminal_webhook"
  };
}

function finalizerSideEffectError(
  result: Awaited<ReturnType<typeof processSessionVerticalSlice>>
) {
  if (
    "finalizerSideEffectsFailed" in result &&
    result.finalizerSideEffectsFailed
  ) {
    return "finalizerSideEffectError" in result
      ? result.finalizerSideEffectError
      : "finalizer_side_effect_failed";
  }

  return undefined;
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/webhooks/soniox", async (request, reply) => {
    const soniox = getSonioxClient();
    const handled = soniox.webhooks.handleFastify(request, soniox.webhooks.getAuthFromEnv());

    if (!handled.ok || !handled.event) {
      return reply.code(handled.status).send({
        message: handled.error ?? "Webhook rejected"
      });
    }

    let transcription: Awaited<ReturnType<typeof getAsyncTranscription>> | undefined;
    let transcriptionLookupError: unknown;

    try {
      transcription = await getAsyncTranscription(handled.event.id);
    } catch (error) {
      transcriptionLookupError = error;
    }

    const storedSessionId = getSessionIdByTranscriptionId(handled.event.id);
    const storedTranscription = storedSessionId
      ? getStoredTranscription(storedSessionId)
      : undefined;
    const webhookSessionId =
      transcription?.client_reference_id ?? storedSessionId ?? undefined;
    const webhookFileId = transcription?.file_id ?? storedTranscription?.fileId;

    if (transcriptionLookupError && !webhookSessionId) {
      throw transcriptionLookupError;
    }

    const body = {
      transcriptionId: handled.event.id,
      sessionId: webhookSessionId,
      status: handled.event.status,
      deliveredAt: new Date().toISOString(),
      fileId: webhookFileId
    } as const;

    const result = await applySonioxWebhook(body);
    const sessionId = transcription?.client_reference_id ?? result.session?.id ?? storedSessionId;

    if (transcriptionLookupError && sessionId) {
      await recordAuditEvent({
        sessionId,
        kind: "soniox.webhook.transcription_lookup_failed",
        payload: {
          transcriptionId: handled.event.id,
          error:
            transcriptionLookupError instanceof Error
              ? transcriptionLookupError.message
              : String(transcriptionLookupError),
          recoveredFromStoredMetadata: Boolean(storedTranscription)
        }
      });
    }

    if (transcription && sessionId) {
      const summary = transcriptionSummary(transcription);
      await saveTranscriptionMetadata(sessionId, {
        transcriptionId: summary.transcriptionId,
        status: summary.status,
        createdAt: summary.createdAt,
        filename: summary.filename,
        audioUrl: summary.audioUrl,
        fileId: summary.fileId,
        errorMessage: summary.errorMessage
      });
    }

    if (isTerminalSonioxStatus(handled.event.status) && sessionId) {
      const auditPayload = finalizerAuditPayload({
        transcriptionId: handled.event.id,
        status: handled.event.status,
        duplicate: result.duplicate
      });

      await recordAuditEvent({
        sessionId,
        kind: "soniox.finalizer.required",
        payload: {
          ...auditPayload,
          reason: "terminal_webhook_without_queue_finalizer"
        }
      });

      if (handled.event.status === "completed") {
        try {
          const processResult = await processSessionVerticalSlice({
            sessionId,
            fileId: webhookFileId,
            wait: true
          });
          const sideEffectError = finalizerSideEffectError(processResult);

          if (sideEffectError) {
            await recordAuditEvent({
              sessionId,
              kind: "soniox.finalizer.failed",
              payload: {
                ...auditPayload,
                error: sideEffectError,
                retryable: true
              }
            });
          } else {
            await recordAuditEvent({
              sessionId,
              kind: "soniox.finalizer.completed",
              payload: auditPayload
            });
          }
        } catch (error) {
          await recordAuditEvent({
            sessionId,
            kind: "soniox.finalizer.failed",
            payload: {
              ...auditPayload,
              error: error instanceof Error ? error.message : String(error),
              retryable: true
            }
          });
        }
      }

      if (handled.event.status === "error" && (transcription || storedTranscription)) {
        try {
          const summary = transcription
            ? transcriptionSummary(transcription)
            : {
                transcriptionId: storedTranscription!.transcriptionId,
                status: storedTranscription!.status,
                createdAt: storedTranscription!.createdAt,
                fileId: storedTranscription!.fileId
              };
          await cleanupAsyncTranscriptionResources({
            transcriptionId: summary.transcriptionId,
            fileId: summary.fileId
          });
          await saveTranscriptionMetadata(sessionId, {
            transcriptionId: summary.transcriptionId,
            status: summary.status,
            createdAt: summary.createdAt,
            cleanupStatus: "completed",
            cleanupCompletedAt: new Date().toISOString(),
            cleanupLastError: undefined
          });
          await recordAuditEvent({
            sessionId,
            kind: "soniox.finalizer.completed",
            payload: auditPayload
          });
        } catch {
          const summary = transcription
            ? transcriptionSummary(transcription)
            : {
                transcriptionId: storedTranscription!.transcriptionId,
                status: storedTranscription!.status,
                createdAt: storedTranscription!.createdAt
              };
          await saveTranscriptionMetadata(sessionId, {
            transcriptionId: summary.transcriptionId,
            status: summary.status,
            createdAt: summary.createdAt,
            cleanupStatus: "failed",
            cleanupLastError: "provider_cleanup_failed"
          });
          await recordAuditEvent({
            sessionId,
            kind: "soniox.finalizer.failed",
            payload: {
              ...auditPayload,
              error: "provider_cleanup_failed",
              retryable: true
            }
          });
        }
      }
    }

    return reply.code(result.duplicate ? 202 : 200).send({
      data: result
    });
  });
};
