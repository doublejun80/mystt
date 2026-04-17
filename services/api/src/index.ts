import { apiConfig } from "./config";
import { buildApp } from "./app";

const app = await buildApp();

try {
  await app.listen({
    host: "0.0.0.0",
    port: apiConfig.API_PORT
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

