import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { isOwnerSessionTokenValid } from "./owner-session";

function createToken(input: { secret: string; nowSeconds: number; ttlSeconds: number }) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: "owner",
      iat: input.nowSeconds,
      exp: input.nowSeconds + input.ttlSeconds,
      jti: "test-session"
    })
  ).toString("base64url");
  const signature = createHmac("sha256", input.secret).update(payload).digest("base64url");

  return `v1.${payload}.${signature}`;
}

describe("owner session edge validation", () => {
  it("validates signed owner session tokens without accepting expired or forged tokens", async () => {
    const token = createToken({
      secret: "session-secret",
      nowSeconds: 1,
      ttlSeconds: 60
    });

    await expect(
      isOwnerSessionTokenValid(token, {
        secret: "session-secret",
        nowMs: 30_000
      })
    ).resolves.toBe(true);
    await expect(
      isOwnerSessionTokenValid(token, {
        secret: "wrong-secret",
        nowMs: 30_000
      })
    ).resolves.toBe(false);
    await expect(
      isOwnerSessionTokenValid(token, {
        secret: "session-secret",
        nowMs: 70_000
      })
    ).resolves.toBe(false);
  });
});
