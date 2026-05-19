import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configMock = vi.hoisted(() => ({
  apiConfig: {
    MYSTT_REQUIRE_REMOTE_BACKENDS: false
  },
  backendMode: {
    minio: "remote" as "remote" | "local-fallback"
  }
}));

vi.mock("../config", () => ({
  apiConfig: configMock.apiConfig,
  isOpenAIConfigured: () => true,
  isSonioxConfigured: () => true
}));

vi.mock("../lib/mail-delivery", () => ({
  getMailDeliveryStatus: async () => ({
    configured: true,
    requestedMode: "mailapp",
    resolvedMode: "mailapp"
  })
}));

vi.mock("../lib/persistence", () => ({
  getPersistenceRuntimeStatus: () => ({
    postgres: {
      configured: true,
      mode: "remote",
      lastLoadOk: true,
      lastWriteOk: true,
      lastReadOk: true
    },
    minio: {
      configured: true,
      mode: configMock.backendMode.minio,
      lastLoadOk: true,
      lastWriteOk: true,
      lastReadOk: true
    },
    paths: {
      dataRoot: "/tmp/.data",
      stateFile: "/tmp/.data/api-state.json",
      auditLogFile: "/tmp/.data/audit-events.ndjson",
      artifactRoot: "/tmp/.data/artifacts/sessions",
      audioRoot: "/tmp/.data/audio/sessions"
    }
  })
}));

vi.mock("../lib/queue", () => ({
  getSessionProcessingQueueStatus: async () => ({
    configured: true,
    mode: "remote",
    depth: 0,
    lastEnqueueOk: true,
    lastDepthOk: true
  })
}));

import { healthRoutes } from "./health";

describe("health routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    configMock.apiConfig.MYSTT_REQUIRE_REMOTE_BACKENDS = false;
    configMock.backendMode.minio = "remote";
    app = Fastify();
    await app.register(healthRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("keeps /health minimal for public liveness", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "api"
    });
  });

  it("keeps /ready minimal for public readiness", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/ready"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "api"
    });
  });

  it("reports detailed readiness on the authenticated diagnostics path", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/diagnostics/ready"
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json();

    expect(payload).toMatchObject({
      ok: true,
      service: "api",
      providers: expect.any(Object),
      persistence: {
        postgres: expect.any(Object),
        minio: expect.any(Object),
        paths: expect.any(Object)
      },
      queue: expect.any(Object)
    });
    expect(payload).not.toHaveProperty("integrations");
  });

  it("fails readiness when remote backends are required but unavailable", async () => {
    configMock.apiConfig.MYSTT_REQUIRE_REMOTE_BACKENDS = true;
    configMock.backendMode.minio = "local-fallback";
    const response = await app.inject({
      method: "GET",
      url: "/v1/diagnostics/ready"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      persistence: {
        minio: {
          mode: "local-fallback"
        }
      }
    });
  });
});
