import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { apiConfig, isOpenAIConfigured, isSonioxConfigured } from "../config";
import { getMailDeliveryStatus } from "../lib/mail-delivery";
import { getPersistenceRuntimeStatus } from "../lib/persistence";
import { getSessionProcessingQueueStatus } from "../lib/queue";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    return {
      ok: true,
      service: "api"
    };
  });

  async function buildReadiness(reply?: FastifyReply) {
    const queue = await getSessionProcessingQueueStatus();
    const mail = await getMailDeliveryStatus();
    const persistence = getPersistenceRuntimeStatus();
    const remoteBackendsReady =
      persistence.postgres.mode === "remote" &&
      persistence.minio.mode === "remote" &&
      queue.mode === "remote";
    const providersReady = isSonioxConfigured() && isOpenAIConfigured();
    const ready = apiConfig.MYSTT_REQUIRE_REMOTE_BACKENDS
      ? remoteBackendsReady && providersReady
      : true;

    if (!ready) {
      reply?.code(503);
    }

    return {
      ready,
      queue,
      mail,
      persistence
    };
  }

  app.get("/ready", async (_request, reply) => {
    const readiness = await buildReadiness(reply);

    return {
      ok: readiness.ready,
      service: "api"
    };
  });

  app.get("/v1/diagnostics/ready", async (_request, reply) => {
    const readiness = await buildReadiness(reply);

    return {
      ok: readiness.ready,
      service: "api",
      now: new Date().toISOString(),
      providers: {
        sonioxConfigured: isSonioxConfigured(),
        openaiConfigured: isOpenAIConfigured()
      },
      mail: readiness.mail,
      persistence: readiness.persistence,
      queue: readiness.queue
    };
  });
};
