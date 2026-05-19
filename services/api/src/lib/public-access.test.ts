import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  registerPublicAccessGuard,
  tokenMatches
} from "./public-access";
import { createOwnerSessionToken, OWNER_SESSION_COOKIE } from "./owner-auth";

describe("public access guard", () => {
  it("fails closed when no owner auth or QA token is configured", async () => {
    const app = Fastify();
    registerPublicAccessGuard(app, {
      getToken: () => undefined,
      getOwnerAuth: () => undefined
    });
    app.get("/v1/sessions", async () => ({ ok: true }));

    const response = await app.inject("/v1/sessions");

    expect(response.statusCode).toBe(401);
  });

  it("allows no-auth mode only when the explicit dev flag is enabled", async () => {
    const previous = process.env.MYSTT_ALLOW_UNAUTHENTICATED_DEV;
    process.env.MYSTT_ALLOW_UNAUTHENTICATED_DEV = "true";
    const { apiConfig } = await import("../config");
    apiConfig.MYSTT_ALLOW_UNAUTHENTICATED_DEV = true;

    try {
      const app = Fastify();
      registerPublicAccessGuard(app, {
        getToken: () => undefined,
        getOwnerAuth: () => undefined
      });
      app.get("/v1/sessions", async () => ({ ok: true }));

      const response = await app.inject("/v1/sessions");

      expect(response.statusCode).toBe(200);
    } finally {
      apiConfig.MYSTT_ALLOW_UNAUTHENTICATED_DEV = false;
      if (previous === undefined) {
        delete process.env.MYSTT_ALLOW_UNAUTHENTICATED_DEV;
      } else {
        process.env.MYSTT_ALLOW_UNAUTHENTICATED_DEV = previous;
      }
    }
  });

  it("rejects API requests without a matching token", async () => {
    const app = Fastify();
    registerPublicAccessGuard(app, {
      getToken: () => "secret"
    });
    app.get("/v1/sessions", async () => ({ ok: true }));

    const response = await app.inject("/v1/sessions");

    expect(response.statusCode).toBe(401);
  });

  it("accepts QA token headers and cookies", async () => {
    const app = Fastify();
    registerPublicAccessGuard(app, {
      getToken: () => "secret"
    });
    app.get("/v1/sessions", async () => ({ ok: true }));

    const headerResponse = await app.inject({
      url: "/v1/sessions",
      headers: {
        "x-mystt-qa-token": "secret"
      }
    });
    const cookieResponse = await app.inject({
      url: "/v1/sessions",
      headers: {
        cookie: "mystt_qa_token=secret"
      }
    });

    expect(headerResponse.statusCode).toBe(200);
    expect(cookieResponse.statusCode).toBe(200);
  });

  it("accepts signed owner session cookies when owner auth is configured", async () => {
    const app = Fastify();
    const token = createOwnerSessionToken({
      secret: "session-secret",
      nowMs: 1_000,
      ttlSeconds: 60
    });
    registerPublicAccessGuard(app, {
      getOwnerAuth: () => ({
        email: "owner@example.com",
        password: "owner-password",
        secret: "session-secret",
        ttlSeconds: 60
      }),
      nowMs: () => 30_000
    });
    app.get("/v1/sessions", async () => ({ ok: true }));

    const response = await app.inject({
      url: "/v1/sessions",
      headers: {
        cookie: `${OWNER_SESSION_COOKIE}=${encodeURIComponent(token)}`
      }
    });

    expect(response.statusCode).toBe(200);
  });

  it("keeps health and Soniox webhook routes externally reachable", async () => {
    const app = Fastify();
    registerPublicAccessGuard(app, {
      getToken: () => "secret"
    });
    app.get("/health", async () => ({ ok: true }));
    app.post("/v1/webhooks/soniox", async () => ({ ok: true }));

    const healthResponse = await app.inject("/health");
    const webhookResponse = await app.inject({
      method: "POST",
      url: "/v1/webhooks/soniox"
    });

    expect(healthResponse.statusCode).toBe(200);
    expect(webhookResponse.statusCode).toBe(200);
  });

  it("compares tokens without accepting prefixes", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secret", "secret-extra")).toBe(false);
    expect(tokenMatches("secret", "sec")).toBe(false);
  });
});
