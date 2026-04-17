# Mobile Native Recorder Runbook

이 절차는 `apps/mobile` 네이티브 레코더가 실제로 `화면이 꺼져도 살아남는 녹음`에 가까운지 점검할 때 사용합니다.

## Goal

- 원본 오디오가 로컬 문서 저장소에 먼저 남는다.
- 앱이 background / inactive 로 전환될 때 상태 전이가 로그에 남는다.
- 녹음 중 앱이 죽어도 `runtime-state.json` 에 마지막 세션/입력/phase 가 남아 복구 후보를 확인할 수 있다.
- 저장본마다 checksum, `session.json`, background 전환 횟수가 함께 남는다.
- 2시간 목표 세션을 위한 저장 용량과 입력 장치가 앱 안에서 보인다.

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
- 현재 맥미니 LAN 예시는 `http://192.168.0.24:4100` 이다. 실제 값은 실행 시 달라질 수 있다.
- Safari 웹 포털은 검토/공유용으로는 가능하지만, 마이크/백그라운드 120분 검증 경로로 쓰지 않는다.
- 잠금 화면 120분 증거는 Expo Go만으로 완료 판정하지 않고, 가능하면 iOS dev build 또는 release-like build에서 다시 확인한다.
- `apps/mobile/eas.json` development profile을 사용하면 internal dev client 빌드로 같은 절차를 반복할 수 있다.

## Checks

1. 제목과 프로젝트 키를 넣고 녹음을 시작한다.
2. 입력 장치 목록에서 실제 마이크나 AirPods가 보이는지 확인한다.
3. 30초 이상 녹음 후 일시정지/재개가 되는지 본다.
4. 앱을 백그라운드로 보내고 화면을 잠근 뒤 3분 이상 유지한다.
5. 앱 복귀 후 `운영 로그`에 background / foreground 전환이 남았는지 본다.
6. 녹음 중 앱을 강제 종료한 뒤 다시 열어 `복구 후보` 카드에 마지막 세션과 입력 장치가 남는지 본다.
7. `로컬 저장` 후 최근 저장 목록에 파일 경로, checksum, `session.json` 경로가 남는지 본다.
8. `서버 큐 등록` 후 `queued` 상태와 서버 세션 ID가 남는지 본다.
9. 잠금 화면 120분 검증은 별도 런으로 수행하고, `background 전환 횟수`, 저장 파일 크기, checksum, 업로드 큐 등록 성공을 캡처한다.

## Expected Output

- 권한 상태가 `허용`
- `현재 상태` 카드의 시간이 계속 증가
- `생존성` 카드에 `백그라운드 녹음: 가능`
- 마지막 저장본에 `.m4a` 경로와 `md5` 가 남음
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
