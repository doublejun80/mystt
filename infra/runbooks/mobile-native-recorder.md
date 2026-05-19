# Mobile Native Recorder Runbook

이 절차는 `apps/mobile` 네이티브 레코더가 실제로 `화면이 꺼져도 살아남는 녹음`에 가까운지 점검할 때 사용합니다.

## Goal

- 원본 오디오가 로컬 문서 저장소에 먼저 남는다.
- 앱이 background / inactive 로 전환될 때 상태 전이가 로그에 남는다.
- 녹음 중 앱이 죽어도 `runtime-state.json` 에 마지막 세션/입력/phase 가 남아 복구 후보를 확인할 수 있다.
- 저장본마다 `checksumMd5`, `session.json`, background 전환 횟수, selectedInput 이 함께 남는다.
- 2시간 목표 세션을 위한 저장 용량과 입력 장치가 앱 안에서 보인다.
- iOS는 [evals/device-matrix/ios/README.md](../../evals/device-matrix/ios/README.md), Android는 [evals/device-matrix/android/README.md](../../evals/device-matrix/android/README.md)에 pass/fail와 증거 링크를 남긴다.

## Current Scope

- Expo `expo-audio` 기반 start / pause / resume / local save / discard
- 저장된 `.m4a`를 `POST /v1/uploads/source-audio`로 올리고 Soniox `fileId`로 처리 큐 등록
- `UIBackgroundModes = audio`와 Android microphone foreground service 요구사항을 config/scaffold에 반영
- 로컬 저장 루트: `FileSystem.documentDirectory/mystt-recorder`
- 복구 상태 파일: `FileSystem.documentDirectory/mystt-recorder/runtime-state.json`
- 세션 증거 파일: `FileSystem.documentDirectory/mystt-recorder/recordings/<session-id>/session.json`
- Tauri 모바일 네이티브 플러그인 골격: `apps/mobile/native/tauri-plugin-recorder`
- 개발 API 자동 추론: `Constants.expoConfig.hostUri -> :4100`

## Preconditions

- `pnpm install`
- `pnpm --filter @mystt/mobile dev:lan` 또는 `pnpm --filter @mystt/mobile dev:tunnel`
- `pnpm --filter @mystt/mobile dev:client` 또는 `pnpm --filter @mystt/mobile ios:device` / `android:device`
- iOS 실기기 또는 Android 실기기
- 가능하면 Bluetooth 입력 장치 1개
- iPhone 실기기 검증은 Safari 웹이 아니라 Expo dev build 또는 최소한 Expo Go 네이티브 앱으로 진행한다.

## iPhone Test Lane

- 퍼블릭 호스팅은 필수가 아니다. 같은 와이파이에서 Expo LAN 개발 서버와 로컬 API를 바로 쓸 수 있다.
- 로컬 API가 켜져 있으면 모바일 앱은 `Constants.expoConfig.hostUri` 기준으로 `http://<LAN-IP>:4100` 을 자동 추론한다.
- 개발 머신 LAN 예시는 `http://<LAN-IP>:4100` 이다. 실제 값은 실행 시 달라질 수 있다.
- Safari 웹 포털은 검토/공유용으로는 가능하지만, 마이크/백그라운드 120분 검증 경로로 쓰지 않는다.
- 잠금 화면 120분 증거는 Expo Go만으로 완료 판정하지 않고, 가능하면 iOS dev build 또는 release-like build에서 다시 확인한다.
- `apps/mobile/eas.json` development profile을 사용하면 internal dev client 빌드로 같은 절차를 반복할 수 있다.

## Device Evidence Gate

- iPhone Safari public portal QA는 `iphone-safari-portal` row로 남긴다. 이 결과는 로그인/업로드/다운로드 smoke이며 native background survival 증거가 아니다.
- iPhone native/dev-client QA는 `ios-native` row로 남긴다. screen-off 실기기 artifact와 exported `runtime-state.json` / `session.json`이 없으면 `blocked`다.
- Android native QA는 `android-native` row로 남긴다. foreground service notification 또는 `adb logcat` artifact와 exported state bundle이 없으면 `blocked`다.
- release-like `ios-native` / `android-native` QA는 7200초 screen-off artifact, artifact build ID, exported `runtime-state.json`, exported `session.json`, matching `localSha256`/`remoteSha256`, positive `remoteByteLength`가 run마다 필요하다.
- `evaluateMobileDeviceQaEvidence`는 `runtime-state.json`, `session.json`, `checksumMd5`, `localSha256`, matching `remoteSha256`, positive `remoteByteLength`, `uploadVerifiedAt`, `uploadQueuedAt`, `localAudioPath`, lane-specific 7200초 screen-off/foreground-service artifact가 없는 run을 pass로 만들지 않는다.
- `canPruneLocalOriginalAudio`가 true가 되기 전에는 로컬 원본 삭제를 계획하지 않는다. 필요한 값은 `localAudioPath`, `localSha256`, matching `remoteSha256`, positive `remoteByteLength`, `uploadVerifiedAt`다.
- 각 native lane은 최소 5회 연속 pass가 필요하다. 릴리스 후보는 가능하면 10회 연속 pass로 올리고, 실패/누락/0 byte/mismatched SHA가 있으면 streak를 다시 시작한다.

## Checks

