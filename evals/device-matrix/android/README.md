# Android Lane

이 lane은 foreground service와 battery optimization 영향을 포함해, 화면 off 상태에서 녹음이 이어지는지를 확인한다. 실기기 증거가 필요하다.

## Targets

| Target | Purpose | Can prove background survival? |
| --- | --- | --- |
| Android dev-client native app | foreground service, local ledger, hash retention, screen-off behavior 확인 | Yes, only with real-device artifacts. |
| Android release-like/native build | battery optimization과 장시간 screen-off 생존성 최종 판정 | Yes, preferred release gate. |

Android는 웹 포털 smoke를 background survival 증거로 쓰지 않는다. foreground service notification, device model/version, battery optimization 상태가 함께 있어야 한다.

## What to Verify

- foreground service가 살아 있는 상태에서 `transportState`와 `phase`가 유지되는지 본다.
- `runtime-state.json`과 `recordings/<session-id>/session.json`이 남는지 본다.
- `checksumMd5`, `backgroundTransitionCount`, `selectedInput`, `uploadQueuedAt`를 같이 확인한다.
- 배터리 최적화가 켜진 기기에서 앱이 끊기지 않는지 본다.
- 업로드 뒤에도 로컬 원본은 `localSha256 == remoteSha256`, `remoteByteLength > 0`, `uploadVerifiedAt`가 기록되기 전까지 삭제 대상이 아니다.

## Automated Verification

- 상태 파일 읽기: `runtime-state.json`
- 세션 sidecar 확인: `recordings/<session-id>/session.json`
- 업로드 대기열 / 상태 전환 확인
- 해시 / 메타데이터 필드 확인: `checksumMd5`, `uploadQueuedAt`
- cleanup 가능 여부는 `canPruneLocalOriginalAudio` 계약을 따른다. `localAudioPath`, `localSha256`, `remoteSha256`, `remoteByteLength`, `uploadVerifiedAt`가 모두 맞아야 한다.

## Manual Evidence Required

- 실제 Pixel / Galaxy 기기 모델과 Android 버전
- screen off 상태에서 foreground service 유지 증거
- Bluetooth mic 또는 external mic 사용 시 입력 선택 증거
- battery optimization 켠 상태의 장시간 녹음 증거
- foreground service notification 캡처 또는 `adb logcat` excerpt

## Capture Checklist

- `session.id`
- `runtime-state.json` 경로
- `recordings/<session-id>/session.json` 경로
- `localAudioPath`
- `transportState`
- `phase`
- `lastKnownAppState`
- `backgroundTransitionCount`
- `selectedInput`
- `uploadQueuedAt`
- `checksumMd5`
- `localSha256`
- `remoteSha256`
- `remoteByteLength`
- `uploadVerifiedAt`
- foreground service artifact path: screenshot, video, logcat, or exported state bundle

## Pass / Fail

- Pass: foreground service가 유지되고, 화면 off 후에도 로컬 원본이 살아 있다.
- Fail: service가 죽거나, 상태 파일이 사라지거나, 업로드 전에 로컬 원본이 유실된다.
- Blocked: 자동 검증만 있고 Android screen-off/foreground-service 실기기 artifact가 없는 상태다.
- Retry: 같은 기기에서 재현하고, 배터리 최적화 / 권한 상태를 다시 점검한다.
