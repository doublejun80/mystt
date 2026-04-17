import { describe, expect, test } from "vitest";

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
});
