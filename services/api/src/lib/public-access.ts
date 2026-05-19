import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

import { apiConfig } from "../config";
import {
  OWNER_SESSION_COOKIE,
  parseOwnerSessionToken,
  type OwnerAuthConfig
} from "./owner-auth";

const QA_TOKEN_HEADER = "x-mystt-qa-token";
const QA_TOKEN_COOKIE = "mystt_qa_token";
const MIN_AUTH_SECRET_LENGTH = 32;

export function getConfiguredQaToken() {
  return apiConfig.MYSTT_QA_TOKEN?.trim() || undefined;
}

export function getConfiguredOwnerAuth(): OwnerAuthConfig | undefined {
  const email = apiConfig.MYSTT_OWNER_EMAIL?.trim();
  const password = apiConfig.MYSTT_OWNER_PASSWORD?.trim();
  const secret = apiConfig.MYSTT_AUTH_SECRET?.trim();

  if (!email || !password || !secret || secret.length < MIN_AUTH_SECRET_LENGTH) {
    return undefined;
  }

  return {
    email,
    password,
    secret,
    ttlSeconds: apiConfig.MYSTT_SESSION_TTL_SECONDS
  };
}

export function isPublicAccessExemptPath(pathname: string) {
  return (
    pathname === "/health" ||
    pathname === "/ready" ||
    pathname === "/v1/webhooks/soniox" ||
    pathname.startsWith("/v1/auth/")
  );
}

export function tokenMatches(expected: string, candidate?: string | null) {
  if (!candidate) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);

  return (
    expectedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(expectedBuffer, candidateBuffer)
  );
}

function extractBearerToken(value?: string) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function extractCookieToken(cookieHeader?: string) {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === QA_TOKEN_COOKIE) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return undefined;
}

function extractNamedCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return undefined;
}

export function requestHasQaAccess(request: FastifyRequest, expectedToken: string) {
  const headerToken = request.headers[QA_TOKEN_HEADER];
  const authorizationToken = extractBearerToken(request.headers.authorization);
  const cookieToken = extractCookieToken(request.headers.cookie);

  return [headerToken, authorizationToken, cookieToken].some((candidate) =>
    tokenMatches(expectedToken, Array.isArray(candidate) ? candidate[0] : candidate)
  );
}

export function requestHasOwnerAccess(
  request: FastifyRequest,
  ownerAuth: OwnerAuthConfig,
  nowMs = Date.now()
) {
  const cookieToken = extractNamedCookie(request.headers.cookie, OWNER_SESSION_COOKIE);
  const bearerToken = extractBearerToken(request.headers.authorization);

  return [cookieToken, bearerToken].some((candidate) =>
    Boolean(
      parseOwnerSessionToken(candidate, {
        secret: ownerAuth.secret,
        nowMs
      })
    )
  );
}

export function registerPublicAccessGuard(
  app: FastifyInstance,
  options: {
    getToken?: () => string | undefined;
    getOwnerAuth?: () => OwnerAuthConfig | undefined;
    nowMs?: () => number;
  } = {}
) {
  const getToken = options.getToken ?? getConfiguredQaToken;
  const getOwnerAuth = options.getOwnerAuth ?? getConfiguredOwnerAuth;
  const nowMs = options.nowMs ?? Date.now;

  app.addHook("onRequest", async (request, reply) => {
    const expectedToken = getToken();
    const ownerAuth = getOwnerAuth();

    if (request.method === "OPTIONS") {
      return;
    }

    const pathname = new URL(request.url, "http://mystt.local").pathname;
    if (isPublicAccessExemptPath(pathname)) {
      return;
    }

    if (!expectedToken && !ownerAuth && apiConfig.MYSTT_ALLOW_UNAUTHENTICATED_DEV) {
      return;
    }

    if (ownerAuth && requestHasOwnerAccess(request, ownerAuth, nowMs())) {
      return;
    }

    if (expectedToken && requestHasQaAccess(request, expectedToken)) {
      return;
    }

    return reply.code(401).send({
      message: "Authentication required"
    });
  });
}
