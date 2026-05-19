import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";

import { initializeStore } from "./lib/store";
import { registerPublicAccessGuard } from "./lib/public-access";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { notesRoutes } from "./routes/notes";
import { realtimeRoutes } from "./routes/realtime";
import { shareRoutes } from "./routes/share";
import { sessionRoutes } from "./routes/sessions";
import { sonioxRoutes } from "./routes/soniox";
import { systemRoutes } from "./routes/system";
import { uploadRoutes } from "./routes/uploads";
import { webhookRoutes } from "./routes/webhooks";

export async function buildApp() {
  const app = Fastify({
    logger: true
  });

  await initializeStore();

  await app.register(cors, {
    origin: true
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 512 * 1024 * 1024
    }
  });
  registerPublicAccessGuard(app);

  await app.register(authRoutes);
  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(uploadRoutes);
  await app.register(systemRoutes);
  await app.register(sonioxRoutes);
  await app.register(realtimeRoutes);
  await app.register(shareRoutes);
  await app.register(notesRoutes);
  await app.register(webhookRoutes);

  return app;
}
