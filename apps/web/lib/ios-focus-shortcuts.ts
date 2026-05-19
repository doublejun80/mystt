export const iosFocusStartShortcutName = "MYSTT_RECORDING_START";
export const iosFocusStopShortcutName = "MYSTT_RECORDING_STOP";

export type IOSFocusShortcutKind = "start" | "stop";
export type IOSFocusShortcutBrowser = "safari" | "chrome" | "other";
export type IOSFocusShortcutRecorderPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "saving"
  | "processing"
  | "saved"
  | "error";

export type IOSFocusShortcutBrowserSupport = {
  browser: IOSFocusShortcutBrowser;
  canUseFocusShortcutRoundTrip: boolean;
  guidance: string;
};

export function isLikelyIOSDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number
) {
  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

export function buildIOSFocusShortcutUrl(
  kind: IOSFocusShortcutKind,
  returnUrl?: string
) {
  const name =
    kind === "start" ? iosFocusStartShortcutName : iosFocusStopShortcutName;
  const params = [`name=${encodeURIComponent(name)}`];

  if (returnUrl) {
    const encodedReturnUrl = encodeURIComponent(returnUrl);
    params.push(
      `x-success=${encodedReturnUrl}`,
      `x-cancel=${encodedReturnUrl}`,
      `x-error=${encodedReturnUrl}`
    );
  }

  return `shortcuts://x-callback-url/run-shortcut?${params.join("&")}`;
}

export function getIOSFocusShortcutBrowserSupport(
  userAgent: string
): IOSFocusShortcutBrowserSupport {
  if (/CriOS/i.test(userAgent)) {
    return {
      browser: "chrome",
      canUseFocusShortcutRoundTrip: false,
      guidance:
        "iPhone Chrome에서는 Shortcuts 실행 후 원래 MYSTT 탭으로 돌아오는 경로를 보장할 수 없습니다. Safari에서 열거나 제어 센터에서 집중 모드를 직접 켜세요."
    };
  }

  if (
    /FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA|FBAN|FBAV|Instagram|Line|KAKAOTALK|NAVER|DaumApps|Twitter|MicroMessenger/i.test(
      userAgent
    )
  ) {
    return {
      browser: "other",
      canUseFocusShortcutRoundTrip: false,
      guidance:
        "iPhone의 서드파티 브라우저에서는 Shortcuts 실행 후 원래 MYSTT 탭으로 돌아오는 경로를 보장할 수 없습니다. Safari에서 열거나 제어 센터에서 집중 모드를 직접 켜세요."
    };
  }

  if (!/Version\/[\d.]+.*Safari/i.test(userAgent)) {
    return {
      browser: "other",
      canUseFocusShortcutRoundTrip: false,
      guidance:
        "iPhone의 서드파티 브라우저에서는 Shortcuts 실행 후 원래 MYSTT 탭으로 돌아오는 경로를 보장할 수 없습니다. Safari에서 열거나 제어 센터에서 집중 모드를 직접 켜세요."
    };
  }

  return {
    browser: "safari",
    canUseFocusShortcutRoundTrip: true,
    guidance:
      "iPhone Safari에서만 MYSTT 단축어 왕복을 시도합니다. 실제 기기에서 MYSTT 탭 복귀를 확인한 뒤 회의에 사용하세요."
  };
}

export function buildIOSShortcutReturnUrl(currentUrl: string, userAgent: string) {
  const url = new URL(currentUrl);
  const support = getIOSFocusShortcutBrowserSupport(userAgent);

  if (!support.canUseFocusShortcutRoundTrip) {
    return null;
  }

  return url.toString();
}

export function canRunIOSFocusShortcutAction(input: {
  kind: IOSFocusShortcutKind;
  phase: IOSFocusShortcutRecorderPhase;
  enabled: boolean;
  support?: IOSFocusShortcutBrowserSupport | null;
}) {
  if (!input.enabled || !input.support?.canUseFocusShortcutRoundTrip) {
    return false;
  }

  if (input.kind === "start") {
    return input.phase === "idle";
  }

  return true;
}
