# Mobile Focus Shortcuts

## Goal

MYSTT web cannot directly control iOS Focus or Android Do Not Disturb. The iPhone
path uses Apple Shortcuts as a user-approved bridge.

## Platform Constraint

Shortcuts can open URL schemes and can run a shortcut through
`shortcuts://x-callback-url/run-shortcut`. MYSTT intentionally does not pass
`x-success`, `x-cancel`, or `x-error` because iOS may open those HTTPS callback
URLs in Safari when the shortcut was launched from another browser.

Chromium documents `googlechrome://` and `googlechromes://` as Chrome-for-iOS URL
schemes, but the documented behavior is opening the passed URL in Chrome, and
that path may create a new tab. It does not prove a return to the original
Chrome/MYSTT tab.

Current product rule:

- iPhone Safari: MYSTT may show the Shortcuts controls, with manual real-device
  verification required before meeting use. Users may need to return to the
  MYSTT tab manually after the Shortcuts app finishes.
- iPhone Chrome: MYSTT must not show a false success control. Chrome users should
  open MYSTT in Safari for this helper, or turn Focus on/off from Control Center.
- Other iPhone browsers and in-app WebViews: treat the Shortcuts round trip as
  unsupported unless a real-device evidence row proves otherwise. This includes
  Chrome-family `CriOS` handoffs and unknown iOS WebKit user agents that are not
  explicit Safari.

References:

- Apple Shortcuts URL schemes:
  https://support.apple.com/guide/shortcuts/intro-to-url-schemes-apd621a1ad7a/ios
- Apple Shortcuts x-callback-url:
  https://support.apple.com/guide/shortcuts/apdcd7f20a6f/ios
- Chromium opening links in Chrome for iOS:
  https://chromium.googlesource.com/chromium/src/+/lkgr/docs/ios/opening_links.md

## iPhone Setup

Generated import files are available on the development Mac:

- `/Users/doublejun/Downloads/mystt-shortcuts/MYSTT 녹음 시작.shortcut`
- `/Users/doublejun/Downloads/mystt-shortcuts/MYSTT 녹음 종료.shortcut`
- `/Users/doublejun/Downloads/mystt-shortcuts/MYSTT_RECORDING_START.shortcut`
- `/Users/doublejun/Downloads/mystt-shortcuts/MYSTT_RECORDING_STOP.shortcut`

Import the ASCII-named files into Apple Shortcuts. The Korean-named files are
kept only for reference because iOS shortcut URL matching can be fragile with
spaces, `+`, and Korean Unicode normalization.

1. `MYSTT_RECORDING_START`
   - Set Focus: turn on Do Not Disturb until manually turned off.
2. `MYSTT_RECORDING_STOP`
   - Set Focus: turn off Do Not Disturb.

Do not add an `Open URL` action inside these shortcuts. The web app calls them
through `shortcuts://x-callback-url/run-shortcut` without any callback URL. Do
not use `googlechromes://` as proof of returning to the original Chrome tab;
Chrome shortcut control is treated as unsupported in the UI.

In iPhone Safari, enable `iPhone 보호`, then use:

- `집중 모드 시작` before recording.
- `집중 모드 해제` after saving or canceling.

## Operational Notes

- This does not make recording survive a phone call while the OS takes the
  microphone away.
- It reduces call interruptions by relying on the user's Focus configuration.
- Users should disable repeat callers and contact exceptions if they want the
  strongest protection.
- Chrome users should not be told that the shortcut will return to the active
  MYSTT tab. If the browser opens Safari or a new tab, that is a platform
  handoff limitation, not a successful round trip.

## Observability

- Record the browser (`Safari`, `Chrome`, or other), iOS version, and MYSTT URL.
- Capture whether the shortcut started/stopped Focus, whether MYSTT remained in
  the same tab, and whether any new Safari or Chrome tab/window appeared.
- If a browser opens a different tab/window, mark the run `blocked` for shortcut
  round trip. Do not convert it into a background-audio pass.

## Rollback

Disable the `iPhone 보호` toggle in the recorder. To remove the feature entirely,
revert the `ios-focus-shortcuts` helper and the recorder panel.

## Verification

- Unit test: shortcut URL generation.
- Manual iPhone Safari test: shortcut starts Focus, does not open a new Safari
  tab from a callback URL, and the user can return to MYSTT to start recording.
- Manual iPhone Safari test: shortcut turns Focus off after recording is saved or
  canceled, without opening a new Safari tab from a callback URL.
- Manual iPhone Chrome test: MYSTT shows the unsupported/warning UI instead of
  a runnable Focus shortcut button.
- Manual iPhone Chrome regression test: if an old build still exposes the
  button, pressing it may open Safari or a new tab; record this as failed
  evidence and do not call the flow complete.
