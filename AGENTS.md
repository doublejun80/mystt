# AGENTS

## Mission

이 저장소는 `화면이 꺼져도 살아남는 녹음`을 최우선으로 하는 회의 기록 플랫폼입니다.
모든 구현은 아래 우선순위를 따라야 합니다.

1. 원본 오디오 생존
2. 업로드/전사 파이프라인의 내결함성
3. 구조화된 회의록 품질
4. 메일/포털 경험
5. 실시간 자막의 화려함

## Non-Negotiables

- 영구 `SONIOX_API_KEY` 또는 LLM API 키를 모바일/웹 번들에 넣지 말 것
- 로컬 원본 오디오는 업로드 완료와 해시 검증 전 삭제하지 말 것
- background audio 관련 변경은 iOS/Android 실기기 증거 없이는 완료로 간주하지 말 것
- Soniox async 완료 후 uploaded file / transcription cleanup 작업을 반드시 설계할 것
- 요약/회의록 출력은 schema 기반 JSON을 우선하고 HTML/DOCX는 후처리로 만들 것
- webhook, queue, 메일 발송은 항상 idempotency 키를 고려할 것
- 기능 추가 시 rollback plan, 관찰 포인트, 테스트 기준을 함께 남길 것
- Postgres 스키마와 MinIO object layout은 운영 문서와 함께 갱신할 것
- live provider slice를 바꾸면 `infra/runbooks/live-slice.md`와 `evals/README.md`를 같이 업데이트할 것

## Repository Operating Model

- 루트 규칙 외에 각 하위 디렉터리의 `AGENTS.md`를 추가로 따른다.
- 동일 파일을 여러 에이전트가 건드릴 가능성이 있으면 worktree 또는 명확한 파일 소유권으로 분리한다.
- 새로운 반복 실수가 보이면 이 파일이나 skill을 업데이트해서 재발을 막는다.

## Done When

- 구현 코드
- 검증 코드 또는 검증 절차
- 운영 관찰 포인트
- 실패 시 복구/재시도 전략

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `pnpm graphify:build` to keep the graph current (AST-only, no API cost)
