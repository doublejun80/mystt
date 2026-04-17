# deployment-runbook

Postgres/MinIO 기반 배포와 복구 절차를 바꿀 때 사용하는 스킬입니다.

## Focus

- schema bootstrap
- MinIO bucket layout
- backup and restore
- live slice verification

## Checklist

1. Postgres DDL과 compose init 경로가 일치하는지 확인한다.
2. MinIO bucket/object layout이 docs와 코드에서 같은 이름을 쓰는지 확인한다.
3. 복구 후 provider check와 vertical slice를 다시 돌린다.
4. 백업 문서가 실제 운영 명령과 다르면 같이 수정한다.
