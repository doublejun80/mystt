import { describe, expect, it } from "vitest";

import {
  createOwnerSessionToken,
  ownerEmailMatches,
  ownerPasswordMatches,
  parseOwnerSessionToken
} from "./owner-auth";

describe("owner auth", () => {
  it("accepts the configured owner password without accepting prefixes", () => {
    expect(ownerPasswordMatches("correct horse battery staple", "correct horse battery staple")).toBe(
      true
    );
    expect(ownerPasswordMatches("correct horse battery staple", "correct horse")).toBe(false);
    expect(ownerPasswordMatches("correct horse battery staple", "correct horse battery staple!")).toBe(
      false
    );
  });

  it("matches owner email case-insensitively", () => {
    expect(ownerEmailMatches("me@example.com", "ME@example.com")).toBe(true);
    expect(ownerEmailMatches("me@example.com", "other@example.com")).toBe(false);
  });

  it("creates and validates short-lived signed owner session tokens", () => {
    const token = createOwnerSessionToken({
      secret: "session-secret",
      nowMs: 1_000,
      ttlSeconds: 60
    });

    expect(parseOwnerSessionToken(token, { secret: "session-secret", nowMs: 30_000 })).toMatchObject({
      sub: "owner"
    });
    expect(parseOwnerSessionToken(token, { secret: "other-secret", nowMs: 30_000 })).toBeNull();
    expect(parseOwnerSessionToken(token, { secret: "session-secret", nowMs: 70_000 })).toBeNull();
  });
});
