import { describe, expect, it } from "vitest";
import { createSessionRecord } from "@mystt/audio-core";

import {
  assertDesktopDownloadSavedEvidence,
  buildRecentSessionLines,
  normalizeDesktopDownloadFileName,
  formatDesktopBridgeError,
  resolveDesktopSourceAudioDownloadUrl,
  resolveDesktopVerificationOptions
} from "./verification";

describe("desktop verification helpers", () => {
  it("enables diagnostics helpers only when the verification env flags are set", () => {
    expect(resolveDesktopVerificationOptions({})).toEqual({
      openDiagnosticsOnLaunch: false,
      autostartKeepAwakeOnLaunch: false,
      diagnosticsScrollTarget: null
    });

    expect(
      resolveDesktopVerificationOptions({
        VITE_DESKTOP_OPEN_DIAGNOSTICS: "1",
        VITE_DESKTOP_AUTOSTART_KEEP_AWAKE: "1",
        VITE_DESKTOP_SCROLL_TARGET: "desktop-keep-awake-pill"
      })
    ).toEqual({
      openDiagnosticsOnLaunch: true,
      autostartKeepAwakeOnLaunch: true,
      diagnosticsScrollTarget: "desktop-keep-awake-pill"
    });
  });

  it("surfaces explicit recent_sessions lines even when the recorder ledger is empty", () => {
    expect(buildRecentSessionLines([])).toEqual(["recent_sessions: 없음"]);
  });

  it("formats recent session entries with title, id, and savedAt for the diagnostics checklist", () => {
    expect(
      buildRecentSessionLines([
        {
          session: createSessionRecord({
            id: "session-123",
            title: "주간 기획 회의",
            mode: "meeting"
          }),
          durationMillis: null,
          sizeBytes: null,
          phaseHistory: [],
          savedAt: "unix:1776487000",
          uploadState: "local-only",
          operationLog: [],
          checksumMd5: null,
          sessionJsonPath: "/tmp/session.json",
          runtimeStatePath: "/tmp/runtime-state.json",
          lastKnownAppState: "foreground",
          backgroundTransitionCount: 0,
          selectedInput: null,
          evidenceLog: []
        }
      ])
    ).toEqual(["recent_sessions[0]: 주간 기획 회의 · session-123 · unix:1776487000"]);
  });

  it("keeps string rejection details from Tauri bridge failures", () => {
    expect(
      formatDesktopBridgeError(
        "mp3 변환 실패: trun track id unknown, no tfhd was found",
        "다운로드 폴더 저장에 실패했습니다."
      )
    ).toBe("mp3 변환 실패: trun track id unknown, no tfhd was found");

    expect(
      formatDesktopBridgeError(
        new Error("ffmpeg 실행 실패: command not found"),
        "다운로드 폴더 저장에 실패했습니다."
      )
    ).toBe("ffmpeg 실행 실패: command not found");
  });

  it("forces desktop source-audio downloads to request mp3", () => {
    expect(
      resolveDesktopSourceAudioDownloadUrl(
        "https://mystt.doublejun.digital/v1/sessions/session-1/source-audio",
        "https://mystt.doublejun.digital/?desktop_shell=1"
      )
    ).toBe("https://mystt.doublejun.digital/v1/sessions/session-1/source-audio?format=mp3");

    expect(
      resolveDesktopSourceAudioDownloadUrl(
        "/v1/sessions/session-2/source-audio?inline=1",
        "http://127.0.0.1:3203/?desktop_shell=1"
      )
    ).toBe("http://127.0.0.1:3203/v1/sessions/session-2/source-audio?format=mp3");
  });

  it("normalizes desktop download filenames to mp3 after path sanitization", () => {
    expect(normalizeDesktopDownloadFileName("회의:원본.wav")).toBe("회의-원본.mp3");
    expect(normalizeDesktopDownloadFileName("meeting")).toBe("meeting.mp3");
    expect(normalizeDesktopDownloadFileName("   ")).toBe("mystt-audio.mp3");
  });

  it("requires scriptable desktop download evidence to include a nonzero saved mp3", () => {
    expect(
      assertDesktopDownloadSavedEvidence({
        requestedUrl:
          "https://mystt.doublejun.digital/v1/sessions/session-1/source-audio?format=mp3",
        savedPath: "/Users/demo/Downloads/meeting.mp3",
        byteLength: 1200
      })
    ).toEqual({
      ok: true,
      detail: "saved /Users/demo/Downloads/meeting.mp3 (1200 bytes)"
    });

    expect(
      assertDesktopDownloadSavedEvidence({
        requestedUrl: "https://mystt.doublejun.digital/v1/sessions/session-1/source-audio?format=mp30",
        savedPath: "/Users/demo/Downloads/meeting.mp3",
        byteLength: 1200
      })
    ).toEqual({
      ok: false,
      detail: "download URL did not request format=mp3"
    });
  });
});
