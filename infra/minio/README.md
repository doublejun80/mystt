# MinIO

MinIO는 오디오 원본과 파생 아티팩트의 객체 저장소입니다.

## Buckets

- `audio`: 업로드된 원본 오디오, chunk, 검증용 파일
- `artifacts`: raw transcript, clean transcript, notes, email preview, exports

## Object Layout

MinIO location strings are `minio://<bucket>/sessions/<session_id>/<file>`.

- `audio/sessions/<session_id>/source-<sha256-prefix>-<source-file-name>`
- `artifacts/sessions/<session_id>/raw_transcript.json`
- `artifacts/sessions/<session_id>/clean_transcript.md`
- `artifacts/sessions/<session_id>/meeting_notes.json`
- `artifacts/sessions/<session_id>/meeting_notes.html`
- `artifacts/sessions/<session_id>/meeting_notes.docx`
- `artifacts/sessions/<session_id>/email_preview.html`

## Retention

- 원본 오디오는 업로드와 해시 검증 완료 전 삭제하지 않습니다.
- source audio 객체는 같은 원본 파일명이 다시 들어와도 덮어쓰기 위험을 낮추기 위해 해시 prefix가 붙은 이름으로 저장합니다.
- `source_audio_uploads` Postgres ledger는 기존 `audio/<session_id>/...` 객체 위치를 참조하며, 같은 SHA/길이 재시도에서 Soniox file id만 재사용합니다.
- `sessions.local_audio_path`는 객체 readback 해시 검증이 끝난 뒤에만 commit됩니다. `source_audio.staged`만 있고 `source_audio.verified`가 없으면 후보 객체는 남겨 두고 재시도 또는 수동 확인을 먼저 합니다.
- Soniox에서 되돌려 받은 transcript는 Postgres 메타데이터와 함께 보관하고, 불필요한 공급자 측 리소스는 cleanup 대상입니다.
