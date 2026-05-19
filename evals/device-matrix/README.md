# Device Matrix

릴리즈 전 장치별 증거를 모으는 디렉터리 가이드입니다. 이 폴더는 "무엇을 확인해야 하는지"와 "어떤 증거를 남겨야 하는지"를 한 곳에 모읍니다.

## 구조

| File | Purpose |
| --- | --- |
| `README.md` | 이 디렉터리의 사용법과 lane 안내 |
| `evidence-ledger.md` | 모든 실행 기록을 모으는 공통 장부 |
| `_template.md` | 새 증거 항목을 빠르게 쓰는 템플릿 |
| `ios/README.md` | iOS 실기기 체크리스트 |
| `android/README.md` | Android 실기기 체크리스트 |
| `desktop/README.md` | desktop shell / portal 체크리스트 |
| `soniox-live/README.md` | Soniox live / async / cleanup 체크리스트 |

## 사용법

1. lane README에서 이번 실행에 맞는 장치와 확인 포인트를 고른다.
1. 자동 검증은 로컬 명령, 테스트, 상태 조회로 먼저 끝낸다.
1. 실기기 또는 live credential 증거는 별도로 캡처한다.
1. `evidence-ledger.md`에 run row를 추가하고, `_template.md`를 참고해 요약을 남긴다.
1. lane별 pass streak는 최소 5회, 릴리스 후보는 가능하면 10회까지 누적한다. 실패, 누락 증거, hash mismatch, byteLength 0은 streak를 끊는다.

## 증거 기준

자동 검증과 수동 증거는 분리해서 기록한다.

| Type | What counts |
| --- | --- |
| Automated verification | 테스트 통과, 상태 파일 읽기, API 응답, ledger JSON 확인 |
| Manual real-device / live-credential evidence | 실제 iOS / Android 기기 화면, 화면 꺼짐 상태, keep-awake 상태, Soniox live credential / webhook / async 완료 증거 |

## Mobile QA Gate

- `iphone-safari-portal`: 공개 포털 smoke 전용이다. 로그인, iPhone Safari 마이크 권한, 업로드/전사/다운로드 UX는 확인할 수 있지만 background survival pass로 쓰지 않는다.
- `ios-native`: Expo dev-client 또는 release-like native build에서만 background survival을 판단한다. release-like pass에는 7200초 screen-off 실기기 artifact와 build ID가 필요하다.
- `android-native`: foreground service가 켜진 native build에서만 판단한다. release-like pass에는 7200초 screen-off artifact, build ID, foreground notification 또는 `adb logcat` artifact가 필요하다.
- 모바일 row는 `evaluateMobileDeviceQaEvidence` 계약과 같은 필수 필드를 쓴다: `runtime-state.json`, `session.json`, `checksumMd5`, `localSha256`, matching `remoteSha256`, positive `remoteByteLength`, `uploadVerifiedAt`, `uploadQueuedAt`, `localAudioPath`, lane-specific 실기기 artifact.
- 로컬 원본 삭제 가능성은 `canPruneLocalOriginalAudio` 계약과 같다: `localAudioPath`, `localSha256`, matching `remoteSha256`, positive `remoteByteLength`, `uploadVerifiedAt`가 모두 필요하다.

## Required Fault Injections

각 native lane의 5회 streak 안에 아래 fault를 모두 최소 1회 포함한다. 릴리스 후보가 10회 streak를 목표로 할 때는 같은 fault set을 한 번 더 섞어 반복한다.

- Incoming call 또는 OS audio interruption 중 녹음 지속/복구 확인
- Bluetooth mic disconnect 후 default input fallback과 `selectedInput` 기록 확인
- App kill/relaunch 후 `runtime-state.json` 복구 후보 확인
- Network offline during upload 후 queue retry와 idempotency handle 확인
- Low storage 상태에서 local original 보존과 실패 로그 확인
- Android battery optimization enabled/denied 상태에서 foreground service 유지 확인
- API, MinIO, Postgres를 각각 restart한 뒤 upload hash audit, queue retry, cleanup status 확인

## Release Criteria

- Test criteria: lane README의 pass/fail, `evaluateMobileDeviceQaEvidence` 결과, evidence-ledger row가 같은 run ID와 artifact를 가리켜야 한다.
- Observability: run ID, session ID, device/build ID, `backgroundTransitionCount`, local/remote SHA, byte length, upload/process/cleanup audit event, fault injection 종류를 한 줄에서 추적할 수 있어야 한다.
- Rollback: release streak 중 실패가 나오면 promotion을 멈추고, 해당 lane을 `blocked`로 표시하며, 원본 오디오는 hash verified upload 전까지 삭제하지 않는다.

## 공통으로 보는 필드

문서와 캡처에는 아래 실제 키를 우선 사용한다.

- Mobile: `runtime-state.json`, `recordings/<session-id>/session.json`, `checksumMd5`, `localSha256`, `remoteSha256`, `remoteByteLength`, `uploadVerifiedAt`, `backgroundTransitionCount`, `selectedInput`, `uploadQueuedAt`, `transportState`, `phase`, `lastKnownAppState`
- Desktop: `recorderRoot`, `recordingsRoot`, `sessions.json`, `runtime-state.json`, `saved_session_count`, `recent_sessions`, `appDataDir`, keep-awake status, local portal vs hosted domain target
- API / live: `source_audio.soniox_uploaded.fileId`, `source_audio.soniox_uploaded.location`(audit only), `source_audio.soniox_uploaded.fileName`, `source_audio.soniox_uploaded.byteLength`, `source_audio.soniox_uploaded.sha256`, `source_audio.soniox_uploaded.contentType`, `transcription.metadata.updated`, `transcription.cleanup.updated`, `cleanupStatus`, `cleanupLastError`, `cleanupTargets`, `session.process.enqueued`

## 범위 메모

- 이 디렉터리는 제품 코드를 바꾸지 않는다.
- 원본 오디오는 업로드 완료와 해시 검증 전에는 삭제하지 않는다.
- background audio 관련 결과는 실기기 증거가 있어야 완료로 친다.
- Soniox async 완료 뒤에는 uploaded file / transcription cleanup 상태까지 확인한다.
