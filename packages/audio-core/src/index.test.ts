import { describe, expect, it } from "vitest";

import {
  buildRecorderDomainSnapshot,
  buildRecorderSurvivalSummary,
  buildRollingChunkPlan,
  canOpenRealtimeStream,
  createSessionRecord
} from "./index";

describe("audio-core", () => {
  it("creates a rolling chunk plan", () => {
    const plan = buildRollingChunkPlan(31, 10);
    expect(plan).toHaveLength(4);
    expect(plan[3]).toMatchObject({ startMs: 1_800_000, endMs: 1_860_000 });
  });

  it("allows realtime only when the session is foreground and healthy", () => {
    const session = {
      ...createSessionRecord({
        id: "sess_1",
        title: "Demo",
        mode: "meeting"
      }),
      status: "recording" as const
    };

    expect(
      canOpenRealtimeStream({
        isForeground: true,
        batteryPercent: 80,
        session
      })
    ).toBe(true);
    expect(
      canOpenRealtimeStream({
        isForeground: false,
        batteryPercent: 80,
        session
      })
    ).toBe(false);
  });

  it("derives a shared recorder contract for 2-hour sessions", () => {
    const snapshot = buildRecorderDomainSnapshot({
      phase: "recording_foreground",
      session: createSessionRecord({
        id: "sess_2",
        title: "Desktop recorder",
        mode: "meeting"
      })
    });

    expect(snapshot.chunkPlan).toHaveLength(12);
    expect(snapshot.platformExpectations.some((item) => item.platform === "desktop")).toBe(true);
    expect(snapshot.machine.canContinueBackground).toBe(true);
  });

  it("summarizes survival evidence without claiming release readiness", () => {
    const summary = buildRecorderSurvivalSummary({
      backgroundTransitionCount: 2,
      lastKnownAppState: "background",
      selectedInput: {
        uid: "airpods-1",
        label: "AirPods Pro",
        type: "bluetooth"
      },
      evidenceLog: [
        {
          at: "2026-04-10T00:00:00.000Z",
          kind: "app_state",
          message: "앱이 background로 전환되었습니다.",
          phase: "recording_background",
          appState: "background"
        }
      ]
    });

    expect(summary.backgroundTransitionCount).toBe(2);
    expect(summary.selectedInputLabel).toBe("AirPods Pro");
    expect(summary.requiresRealDeviceProof).toBe(true);
  });
});
