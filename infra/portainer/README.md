# Portainer

Portainer는 홈랩 운영 가시성을 위한 선택적 계층입니다.

## Use

- `infra/docker/docker-compose.yml` 안의 `portainer` 서비스를 사용합니다.
- OrbStack 또는 Docker Desktop에서 `/var/run/docker.sock` 접근이 가능해야 합니다.
- 운영 스택을 Portainer에서 배포할 때도 webhook URL, MinIO 버킷, Postgres 백업 정책을 별도로 확인합니다.

## Minimum Checks

- `reverse-proxy`, `api`, `web`, `worker-*`, `postgres`, `redis`, `minio`, `mailpit` 상태 확인
- `worker-transcribe`와 `worker-summarize` 재시작 폭주 여부 확인
- 볼륨 크기와 MinIO bucket growth 확인

