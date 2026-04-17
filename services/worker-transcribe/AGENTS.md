# AGENTS

- 이 워커는 local upload 이후의 Soniox async 처리와 cleanup 계획을 책임진다.
- 업로드 완료, job 생성, webhook 완료, 리소스 삭제는 각각 독립적으로 재시도 가능해야 한다.
- 실시간 자막과 최종 transcript를 섞지 말고 provenance를 분리한다.

