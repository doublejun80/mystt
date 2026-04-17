# AGENTS

- 모바일은 `local-first recorder`다. 실시간 스트림보다 로컬 파일 보존을 우선한다.
- background, interruption, Bluetooth route 변경은 상태 머신과 운영 로그를 함께 남긴다.
- 새로운 녹음 기능은 iOS `audio` background mode와 Android foreground service 시나리오를 문서와 코드에서 함께 다룬다.
- 원본 오디오 경로, chunk rotation, 업로드 큐 상태가 UI에서 보이도록 유지한다.
- `src/domain/background-recorder.ts`를 phase, queue, native scaffold의 단일 계약으로 본다.
- `native/*` scaffold 파일은 실제 빌드 산출물이 아니라 네이티브 기대치를 문서화한 기준점이다.
