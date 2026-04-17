# MinIO

MinIO는 오디오 원본과 파생 아티팩트의 객체 저장소입니다.

## Buckets

- `audio`: 업로드된 원본 오디오, chunk, 검증용 파일
- `artifacts`: raw transcript, clean transcript, notes, email preview, exports

## Object Layout

- `audio/<session_id>/source.<ext>`
- `audio/<session_id>/chunks/chunk-0001.m4a`
- `artifacts/<session_id>/raw_transcript.json`
- `artifacts/<session_id>/clean_transcript.md`
- `artifacts/<session_id>/meeting_notes.json`
- `artifacts/<session_id>/meeting_notes.html`
- `artifacts/<session_id>/meeting_notes.docx`
- `artifacts/<session_id>/email_preview.html`

## Retention

- 원본 오디오는 업로드와 해시 검증 완료 전 삭제하지 않습니다.
- Soniox에서 되돌려 받은 transcript는 Postgres 메타데이터와 함께 보관하고, 불필요한 공급자 측 리소스는 cleanup 대상입니다.

