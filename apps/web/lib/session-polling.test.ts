import { describe, expect, it } from "vitest";

import { hasActivePortalSession } from "./session-polling";

describe("hasActivePortalSession", () => {
  it("polls while any portal session is still processing", () => {
    expect(
      hasActivePortalSession([
        { status: "completed" },
        { status: "transcribing" }
      ])
    ).toBe(true);
  });

  it("stops polling when all visible sessions are terminal", () => {
    expect(
      hasActivePortalSession([
        { status: "completed" },
        { status: "failed" }
      ])
    ).toBe(false);
  });
});