1. 제목과 프로젝트 키를 넣고 녹음을 시작한다.
2. 입력 장치 목록에서 실제 마이크나 AirPods가 보이는지 확인한다.
3. 30초 이상 녹음 후 일시정지/재개가 되는지 본다.
4. 앱을 백그라운드로 보내고 화면을 잠근 뒤 3분 이상 유지한다. 이 단계는 smoke이며 release-like pass로 세지 않는다.
5. 앱 복귀 후 `운영 로그`에 background / foreground 전환이 남았는지 본다.
6. 녹음 중 앱을 강제 종료한 뒤 다시 열어 `복구 후보` 카드에 마지막 세션과 입력 장치가 남는지 본다.
7. `로컬 저장` 후 최근 저장 목록에 파일 경로, `checksumMd5`, `session.json` 경로가 남는지 본다.
8. `서버 큐 등록` 후 `queued` 상태와 서버 세션 ID가 남는지 본다.
9. 잠금 화면 120분 검증은 별도 런으로 수행하고, 7200초 artifact, build ID, `background 전환 횟수`, 저장 파일 크기, `checksumMd5`, matching remote SHA, 업로드 큐 등록 성공을 캡처한다.
10. 캡처한 내용은 각 lane README의 pass/fail 섹션과 evidence-ledger row에 다시 적는다.

## Required Fault Injections

5회 연속 pass 안에 아래 fault를 모두 최소 1회 포함한다. 릴리스 후보 10회 streak에서는 같은 fault set을 두 번째로 섞는다.

- Incoming call 또는 OS audio interruption 중 recorder가 pause/stop으로 죽지 않는지 확인한다.
- Bluetooth mic disconnect 후 fallback input, `selectedInput`, evidence log가 남는지 본다.
- App kill/relaunch 후 `runtime-state.json` 복구 후보와 local original 경로가 살아 있는지 본다.
- Network offline during upload 후 queue retry, `uploadQueuedAt`, idempotency/correlation handle이 중복 처리 없이 남는지 본다.
- Low storage 상태에서 local save 실패가 명시되고 기존 local original이 삭제되지 않는지 본다.
- Android battery optimization enabled 상태에서 foreground service notification과 녹음 지속 여부를 확인한다.
- API, MinIO, Postgres를 각각 restart한 뒤 upload retry, local/remote SHA match, cleanup status를 다시 확인한다.

## Test Criteria

- Smoke: 3분 screen-off, pause/resume, kill/relaunch, local save, upload queue registration이 모두 증거를 남겨야 한다.
- Release-like: native lane별 7200초 screen-off run이 최소 5회 연속 pass해야 하며, 릴리스 후보는 10회 연속 pass를 목표로 한다.
- Fail: screen-off duration < 7200초, missing build ID, missing runtime/session JSON, zero remote byte length, SHA mismatch, unverified upload는 모두 `blocked`다.

## Expected Output

- 권한 상태가 `허용`
- `현재 상태` 카드의 시간이 계속 증가
- `생존성` 카드에 `백그라운드 녹음: 가능`
- 마지막 저장본에 `.m4a` 경로와 `checksumMd5` 가 남음
- 최근 로컬 저장 목록에 새 세션이 추가됨
- `복구 후보` 카드에 `transportState`, `phase`, `selectedInput`, `runtime-state.json` 경로가 남음
- 저장 후 `서버 큐 상태`가 `queued`로 바뀌고 Soniox 업로드 audit가 남음

## Observability

- `현재 상태`: transportState, phase label, duration
- `입력 장치`: 실제 선택된 입력 UID/label
- `운영 로그`: 권한 요청, background 진입, foreground 복귀, 로컬 저장
- 복구 파일: `mystt-recorder/runtime-state.json`
- 로컬 파일: `mystt-recorder/recordings/<session-id>/session.json`
- session 증거: `checksumMd5`, `backgroundTransitionCount`, `selectedInput`, `uploadQueuedAt`
- `runtime-state.json`는 마지막 세션, phase, selectedInput, lastKnownAppState, backgroundTransitionCount 를 담아야 한다.
- `recordings/<session-id>/session.json`는 저장본 경로와 `checksumMd5`, selectedInput, background 전환 세부를 보여야 한다.
- background transition은 background / inactive / foreground 전환 각각의 시점이 로그로 남아야 한다.

## Rollback

- 네이티브 녹음 변경으로 회귀가 생기면 `apps/mobile/app/index.tsx`를 preview-only 화면으로 되돌리고, `use-native-recorder.ts` 진입을 끊는다.
- `expo-audio` 문제가 있으면 dependency를 유지하되 `startRecording` 진입을 feature flag로 막고 기존 API preview만 노출한다.
- 저장 루트 구조가 바뀌면 기존 `mystt-recorder` 디렉터리는 삭제하지 말고 새 버전 디렉터리로 병행 마이그레이션한다.
- runtime snapshot 형식이 바뀌면 `runtime-state.v2.json` 같이 버전 파일로 병행 쓰고, 기존 `runtime-state.json` 은 마이그레이션 전까지 유지한다.

## Failure Triage

- 입력 장치 목록이 비어 있음: 권한이 아직 없거나, 플랫폼이 기본 마이크만 제공하는 상태
- background에서 끊김: 실기기 OS 정책 또는 Expo runtime 제약을 먼저 의심
- 앱 재실행 후 복구 후보가 비어 있음: `runtime-state.json` 쓰기 실패 또는 강제 종료 직전 flush 미완료 확인
- 저장 실패: `FileSystem.documentDirectory` 접근 가능 여부와 남은 저장 공간 확인
- API 연결 실패: `EXPO_PUBLIC_API_BASE_URL` 또는 Expo host 추론 결과 확인
- dev client가 장치에서 안 열림: `expo-dev-client`, `expo prebuild`, `ios:device` / `android:device`, `eas build --profile development` 순서 확인
