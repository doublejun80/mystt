# Postgres

이 저장소의 운영 데이터는 세션 중심으로 저장합니다.

## Tables

- `sessions`: 사용자가 만든 회의/강연/인터뷰 세션의 현재 상태
- `session_participants`: 세션에 연결된 참가자 메타데이터
- `session_artifacts`: transcript, notes, email preview 같은 생성 산출물 상태
- `transcription_jobs`: Soniox async job 상태, 원본 참조, cleanup 상태/재시도 메타데이터
- `transcript_cache`: 정규화 transcript text와 UI/요약 재사용용 normalized JSON
- `provider_checks`: Soniox/OpenAI connectivity probe 결과
- `note_artifacts`: 구조화된 회의록 JSON 원본
- `webhook_fingerprints`: Soniox webhook idempotency fingerprint
- `audit_events`: 재시도, webhook, 발송 같은 운영 이벤트

## Audit Trail

- `audit_events.event_id`는 local fallback과 Postgres를 오갈 때도 동일한 이벤트를 추적하기 위한 외부 식별자입니다.
- `source_audio.staged`, `source_audio.stage_failed`, `session.status.updated`, `transcription.metadata.updated`, `transcription.cleanup.updated`, `transcript.artifacts.saved`, `notes.artifacts.saved`, `soniox.webhook.*` 이벤트가 기본 추적 대상입니다.

## Bootstrap

- `infra/docker/docker-compose.yml`에서 Postgres는 `../postgres/init`의 SQL을 초기화 스크립트로 읽습니다.
- 초기 기동 이후에는 마이그레이션 도구로 관리하는 것을 권장하지만, v1에서는 이 스키마가 기준입니다.

## Backup Targets

- `pg_dump mystt`
- WAL가 필요해지면 별도 아카이브를 추가
- `sessions`, `session_artifacts`, `transcription_jobs`, `note_artifacts`는 복구 우선순위가 가장 높습니다
