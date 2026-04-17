import type { FastifyPluginAsync } from "fastify";

import {
  isInsforgeAdminConfigured,
  isInsforgeConfigured,
  isOpenAIConfigured,
  isSonioxConfigured
} from "../config";
import { getInsforgeRuntimeStatus } from "../lib/insforge";
import { getMailDeliveryStatus } from "../lib/mail-delivery";
import { getPersistenceRuntimeStatus } from "../lib/persistence";
import { getSessionProcessingQueueStatus } from "../lib/queue";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    const queue = await getSessionProcessingQueueStatus();
    const mail = await getMailDeliveryStatus();

    return {
      ok: true,
      service: "api",
      now: new Date().toISOString(),
      providers: {
        sonioxConfigured: isSonioxConfigured(),
        openaiConfigured: isOpenAIConfigured()
      },
      integrations: {
        insforgeConfigured: isInsforgeConfigured(),
        insforgeAdminConfigured: isInsforgeAdminConfigured(),
        insforge: getInsforgeRuntimeStatus()
      },
      mail,
      persistence: getPersistenceRuntimeStatus(),
      queue
    };
  });
};
