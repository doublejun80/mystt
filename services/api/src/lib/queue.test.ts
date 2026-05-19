import { describe, expect, it } from "vitest";

import { resolveSessionProcessIdempotencyTtlMs } from "./queue";

describe("resolveSessionProcessIdempotencyTtlMs", () => {
  it("keeps duplicate suppression alive beyond the default worker timeout", () => {
    expect(resolveSessionProcessIdempotencyTtlMs()).toBe(12 * 60 * 1000);
  });

  it("adds grace time for explicit longer processing timeouts", () => {
    expect(resolveSessionProcessIdempotencyTtlMs(20 * 60 * 1000)).toBe(
      22 * 60 * 1000
    );
  });
});
