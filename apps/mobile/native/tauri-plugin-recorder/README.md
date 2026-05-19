# Tauri Mobile Recorder Plugin Scaffold

이 디렉터리는 Tauri 2 모바일 셸에서 `화면이 꺼져도 살아남는 녹음`을 구현할 때 사용할 네이티브 플러그인 골격입니다.

## Why This Exists

- 웹뷰 수명과 별개로 원본 오디오를 유지해야 합니다.
- iOS/Android 네이티브 녹음 어댑터가 `runtime-state.json` 과 `sessions.json` 계약을 동일하게 써야 합니다.
- 데스크톱 Tauri의 recorder ledger 경로와 관찰 포인트를 모바일에서도 재사용할 수 있게 맞춥니다.

## Shared Contract

- 로컬 recorder 루트: `mystt-recorder`
- 런타임 상태 파일: `mystt-recorder/runtime-state.json`
- 세션 인덱스 파일: `mystt-recorder/sessions.json`
- 세션 증거 파일: `mystt-recorder/recordings/<session-id>/session.json`

이 계약은 `packages/audio-core/src/tauri-recorder.ts` 와
`apps/desktop/src-tauri/src/recorder_store.rs` 를 기준으로 유지합니다.

## iOS Responsibilities

- `AVAudioSession` background audio mode
- Bluetooth / built-in mic route selection
- interruption handling
- chunk flush 전에 runtime-state write
- save/discard 시 sessions.json 갱신

## Android Responsibilities

- foreground service microphone
- wake lock / battery optimization awareness
- audio focus interruption handling
- service 재시작 시 runtime-state restore
- save/discard 시 sessions.json 갱신

## Done Criteria

- 화면 꺼짐 상태에서 120분 녹음 후 `session.json` 과 원본 파일이 남아 있을 것
- 강제 종료 후 앱 재실행 시 `runtime-state.json` 으로 복구 후보를 보여 줄 것
- upload handoff 이후에도 원본 파일은 해시 검증 전 삭제하지 않을 것
