# soniox-async-webhooks

비동기 전사, 웹훅, 정리 작업을 바꿀 때 사용하는 스킬입니다.

## Focus

- async job 생성
- webhook idempotency
- transcript normalization
- Soniox 리소스 cleanup

## Checklist

1. session -> upload -> transcription job 생성 흐름을 상태로 기록한다.
2. webhook 중복 수신을 정상으로 처리한다.
3. 최종 transcript 저장 후 Soniox file/transcription 삭제 시점을 설계한다.
4. 실패한 cleanup도 별도 retry lane으로 분리한다.

