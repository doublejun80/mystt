import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createOwnerSessionToken,
  OWNER_SESSION_COOKIE,
  parseOwnerSessionToken,
  ownerEmailMatches,
  ownerPasswordMatches,
  type OwnerAuthConfig
} from "../lib/owner-auth";
import { getConfiguredOwnerAuth } from "../lib/public-access";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});
const QA_TOKEN_COOKIE = "mystt_qa_token";

export async function authRoutes(
  app: FastifyInstance,
  options: {
    getOwnerAuth?: () => OwnerAuthConfig | undefined;
    nowMs?: () => number;
  } = {}
) {
  const getOwnerAuth = options.getOwnerAuth ?? getConfiguredOwnerAuth;
  const nowMs = options.nowMs ?? Date.now;

  app.get("/v1/auth/session", async (request) => {
    const ownerAuth = getOwnerAuth();
    const cookieToken = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${OWNER_SESSION_COOKIE}=`))
      ?.split("=")
      .slice(1)
      .join("=");

    return {
      authenticated: Boolean(
        ownerAuth &&
          parseOwnerSessionToken(decodeURIComponent(cookieToken ?? ""), {
            secret: ownerAuth.secret,
            nowMs: nowMs()
          })
      )
    };
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const ownerAuth = getOwnerAuth();
    if (!ownerAuth) {
      return reply.code(503).send({ message: "Owner auth is not configured" });
    }

    const parsed = loginSchema.safeParse(request.body);
    if (
      !parsed.success ||
      !ownerEmailMatches(ownerAuth.email, parsed.data.email) ||
      !ownerPasswordMatches(ownerAuth.password, parsed.data.password)
    ) {
      return reply.code(401).send({ message: "Invalid email or password" });
    }

    const issuedAtMs = nowMs();
    const token = createOwnerSessionToken({
      secret: ownerAuth.secret,
      nowMs: issuedAtMs,
      ttlSeconds: ownerAuth.ttlSeconds
    });
    const expiresAt = new Date(issuedAtMs + ownerAuth.ttlSeconds * 1000).toISOString();
    const forwardedHost = request.headers["x-forwarded-host"];
    const host = String(
      (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host ?? ""
    );
    const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(?::\d+)?$/i.test(host);
    const secureCookie =
      request.headers["x-forwarded-proto"] === "https" ||
      request.headers["x-forwarded-ssl"] === "on" ||
      (host.length > 0 && !isLocalHost);

    reply.header(
      "set-cookie",
      `${OWNER_SESSION_COOKIE}=${encodeURIComponent(
        token
      )}; Max-Age=${ownerAuth.ttlSeconds}; Path=/; HttpOnly; SameSite=Lax${
        secureCookie ? "; Secure" : ""
      }`
    );

    return {
      authenticated: true,
      token,
      tokenType: "Bearer",
      expiresAt
    };
  });

  app.post("/v1/auth/logout", async (_request, reply) => {
    reply.header("set-cookie", [
      `${OWNER_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
      `${QA_TOKEN_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
    ]);
    return reply.code(204).send();
  });
}
