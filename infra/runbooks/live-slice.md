# Live Vertical Slice Runbook

이 절차는 Soniox/OpenAI live path가 실제로 살아 있는지 확인할 때 사용합니다.

## Preconditions

- `.env`에 `SONIOX_API_KEY`와 `OPENAI_API_KEY`가 설정되어 있어야 합니다.
- `pnpm install`이 끝나 있어야 합니다.
- `api`가 `4100` 포트에서 떠 있어야 합니다.

## Finalization Contract

- 웹/모바일 live caption은 preview 전용입니다. 세션은 아래 조건을 모두 만족하기 전에는 `completed`로 보면 안 됩니다.
- 원본 source audio가 로컬 또는 object storage에 먼저 stage되어야 합니다.
- source audio 업로드 결과로 받은 `fileId` 또는 `audioUrl`로 `/v1/sessions/:sessionId/process`가 호출되어야 합니다.
- Soniox async 전사가 끝난 뒤 normalized transcript artifact와 structured notes가 생성되어야 합니다.
- cleanup metadata가 기록되어야 하며, cleanup 재시도 성공 후에는 이전 `cleanupLastError`가 남지 않아야 합니다.

## Checks

1. `curl http://127.0.0.1:4100/health`
2. `curl -X POST http://127.0.0.1:4100/v1/system/providers/check`
3. `pnpm exec tsx scripts/vertical-slice.ts --audio_url https://soniox.com/media/examples/coffee_shop.mp3 --title "Smoke" --mode meeting --project smoke`
4. 웹 포털 녹음을 한 번 끝까지 수행하고, recorder phase는 `uploading -> processing/saved`, API 세션 상태는 `transcribing -> summarizing -> emailing -> completed`로 진행되는지 확인한다.
5. 웹에서 `pause/resume`, `모드별 자동 튜닝`, `엔드포인트 지연`, `context terms`를 바꿔 보고 실제 자막 세션과 저장 audit payload가 반영되는지 확인한다.
6. source-audio 업로드 응답과 audit payload에 `fileId`, `byteLength`, `sha256`, `location`이 남는지 확인한다.
7. `/v1/sessions/:sessionId/process`를 건너뛰거나 실패시키면 최종 notes가 생기지 않고, 세션이 거짓 `completed`로 끝나지 않는지 확인한다.
8. 모바일 네이티브에서는 [mobile-native-recorder.md](/Volumes/mac_dock/github/mystt/infra/runbooks/mobile-native-recorder.md) 절차로 로컬 원본 저장과 background 전환 로그를 따로 확인한다.
9. 노트북 장시간 테스트는 `pnpm --filter @mystt/desktop tauri dev`로 데스크톱 셸을 띄워 로컬 포털 또는 운영 도메인 연결을 확인한다.
10. 데스크톱 설정에서 `장시간 녹음 보호`를 켜고, 로컬 recorder 루트와 runtime-state 경로, sessions 인덱스가 보이는지 확인한다.
11. 세션 완료 후 `snapshot.transcription.cleanupStatus`가 `completed` 또는 최소한 `failed`로 남는지 확인하고, `POST /v1/sessions/:sessionId/cleanup/soniox` 재시도 성공 후 이전 `cleanupLastError`가 지워지는지 확인한다.

## Expected Output

- Soniox temporary key or async job creation succeeds
- Transcript fetch returns token/segment output
- OpenAI structured notes parse succeeds
- Email payload is rendered even when `--send` is omitted
- source audio 업로드 결과에 `fileId`, `byteLength`, `sha256`, `location`이 포함된다
- 웹 포털 세션은 source audio 업로드 직후 browser/OpenAI fallback text만으로 `completed`가 되지 않는다
- `/v1/sessions/:sessionId/process` 최종화가 끝난 뒤에만 transcript artifact와 notes가 함께 존재하는 `completed` snapshot이 나온다
- 실시간 웹 세션은 최대 `300분` 한도를 넘기지 않아야 하며, 2시간 연속 테스트에서는 끊김 없이 유지되어야 함
- `pause()` 후 같은 세션으로 `resume()`이 가능해야 함
- `meeting / speech / interview` 모드에 따라 diarization / endpoint delay / low confidence 처리 기본값이 달라져야 함
- `max_endpoint_delay_ms`와 `context.terms` 변경이 다음 녹음 세션에 반영되어야 함
- 데스크톱 keep-awake 상태가 `켜짐`으로 바뀌고, 장시간 세션 중 절전 방지 레인이 유지되어야 함

