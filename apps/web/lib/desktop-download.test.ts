import { describe, expect, test } from "vitest";
import { getSessionSourceAudioHref } from "./api";
import { buildDesktopDownloadFileName } from "./recording-audio";

async function loadDesktopDownloadModule() {
  try {
    return await import("./desktop-download");
  } catch {
    return null;
  }
}

describe("desktop download helpers", () => {
  test("resolves relative API paths to absolute portal URLs for the desktop bridge", async () => {
    const mod = await loadDesktopDownloadModule();
    const resolved = mod?.resolveDesktopDownloadUrl(
      "/v1/sessions/demo/source-audio",
      "https://mystt.doublejun.digital/?desktop_shell=1"
    );

    expect(resolved).toBe("https://mystt.doublejun.digital/v1/sessions/demo/source-audio");
  });

  test("keeps absolute https URLs unchanged for the desktop bridge", async () => {
    const mod = await loadDesktopDownloadModule();
    const resolved = mod?.resolveDesktopDownloadUrl(
      "https://mystt.doublejun.digital/v1/sessions/demo/source-audio",
      "https://mystt.doublejun.digital/?desktop_shell=1"
    );

    expect(resolved).toBe("https://mystt.doublejun.digital/v1/sessions/demo/source-audio");
  });

  test("rejects blob URLs for the desktop bridge", async () => {
    const mod = await loadDesktopDownloadModule();
    const resolved = mod?.resolveDesktopDownloadUrl(
      "blob:http://127.0.0.1:3203/1f3b2a",
      "http://127.0.0.1:3203/?desktop_shell=1"
    );

    expect(resolved).toBeNull();
  });

  test("extracts the final filename from POSIX-style paths", async () => {
    const mod = await loadDesktopDownloadModule();
    const fileName = mod?.getDownloadFileNameFromPath(
      "minio://audio/sessions/demo/mystt-recording.m4a",
      "fallback.audio"
    );

    expect(fileName).toBe("mystt-recording.m4a");
  });

  test("extracts the final filename from Windows-style paths", async () => {
    const mod = await loadDesktopDownloadModule();
    const fileName = mod?.getDownloadFileNameFromPath(
      "C:\\recordings\\demo\\source-audio.wav",
      "fallback.audio"
    );

    expect(fileName).toBe("source-audio.wav");
  });

  test("uses mp3 source-audio URLs and mp3 filenames for recent-session desktop downloads", async () => {
    const mod = await loadDesktopDownloadModule();
    const sourceAudioHref = getSessionSourceAudioHref("session-recent", {
      format: "mp3"
    });
    const resolved = mod?.resolveDesktopDownloadUrl(
      sourceAudioHref,
      "https://mystt.doublejun.digital/?desktop_shell=1"
    );
    const sourceFileName = mod?.getDownloadFileNameFromPath(
      "minio://audio/session-recent/source-audio.wav",
      "weekly-planning.audio"
    );

    expect(resolved).toBe(
      "http://127.0.0.1:4100/v1/sessions/session-recent/source-audio?format=mp3"
    );
    expect(buildDesktopDownloadFileName(sourceFileName ?? "")).toBe("source-audio.mp3");
  });

  test("keeps uploaded latest-recording desktop downloads as server MP3 requests", async () => {
    const mod = await loadDesktopDownloadModule();
    const resolved = mod?.resolveDesktopDownloadUrl(
      getSessionSourceAudioHref("session-latest", { format: "mp3" }),
      "http://127.0.0.1:3203/?desktop_shell=1"
    );

    expect(resolved).toBe(
      "http://127.0.0.1:4100/v1/sessions/session-latest/source-audio?format=mp3"
    );
    expect(buildDesktopDownloadFileName("mystt-recording.wav")).toBe("mystt-recording.mp3");
  });
});
