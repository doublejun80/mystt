# iOS Lane

이 lane은 `screen-off` 중에도 원본 오디오가 살아남는지 확인한다. iPhone 실기기 증거가 없으면 통과로 적지 않는다.

## Targets

| Target | Purpose | Can prove background survival? |
| --- | --- | --- |
| iPhone Safari public portal, `https://mystt.doublejun.digital` | 공개 포털 로그인, 마이크 권한, 업로드/전사 smoke, MP3 다운로드 UX 확인 | No. Safari/WebKit capture is portal QA only. |
| iPhone Expo dev-client native app | native recorder, `runtime-state.json`, `session.json`, local ledger/hash retention 확인 | Yes, only with screen-off real-device artifacts. |
| iPhone release-like/native build | 120분 잠금 화면 장시간 생존성 최종 판정 | Yes, preferred release gate. |

Safari public portal 결과는 이 lane에 기록하되 `iphone-safari-portal`로 분리한다. 이 row가 pass여도 `ios-native` background survival을 pass로 바꾸지 않는다.

iPhone Chrome Focus Shortcuts 확인도 portal QA로만 기록한다. Chrome에서 Shortcuts가 Safari 새 창이나 새 탭으로 이동하면 shortcut round-trip은 `blocked`이며, background survival pass로 바꾸지 않는다.

## What to Verify

- 앱이 백그라운드로 내려가도 `transportState`와 `phase`가 기대한 대로 유지되는지 본다.
- `runtime-state.json`과 `recordings/<session-id>/session.json`이 둘 다 남는지 본다.
- `checksumMd5`가 계산되고, `uploadQueuedAt`가 업로드 큐 진입 시점으로 기록되는지 본다.
- `backgroundTransitionCount`가 실제 background 전환 횟수와 맞는지 본다.
- `selectedInput`과 `lastKnownAppState`가 재실행 후에도 복구 단서로 남는지 본다.
- 업로드 뒤에도 로컬 원본은 `localSha256 == remoteSha256`, `remoteByteLength > 0`, `uploadVerifiedAt`가 기록되기 전까지 삭제 대상이 아니다.

## Automated Verification

- 상태 파일 읽기: `runtime-state.json`
- 세션 sidecar 확인: `recordings/<session-id>/session.json`
- 업로드 큐 진입 여부와 `transportState`, `phase` 비교
- 해시 / 메타데이터 필드 확인: `checksumMd5`, `uploadQueuedAt`
- cleanup 가능 여부는 `canPruneLocalOriginalAudio` 계약을 따른다. `localAudioPath`, `localSha256`, `remoteSha256`, `remoteByteLength`, `uploadVerifiedAt`가 모두 맞아야 한다.

## Manual Evidence Required

- 실제 iPhone 모델과 iOS 버전
- 화면 잠금 또는 화면 off 상태에서 녹음 유지 증거
- Bluetooth mic 사용 시 입력 전환 증거
- 강제 종료 또는 재실행 후 복구 화면 증거
- dev-client/native build 식별자 또는 TestFlight/release-like build 식별자
- Safari/Chrome Focus Shortcuts handoff 결과. Chrome은 단축어 버튼이 숨겨지거나 제한 안내가 보여야 하며, 실제 왕복 성공으로 기록하지 않는다.

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
- screen-off artifact path: screenshot, video, device log, or exported state bundle
- Focus Shortcuts browser handoff artifact: Safari same-tab result or Chrome unsupported UI screenshot

## Pass / Fail

- Pass: 화면이 꺼진 상태에서도 원본 오디오가 보존되고, 업로드 전후 상태가 설명 가능하다.
- Fail: 로컬 오디오가 먼저 사라지거나, `runtime-state.json`이 남지 않거나, background 전환 흔적이 빠진다.
- Blocked: 자동 검증만 있고 iPhone screen-off 실기기 artifact가 없거나, Safari portal smoke만 있는 상태다.
- Blocked: iPhone Chrome shortcut이 Safari 새 창/새 탭을 열거나, Chrome UI가 이를 성공 플로우로 안내한다.
- Retry: 같은 실기기에서 재측정하고, 실패 시 저장 / 업로드 순서를 다시 확인한다.
