import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { isOpenAIConfigured, isSonioxConfigured } from "../config";
import { getMailDeliveryStatus, sendMailMessage } from "../lib/mail-delivery";
import { checkOpenAIConnectivity } from "../lib/openai";
import { getProviderChecks, refreshStore, updateProviderCheck } from "../lib/store";
import { createRealtimeTemporaryKey } from "../lib/soniox";

export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/system/providers", async () => {
    await refreshStore();

    return {
      data: getProviderChecks()
    };
  });

  app.post("/v1/system/providers/check", async () => {
    const checks = {
      soniox: {
        configured: isSonioxConfigured(),
        ok: null as boolean | null,
        checkedAt: new Date().toISOString(),
        detail: "Not configured"
      },
      openai: {
        configured: isOpenAIConfigured(),
        ok: null as boolean | null,
        checkedAt: new Date().toISOString(),
        detail: "Not configured"
      }
    };

    if (isSonioxConfigured()) {
      try {
        const temporaryKey = await createRealtimeTemporaryKey({
          sessionId: "system-check",
          ttlSeconds: 60
        });

        checks.soniox = {
          configured: true,
          ok: true,
          checkedAt: new Date().toISOString(),
          detail: `expires_at=${temporaryKey.expires_at}`
        };
      } catch (error) {
        checks.soniox = {
          configured: true,
          ok: false,
          checkedAt: new Date().toISOString(),
          detail: error instanceof Error ? error.message : "Soniox check failed"
        };
      }
    }

    if (isOpenAIConfigured()) {
      try {
        const result = await checkOpenAIConnectivity();
        checks.openai = {
          configured: true,
          ok: result.ok,
          checkedAt: result.checkedAt,
          detail: result.detail
        };
      } catch (error) {
        checks.openai = {
          configured: true,
          ok: false,
          checkedAt: new Date().toISOString(),
          detail: error instanceof Error ? error.message : "OpenAI check failed"
        };
      }
    }

    await updateProviderCheck("soniox", checks.soniox);
    await updateProviderCheck("openai", checks.openai);

    return {
      data: checks
    };
  });

  app.get("/v1/system/mail", async () => {
    return {
      data: await getMailDeliveryStatus()
    };
  });

  app.post("/v1/system/mail/check", async (request) => {
    const body = z
      .object({
        to: z.array(z.string().email()).min(1),
        subject: z.string().min(1).default("[mystt] mail check"),
        text: z
          .string()
          .min(1)
          .default("mystt 실제 메일 발송 점검입니다.")
      })
      .parse(request.body);

    const result = await sendMailMessage({
      to: body.to,
      subject: body.subject,
      text: body.text,
      html: `<p>${body.text}</p>`
    });

    return {
      data: result
    };
  });
};
