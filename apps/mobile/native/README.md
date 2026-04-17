# Native Recorder Scaffolds

이 디렉터리는 Expo prebuild 또는 bare workflow로 내려갈 때 필요한 background recorder 기대치를 문서화합니다.

## iOS

- `UIBackgroundModes = audio`
- `NSMicrophoneUsageDescription`
- 로컬 원본 오디오 유지
- background URLSession handoff

## Android

- `RECORD_AUDIO`
- `FOREGROUND_SERVICE`
- `WAKE_LOCK`
- microphone foreground service

## Notes

- 실제 네이티브 빌드가 없어도 코드와 운영 문서가 같은 계약을 보도록 남깁니다.
- 이 scaffold는 build artifact가 아니라 요구사항의 단일 출처입니다.
- 현재 구현은 `expo-audio` 기반 start / pause / resume / local save / discard 까지 포함합니다.
- 로컬 저장 루트는 `FileSystem.documentDirectory/mystt-recorder` 입니다.
- 녹음 중 복구 상태는 `FileSystem.documentDirectory/mystt-recorder/runtime-state.json` 에 남깁니다.
- 저장된 세션 증거는 `recordings/<session-id>/session.json` 에 남기며, checksum / background 전환 횟수 / 선택 입력 / 업로드 큐 정보가 포함됩니다.
- Tauri 모바일 네이티브 플러그인 골격은 `tauri-plugin-recorder/` 아래에 분리해 두었습니다.
- background audio 성공 판정은 실기기 잠금 화면 증거가 있어야 합니다.
