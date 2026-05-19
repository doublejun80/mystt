import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const OWNER_SESSION_COOKIE = "mystt_owner_session";

export interface OwnerAuthConfig {
  email: string;
  password: string;
  secret: string;
  ttlSeconds: number;
}

export interface OwnerSessionClaims {
  sub: "owner";
  iat: number;
  exp: number;
  jti: string;
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlJson(value: unknown) {
  return base64UrlEncode(JSON.stringify(value));
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function ownerPasswordMatches(expected: string, candidate?: string | null) {
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

export function ownerEmailMatches(expected: string, candidate?: string | null) {
  return expected.trim().toLowerCase() === candidate?.trim().toLowerCase();
}

export function createOwnerSessionToken(input: {
  secret: string;
  nowMs?: number;
  ttlSeconds: number;
}) {
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const claims: OwnerSessionClaims = {
    sub: "owner",
    iat: nowSeconds,
    exp: nowSeconds + input.ttlSeconds,
    jti: randomUUID()
  };
  const payload = base64UrlJson(claims);
  const signature = signPayload(payload, input.secret);

  return `v1.${payload}.${signature}`;
}

export function parseOwnerSessionToken(
  token: string | undefined | null,
  input: {
    secret: string;
    nowMs?: number;
  }
): OwnerSessionClaims | null {
  const parts = token?.split(".");
  if (!parts || parts.length !== 3 || parts[0] !== "v1") {
    return null;
  }

  const [, payload, signature] = parts;
  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(payload, input.secret);
  if (!ownerPasswordMatches(expectedSignature, signature)) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OwnerSessionClaims;
    const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);

    if (claims.sub !== "owner" || claims.exp <= nowSeconds) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}
