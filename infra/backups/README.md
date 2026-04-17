# Backups

백업은 최소 세 갈래로 나눕니다.

1. Postgres 메타데이터
2. MinIO 오디오/아티팩트 버킷
3. 환경 변수와 reverse proxy 설정

## Suggested Rhythm

- Postgres: 매일 `pg_dump` + 주간 전체 스냅샷
- MinIO: 버전 관리 또는 버킷 동기화 백업
- Caddy/compose/env: Git + 오프박스 암호화 복제

## Restore Drill

- 임시 스택에서 `sessions`, `artifacts`, `email` 링크가 복구되는지 확인
- Soniox 원격 리소스는 장기 백업 대상이 아니므로 MinIO와 Postgres 복구가 핵심
- 복구 후 `infra/runbooks/live-slice.md`의 provider check와 vertical slice를 다시 실행한다
