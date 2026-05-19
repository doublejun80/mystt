# Postgres

이 저장소의 운영 데이터는 세션 중심으로 저장합니다.

## Tables

- `sessions`: 사용자가 만든 회의/강연/인터뷰 세션의 현재 상태
- `session_participants`: 세션에 연결된 참가자 메타데이터
- `session_artifacts`: transcript, notes, email preview 같은 생성 산출물 상태
- `transcription_jobs`: Soniox async job 상태, 원본 참조, cleanup 상태/재시도 메타데이터
- `source_audio_uploads`: `session_id + sha256 + byte_length` 기준 원본 오디오 업로드 ledger와 재사용 가능한 Soniox file id
- `transcript_cache`: 정규화 transcript text와 UI/요약 재사용용 normalized JSON
- `provider_checks`: Soniox/OpenAI connectivity probe 결과
- `note_artifacts`: 구조화된 회의록 JSON 원본
- `webhook_fingerprints`: Soniox webhook idempotency fingerprint
- `audit_events`: 재시도, webhook, 발송 같은 운영 이벤트

## Audit Trail

- `audit_events.event_id`는 local fallback과 Postgres를 오갈 때도 동일한 이벤트를 추적하기 위한 외부 식별자입니다.
- `source_audio.staged`, `source_audio.verified`, `source_audio.upload_ledger.updated`, `source_audio.soniox_uploaded`, `source_audio.soniox_upload_reused`, `source_audio.stage_failed`, `session.status.updated`, `transcription.metadata.updated`, `transcription.cleanup.updated`, `transcript.artifacts.saved`, `notes.artifacts.saved`, `soniox.webhook.*` 이벤트가 기본 추적 대상입니다.

## Bootstrap

- `infra/docker/docker-compose.yml`에서 Postgres는 `../postgres/init`의 SQL을 초기화 스크립트로 읽습니다.
- 초기 기동 이후에는 마이그레이션 도구로 관리하는 것을 권장하지만, v1에서는 이 스키마가 기준입니다.
- 관리형 Postgres나 빈 DB에 직접 연결할 때는 `infra/postgres/init/001_schema.sql`부터 `003_source_audio_upload_ledger.sql`까지 순서대로 선적용합니다. API의 online ensure는 후속 컬럼 보정용이며 base schema 생성을 대체하지 않습니다.

## Source Audio Upload Ledger

- 같은 세션에서 같은 `sha256`과 `byte_length`가 다시 들어오면, 저장된 원본 오디오를 해시로 재검증한 뒤 `source_audio_uploads`의 Soniox `file_id`를 재사용합니다.
- 새 원본 오디오는 먼저 객체 저장소에 `source-<sha256-prefix>-<original-file-name>` 형식으로 저장하고, readback 해시 검증이 끝난 뒤에만 `sessions.local_audio_path`를 commit합니다. `source_audio.staged`는 후보 객체 저장, `source_audio.verified`는 세션 포인터 commit을 뜻합니다.
- API가 여러 인스턴스로 떠 있으면 같은 세션 source-audio 업로드는 Postgres `pg_advisory_lock`으로 직렬화합니다. Postgres가 내려간 로컬 fallback에서는 process-local lock만 보장되므로, 장애 중 중복 업로드가 보이면 `source_audio_uploads` ledger와 audit event를 기준으로 재시도/정리합니다.
- 롤백이 필요하면 코드에서 ledger 조회를 중단해도 원본 오디오 객체와 기존 audit trail은 그대로 남습니다. 테이블을 제거해야 할 때도 먼저 `source_audio.soniox_uploaded` audit event와 `sessions.local_audio_path`가 복구 기준으로 충분한지 확인합니다.
- 관찰 포인트는 `source_audio.staged` 대비 `source_audio.verified` 누락, `source_audio.soniox_uploaded` 대비 `source_audio.soniox_upload_reused` 비율, 같은 세션의 반복 업로드 수, `source_audio_hash_conflict`/`source_audio_existing_read_failed` 오류입니다.
- 실제 Postgres ledger 검증은 compose Postgres가 켜진 상태에서 `MYSTT_RUN_POSTGRES_INTEGRATION=1 MYSTT_POSTGRES_INTEGRATION_URL=postgresql://postgres:postgres@127.0.0.1:55432/mystt pnpm --dir services/api test -- src/lib/source-audio-upload-ledger.postgres.test.ts`로 실행합니다.

## Backup Targets

- `pg_dump mystt`
- WAL가 필요해지면 별도 아카이브를 추가
- `sessions`, `session_artifacts`, `transcription_jobs`, `source_audio_uploads`, `note_artifacts`, `audit_events`는 복구 우선순위가 가장 높습니다
