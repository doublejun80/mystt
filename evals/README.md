# Evals

이 디렉터리는 live provider path와 사용자 경험이 실제로 유지되는지 확인하는 평가 진입점입니다.

## What We Check

- 오디오 golden set에서 STT 안정성
- 요약 golden set에서 JSON schema 준수와 hallucination 방지
- 디바이스 매트릭스에서 background audio 생존성
- live slice에서 Soniox/OpenAI 연결성과 artifact 생성
- 웹 포털 최종화가 browser/OpenAI fallback text가 아니라 Soniox async 결과를 유일한 source of truth로 쓰는지
- live web recorder에서 `pause/resume`, `mode-specific tuning`, `endpoint delay`, `context terms` 반영
- source-audio 업로드가 staged file 기반으로 `fileId`, `byteLength`, `sha256`를 남기고 RAM에 전체 파일을 쌓지 않는지
- 2시간 연속 녹음 목표를 위한 장시간 세션 안정성
- mobile native recorder에서 로컬 원본 보존과 background 전환 로그
- desktop Tauri shell에서 로컬 포털 / 운영 도메인 진입
- Soniox async cleanup에서 transcription/file 리소스 삭제 상태와 재시도 가능 여부
- cleanup 재시도 성공 후 stale `cleanupLastError`가 snapshot/store에 남지 않는지

## Commands

```bash
pnpm smoke
pnpm exec tsx scripts/vertical-slice.ts --audio_url https://soniox.com/media/examples/coffee_shop.mp3 --title "Smoke" --mode meeting --project smoke
```

## Regression Checks

- 포털 녹음을 시작하고 source audio를 업로드한 뒤, UI는 `uploading -> processing/saved`, API 세션은 `transcribing -> summarizing -> emailing -> completed`로만 끝나는지 확인한다.
- `/v1/sessions/:sessionId/process`를 건너뛰거나 실패시키면 최종 notes가 생기지 않고, 세션이 거짓 `completed`로 닫히지 않는지 확인한다.
- 큰 녹음 파일을 업로드해도 API가 `Buffer.concat()` 식으로 선형 RAM 증가를 보이지 않고, 업로드 결과에 `fileId`, `byteLength`, `sha256`, `location`이 남는지 확인한다.
- cleanup 실패를 한 번 만든 뒤 재시도 성공 시 `cleanupLastError`가 clear되고 `cleanupStatus`가 최신 상태로 남는지 확인한다.

## Long Session Notes

- Soniox real-time session은 현재 최대 `300분`까지 지원한다.
- `context` 입력 한도는 최대 `8,000 tokens` 정도이며 이를 넘기면 요청이 실패할 수 있다.
- 웹 레코더는 장시간 세션에서 raw PCM 전체를 메모리에 쌓지 않고 압축 아카이브와 IndexedDB 로컬 보존을 우선 사용한다.
- 웹/모바일 live caption은 preview 전용이며, 세션 `completed`는 source audio staging, Soniox async finalization, transcript artifacts, structured notes, cleanup metadata가 모두 맞아야 한다.
- 2시간 검증 시 확인할 것:
  - 자막 토큰이 계속 증가하는지
  - `pause/resume` 후 같은 세션으로 이어지는지
  - `meeting / speech / interview` 모드에 따라 diarization / endpoint delay / confidence 강조가 달라지는지
  - 종료 후 전체 오디오 미리듣기가 생성되는지
  - `session.created` audit에 endpoint/context 옵션이 남는지
  - `source_audio.staged`, `source_audio.soniox_uploaded`, `session.process.enqueued` 또는 `session.process.inline_fallback`, `transcription.metadata.updated`, `transcript.artifacts.saved` 순서가 맞는지
  - 세션 완료 후 transcription cleanup 상태가 `completed` 또는 재시도 가능 `failed`로 남는지
  - cleanup 재시도 성공 후 이전 `cleanupLastError`가 사라지는지
  - 모바일 네이티브는 `.m4a` 로컬 파일과 `session.json` sidecar가 남는지
  - 데스크톱 셸은 로컬 3203 또는 `mystt.doublejun.digital`로 자동 진입하는지

## Evaluation Artifacts

- `audio-golden-set/manifest.json`
- `summary-golden-set/cases.json`
- `device-matrix/README.md`

## Notes

- `--dry_run`은 prompt/schema 검증용입니다.
- live 모드는 실제 Soniox/OpenAI 계정과 네트워크가 있어야 합니다.
- 결과를 비교할 때 transcript, notes JSON, email payload를 분리해서 봐야 합니다.
- `completed` snapshot인데 transcript artifact 또는 notes가 비어 있으면 회귀로 판단합니다.
