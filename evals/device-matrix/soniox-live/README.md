# Soniox Live Lane

이 lane은 업로드, async transcription, cleanup이 끝까지 이어지는지 확인한다. live credential 또는 webhook 증거가 없으면 자동 성공으로 보지 않는다.

## What to Verify

- `source_audio.soniox_uploaded` audit event가 생성되고, `fileId`, `location`, `fileName`, `byteLength`, `sha256`, `contentType`가 남는지 본다.
- `session.process.enqueued`가 기록되는지 본다.
- `transcription.metadata.updated`와 `transcription.cleanup.updated`가 순서대로 남는지 본다.
- `cleanupStatus`, `cleanupTargets`, `cleanupLastError`가 최종 상태를 설명하는지 본다.
- async 완료 후 uploaded file / transcription cleanup이 설계대로 정리되는지 본다.

## Automated Verification

- public API 응답과 audit event를 함께 확인하되, 내부 `location`은 audit event에서만 캡처한다.
- `source_audio.soniox_uploaded` payload 확인
- `session.process.enqueued` payload 확인
- `transcription.metadata.updated` payload 확인
- `transcription.cleanup.updated` payload 확인

## Manual Evidence Required

- live Soniox credential 또는 webhook 응답 증거
- retry / dedupe / correlation handle 증거: 같은 session 또는 transcription을 다시 시도할 때 어떤 식별자, 요청 경로, header, job id, or session id로 동일 흐름임을 구분했는지 적는다
- 실제 업로드 대상과 cleanup 대상이 분리되는지에 대한 확인
- async 완료 후 cleanup 상태가 반영된 화면 또는 로그

## Capture Checklist

- `source_audio.soniox_uploaded.fileId`
- `source_audio.soniox_uploaded.location` (audit only)
- `source_audio.soniox_uploaded.fileName`
- `source_audio.soniox_uploaded.byteLength`
- `source_audio.soniox_uploaded.sha256`
- `source_audio.soniox_uploaded.contentType`
- `transcription.metadata.updated`
- `transcription.cleanup.updated`
- `cleanupStatus`
- `cleanupTargets`
- `cleanupLastError`
- `session.process.enqueued`
- retry / dedupe correlation handle

## Pass / Fail

- Pass: upload, transcription, cleanup가 모두 audit trail로 설명 가능하다.
- Fail: fileId 또는 location이 빠지거나, cleanup 상태가 남지 않거나, async 완료 뒤 정리 증거가 없다.
- Retry: live credential 범위를 좁히고, cleanup 실패 시 원인과 재시도 조건을 같이 적는다.
