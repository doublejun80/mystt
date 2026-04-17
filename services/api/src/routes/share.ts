import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { buildShareEmailDraft, sendShareEmail } from "../lib/share-email";
import {
  getSessionSnapshot,
  listAuditEvents,
  recordAuditEvent,
  refreshStore
} from "../lib/store";

const sendSessionShareEmailBody = z.object({
  to: z.array(z.string().email()).min(1).max(10),
  portalBaseUrl: z.string().url(),
  idempotencyKey: z.string().min(8).max(200),
  includeSummary: z.boolean().default(true),
  includeDetails: z.boolean().default(true),
  includeAudio: z.boolean().default(false)
});

export const shareRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/sessions/:sessionId/share/email", async (request, reply) => {
    await refreshStore();
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const body = sendSessionShareEmailBody.parse(request.body);
    const snapshot = getSessionSnapshot(params.sessionId);

    if (!snapshot) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const duplicate = listAuditEvents({
      sessionId: params.sessionId,
      limit: 200
    }).find(
      (event) =>
        event.kind === "session.share.email.sent" &&
        event.payload.idempotencyKey === body.idempotencyKey
    );

    if (duplicate) {
      return {
        data: {
          sent: true,
          duplicate: true,
          sentAt: duplicate.createdAt
        }
      };
    }

    try {
      const draft = await buildShareEmailDraft({
        snapshot,
        portalBaseUrl: body.portalBaseUrl,
        selection: {
          includeSummary: body.includeSummary,
          includeDetails: body.includeDetails,
          includeAudio: body.includeAudio
        }
      });
      const result = await sendShareEmail({
        to: body.to,
        draft
      });

      await recordAuditEvent({
        sessionId: params.sessionId,
        kind: "session.share.email.sent",
        payload: {
          idempotencyKey: body.idempotencyKey,
          to: body.to,
          includeSummary: body.includeSummary,
          includeDetails: body.includeDetails,
          includeAudio: body.includeAudio,
          messageId: result.messageId,
          attachmentSummary: result.attachmentSummary
        }
      });

      return {
        data: {
          sent: true,
          duplicate: false,
          messageId: result.messageId,
          accepted: result.accepted,
          attachmentSummary: result.attachmentSummary
        }
      };
    } catch (error) {
      await recordAuditEvent({
        sessionId: params.sessionId,
        kind: "session.share.email.failed",
        payload: {
          idempotencyKey: body.idempotencyKey,
          to: body.to,
          includeSummary: body.includeSummary,
          includeDetails: body.includeDetails,
          includeAudio: body.includeAudio,
          message: error instanceof Error ? error.message : "Unknown error"
        }
      });

      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Failed to send share email"
      });
    }
  });
};
