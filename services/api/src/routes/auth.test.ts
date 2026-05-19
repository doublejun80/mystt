import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OWNER_SESSION_COOKIE } from "../lib/owner-auth";
import { authRoutes } from "./auth";

describe("auth routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(authRoutes, {
      getOwnerAuth: () => ({
        email: "owner@example.com",
        password: "owner-password",
        secret: "session-secret",
        ttlSeconds: 60
      }),
      nowMs: () => 1_000
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects login when the owner email or password is wrong", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "wrong"
      }
    });
    const wrongEmailResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "other@example.com",
        password: "owner-password"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(wrongEmailResponse.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ message: "Invalid email or password" });
  });

  it("sets an httpOnly owner session cookie and returns a bearer token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "owner-password"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      authenticated: true,
      tokenType: "Bearer",
      expiresAt: expect.any(String)
    });
    expect(response.json().token).toEqual(expect.any(String));
    expect(response.headers["set-cookie"]).toContain(`${OWNER_SESSION_COOKIE}=`);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
  });

  it("marks public owner session cookies secure when forwarded from a public host", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: {
        host: "mystt.doublejun.digital"
      },
      payload: {
        email: "owner@example.com",
        password: "owner-password"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("Secure");
  });

  it("reports authenticated only for valid owner session cookies", async () => {
    const loginResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "owner-password"
      }
    });
    const cookie = String(loginResponse.headers["set-cookie"]).split(";")[0];

    const authenticatedResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        cookie
      }
    });
    const forgedResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        cookie: `${OWNER_SESSION_COOKIE}=forged`
      }
    });

    expect(authenticatedResponse.json()).toEqual({ authenticated: true });
    expect(forgedResponse.json()).toEqual({ authenticated: false });
  });

  it("clears owner and legacy QA cookies on logout", async () => {
    const loginResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "owner-password"
      }
    });
    const cookie = String(loginResponse.headers["set-cookie"]).split(";")[0];

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        cookie: `${cookie}; mystt_qa_token=legacy`
      }
    });

    expect(logoutResponse.statusCode).toBe(204);
    expect(logoutResponse.headers["set-cookie"]).toEqual([
      `${OWNER_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
      "mystt_qa_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"
    ]);
  });
});
