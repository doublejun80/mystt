import { describe, expect, it } from "vitest";

import {
  buildIOSFocusShortcutUrl,
  buildIOSShortcutReturnUrl,
  canRunIOSFocusShortcutAction,
  getIOSFocusShortcutBrowserSupport,
  iosFocusStartShortcutName,
  iosFocusStopShortcutName,
  isLikelyIOSDevice
} from "./ios-focus-shortcuts";

describe("ios-focus-shortcuts", () => {
  it("builds a start shortcut URL with the return URL as text input", () => {
    const url = new URL(
      buildIOSFocusShortcutUrl("start", "https://mystt.doublejun.digital/?from=test")
    );

    expect(url.protocol).toBe("shortcuts:");
    expect(url.hostname).toBe("x-callback-url");
    expect(url.pathname).toBe("/run-shortcut");
    expect(url.searchParams.get("name")).toBe(iosFocusStartShortcutName);
    expect(url.searchParams.get("x-success")).toBe(
      "https://mystt.doublejun.digital/?from=test"
    );
    expect(url.searchParams.get("x-cancel")).toBe(
      "https://mystt.doublejun.digital/?from=test"
    );
    expect(url.searchParams.get("x-error")).toBe(
      "https://mystt.doublejun.digital/?from=test"
    );
    expect(buildIOSFocusShortcutUrl("start")).toContain(
      "name=MYSTT_RECORDING_START"
    );
    expect(buildIOSFocusShortcutUrl("start")).not.toContain("+");
  });

  it("builds a stop shortcut URL without forcing an input payload", () => {
    const url = new URL(buildIOSFocusShortcutUrl("stop"));

    expect(url.searchParams.get("name")).toBe(iosFocusStopShortcutName);
    expect(url.searchParams.has("x-success")).toBe(false);
    expect(url.searchParams.has("x-cancel")).toBe(false);
    expect(url.searchParams.has("x-error")).toBe(false);
  });

  it("does not promise a Chrome original-tab round trip on iOS", () => {
    expect(
      buildIOSShortcutReturnUrl(
        "https://mystt.doublejun.digital/?meeting=1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/136.0.0.0 Mobile/15E148 Safari/604.1"
      )
    ).toBeNull();

    expect(
      getIOSFocusShortcutBrowserSupport(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/136.0.0.0 Mobile/15E148 Safari/604.1"
      )
    ).toEqual({
      browser: "chrome",
      canUseFocusShortcutRoundTrip: false,
      guidance:
        "iPhone Chrome에서는 Shortcuts 실행 후 원래 MYSTT 탭으로 돌아오는 경로를 보장할 수 없습니다. Safari에서 열거나 제어 센터에서 집중 모드를 직접 켜세요."
    });

    expect(
      buildIOSShortcutReturnUrl(
        "https://mystt.doublejun.digital/?meeting=1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1"
      )
    ).toBe("https://mystt.doublejun.digital/?meeting=1");
  });

  it("does not treat unknown iOS WebKit browsers as Safari shortcut-safe", () => {
    const googleAppUserAgent =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/317.0.123456789";

    expect(
      buildIOSShortcutReturnUrl(
        "https://mystt.doublejun.digital/?meeting=1",
        googleAppUserAgent
      )
    ).toBeNull();

    expect(getIOSFocusShortcutBrowserSupport(googleAppUserAgent)).toEqual({
      browser: "other",
      canUseFocusShortcutRoundTrip: false,
      guidance:
        "iPhone의 서드파티 브라우저에서는 Shortcuts 실행 후 원래 MYSTT 탭으로 돌아오는 경로를 보장할 수 없습니다. Safari에서 열거나 제어 센터에서 집중 모드를 직접 켜세요."
    });
  });

  it("allows the stop shortcut while recording is busy but keeps start idle-only", () => {
    const safariSupport = getIOSFocusShortcutBrowserSupport(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1"
    );

    expect(
      canRunIOSFocusShortcutAction({
        kind: "stop",
        phase: "recording",
        enabled: true,
        support: safariSupport
      })
    ).toBe(true);

    expect(
      canRunIOSFocusShortcutAction({
        kind: "stop",
        phase: "saving",
        enabled: true,
        support: safariSupport
      })
    ).toBe(true);

    expect(
      canRunIOSFocusShortcutAction({
        kind: "start",
        phase: "recording",
        enabled: true,
        support: safariSupport
      })
    ).toBe(false);

    expect(
      canRunIOSFocusShortcutAction({
        kind: "start",
        phase: "idle",
        enabled: true,
        support: safariSupport
      })
    ).toBe(true);
  });

  it("detects iPhone and touch iPad user agents", () => {
    expect(
      isLikelyIOSDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)",
        "iPhone",
        5
      )
    ).toBe(true);

    expect(
      isLikelyIOSDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
        "MacIntel",
        5
      )
    ).toBe(true);

    expect(
      isLikelyIOSDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
        "MacIntel",
        0
      )
    ).toBe(false);

    expect(
      isLikelyIOSDevice(
        "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/136 Mobile Safari/537.36",
        "Linux armv81",
        5
      )
    ).toBe(false);
  });
});