## Observability

- `입력 진단 보기`에서 `연결 상태`, `토큰 수`, `PCM 청크 수`, `엔드포인트 지연`, `실시간 세션 한도`를 함께 본다
- 장시간 녹음은 raw PCM 대신 브라우저 압축 아카이브와 IndexedDB 로컬 보존을 우선 사용하므로, 로컬 오디오 미리듣기가 마지막까지 생성되는지 확인한다
- `session.created` audit payload에 `realtimeOptions.endpointDelayMs`, `realtimeOptions.contextTerms`, `enableSpeakerDiarization` 같은 mode-adjusted 옵션이 남아야 한다
- `source_audio.staged`, `source_audio.soniox_uploaded`, `session.process.enqueued`, `session.process.inline_fallback`, `transcription.metadata.updated`, `transcription.cleanup.updated`, `transcript.artifacts.saved` audit 이벤트를 순서대로 본다
- `source_audio.soniox_uploaded`에는 `fileId`, `location`, `fileName`, `byteLength`, `sha256`, `contentType`이 남아야 한다
- `transcription.metadata.updated`에는 `transcriptionId`, `status`, `filename`, `audioUrl`, `fileId`, `cleanupTargets`, `cleanupStatus`가 남아야 한다
- `transcription.cleanup.updated`에는 `transcriptionId`, `cleanupTargets`, `cleanupStatus`, `cleanupRequestedAt`, `cleanupCompletedAt`, `cleanupLastError`가 남아야 한다
- transcript artifact와 notes가 둘 다 없는데 세션만 `completed`이면 계약 위반으로 본다
- 모바일 네이티브는 `운영 로그`, `선택 입력 장치`, `로컬 저장 경로`, `session.json` sidecar를 함께 확인한다
- 데스크톱 Tauri는 `app data dir`, `recorder root`, `runtime-state path`, `sessions 인덱스`, `keep-awake 상태`를 설정 안에서 확인한다

## Failure Triage

- `401/403` from Soniox: verify `SONIOX_API_KEY` and webhook auth settings
- `OpenAI HTTP 401/429`: verify API key or rate limit
- `EADDRINUSE`: another API process is already bound to `4100`
- source audio 업로드는 성공했는데 최종 notes가 비어 있으면 `/v1/sessions/:sessionId/process` 호출 여부, `session.process.enqueued` 또는 `session.process.inline_fallback` audit 이벤트, `fileId` 기록 여부를 먼저 본다
- 세션이 transcript artifact나 notes 없이 `completed`가 되면 browser/OpenAI fallback 최종화가 다시 들어온 것이므로 즉시 회귀로 취급한다
- 장시간 녹음 중 브라우저 메모리가 급증하면 IndexedDB 보존이 실제로 붙었는지, `MediaRecorder` 지원 여부와 fallback raw WAV 경로를 확인
- 300분 근처에서 세션이 종료되면 Soniox 한도에 도달한 것이므로 새 세션 rollover를 열어야 함
- Soniox cleanup이 `failed`로 남으면 `fileId` / `transcriptionId`가 실제로 이미 삭제되었는지 확인하고, 수동 재시도 endpoint로 상태를 정리한다
- cleanup 재시도 성공 후에도 예전 `cleanupLastError`가 남아 있으면 `saveTranscriptionMetadata()` merge semantics 회귀로 보고 `services/api/src/lib/store.test.ts`를 먼저 확인한다
