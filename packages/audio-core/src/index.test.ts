import { describe, expect, it } from "vitest";

import {
  buildRecorderDomainSnapshot,
  evaluateMobileDeviceQaEvidence,
  buildRecorderSurvivalSummary,
  buildRollingChunkPlan,
  canPruneLocalOriginalAudio,
  canOpenRealtimeStream,
  createSessionRecord,
  isGeneratedRecordingFallbackTitle,
  resolveGeneratedSessionTitle
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

  it("blocks mobile background QA completion without real-device artifact paths", () => {
    const blocked = evaluateMobileDeviceQaEvidence({
      lane: "ios-native",
      target: "iPhone 15 Pro / iOS 18",
      automatedChecks: {
        runtimeStateJson: "mystt-recorder/runtime-state.json",
        sessionJson: "mystt-recorder/recordings/sess_1/session.json",
        checksumMd5: "md5-local",
        localSha256: "sha256-local",
        remoteSha256: "sha256-local",
        remoteByteLength: 4096,
        uploadVerifiedAt: "2026-05-11T09:05:00.000Z",
        uploadQueuedAt: "2026-05-11T09:00:00.000Z",
        localAudioPath: "mystt-recorder/recordings/sess_1/source.m4a"
      },
      realDeviceArtifacts: []
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.canClaimBackgroundSurvival).toBe(false);
    expect(blocked.missingEvidence).toContain("real-device-screen-off-artifact");
  });

  it("blocks native mobile release proof when screen-off duration is below 120 minutes", () => {
    const blocked = evaluateMobileDeviceQaEvidence({
      lane: "android-native",
      target: "Pixel 8 / Android 15 release-like",
      automatedChecks: {
        runtimeStateJson: "runtime-state.json",
        sessionJson: "session.json",
        checksumMd5: "md5-local",
        localSha256: "sha256-source",
        remoteSha256: "sha256-source",
        remoteByteLength: 4096,
        uploadVerifiedAt: "2026-05-11T09:05:00.000Z",
        uploadQueuedAt: "2026-05-11T09:00:00.000Z",
        localAudioPath: "source.m4a"
      },
      realDeviceArtifacts: [
        {
          type: "screen-off-recording",
          path: "artifacts/android/screen-off.mp4",
          device: "Pixel 8",
          buildId: "AP1A",
          screenOffSeconds: 240
        },
        {
          type: "foreground-service-notification",
          path: "artifacts/android/foreground-service.png",
          device: "Pixel 8",
          buildId: "AP1A"
        }
      ]
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.canClaimBackgroundSurvival).toBe(false);
    expect(blocked.missingEvidence).toContain("screen-off-seconds-7200");
  });

  it("accepts native mobile proof only with 120-minute screen-off artifacts", () => {
    const passed = evaluateMobileDeviceQaEvidence({
      lane: "android-native",
      target: "Pixel 8 / Android 15",
      automatedChecks: {
        runtimeStateJson: "runtime-state.json",
        sessionJson: "session.json",
        checksumMd5: "md5-local",
        localSha256: "sha256-source",
        remoteSha256: "sha256-source",
        remoteByteLength: 4096,
        uploadVerifiedAt: "2026-05-11T09:05:00.000Z",
        uploadQueuedAt: "2026-05-11T09:00:00.000Z",
        localAudioPath: "source.m4a"
      },
      realDeviceArtifacts: [
        {
          type: "screen-off-recording",
          path: "artifacts/android/screen-off.mp4",
          device: "Pixel 8",
          buildId: "AP1A",
          screenOffSeconds: 7200
        },
        {
          type: "foreground-service-notification",
          path: "artifacts/android/foreground-service.png",
          device: "Pixel 8",
          buildId: "AP1A"
        }
      ]
    });

    expect(passed.status).toBe("pass");
    expect(passed.canClaimBackgroundSurvival).toBe(true);
  });

  it("allows local original cleanup only after remote hash and byte verification", () => {
    expect(
      canPruneLocalOriginalAudio({
        localAudioPath: "mystt-recorder/recordings/sess_1/source.m4a",
        localSha256: "sha256-source",
        remoteSha256: "sha256-source",
        remoteByteLength: 4096,
        uploadVerifiedAt: "2026-05-11T09:05:00.000Z"
      })
    ).toBe(true);

    expect(
      canPruneLocalOriginalAudio({
        localAudioPath: "mystt-recorder/recordings/sess_1/source.m4a",
        localSha256: "sha256-source",
        remoteSha256: "different-sha",
        remoteByteLength: 4096,
        uploadVerifiedAt: "2026-05-11T09:05:00.000Z"
      })
    ).toBe(false);
  });

  it("resolves STT-generated titles only for automatic recording fallback titles", () => {
    expect(isGeneratedRecordingFallbackTitle("빠른 녹음 오후 7:12:30")).toBe(true);
    expect(isGeneratedRecordingFallbackTitle("복구 녹음 2026. 5. 23. 오후 7:12:30")).toBe(true);
    expect(isGeneratedRecordingFallbackTitle("빠른 녹음 제목 변경")).toBe(false);

    expect(
      resolveGeneratedSessionTitle({
        currentTitle: "빠른 녹음 오후 7:12:30",
        generatedTitle: "고객사 변경계약 협상 회의"
      })
    ).toBe("고객사 변경계약 협상 회의");

    expect(
      resolveGeneratedSessionTitle({
        currentTitle: "사용자가 입력한 제목",
        generatedTitle: "고객사 변경계약 협상 회의"
      })
    ).toBeNull();
  });
});
