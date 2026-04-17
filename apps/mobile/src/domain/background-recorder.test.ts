import { describe, expect, it } from "vitest";

import {
  buildRecorderDomainSnapshot,
  createMobileRecorderSession
} from "./background-recorder";

describe("background-recorder domain", () => {
  it("derives queue and platform expectations for a recorder phase", () => {
    const snapshot = buildRecorderDomainSnapshot({
      phase: "recording_background",
      session: createMobileRecorderSession()
    });

    expect(snapshot.machine.surface).toBe("background");
    expect(snapshot.uploadQueue).toHaveLength(snapshot.chunkPlan.length);
    expect(snapshot.platformExpectations).toHaveLength(3);
    expect(snapshot.nativeScaffolds[0]?.requiredEntries).toContain("UIBackgroundModes");
  });
});
