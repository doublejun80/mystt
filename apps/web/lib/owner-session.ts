export const OWNER_SESSION_COOKIE = "mystt_owner_session";

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(bytes: ArrayBuffer) {
  const array = new Uint8Array(bytes);
  let binary = "";

  for (const byte of array) {
    binary += String.fromCharCode(byte);
  }

  const encoded =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");

  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));

  return bytesToBase64Url(signature);
}

function signaturesMatch(expected: string, candidate: string) {
  if (expected.length !== candidate.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
  }

  return diff === 0;
}

export async function isOwnerSessionTokenValid(
  token: string | undefined | null,
  input: {
    secret: string;
    nowMs?: number;
  }
) {
  const parts = token?.split(".");
  if (!parts || parts.length !== 3 || parts[0] !== "v1") {
    return false;
  }

  const [, payload, signature] = parts;
  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = await hmacSha256(payload, input.secret);
  if (!signaturesMatch(expectedSignature, signature)) {
    return false;
  }

  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as {
      sub?: string;
      exp?: number;
    };
    const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);

    return claims.sub === "owner" && typeof claims.exp === "number" && claims.exp > nowSeconds;
  } catch {
    return false;
  }
}
