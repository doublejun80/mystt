# Remaining Hardening Fresh-Context Prompt

Use this prompt in a fresh Codex context for `/Volumes/mac_dock/github/mystt`.

```text
# AGENTS.md instructions for /Volumes/mac_dock/github/mystt

<INSTRUCTIONS>
Follow the repository AGENTS files and graphify rules before doing anything else.
</INSTRUCTIONS>

<environment_context>
  <cwd>/Volumes/mac_dock/github/mystt</cwd>
  <shell>zsh</shell>
</environment_context>

/Volumes/mac_dock/github/mystt 저장소에서 review follow-up 재검증 후 남은 hardening 작업만 이어서 진행해줘.

중요 규칙:
- 시작하자마자 `superpowers:using-superpowers`부터 적용해.
- 이 저장소의 AGENTS 규칙과 graphify 규칙을 먼저 읽고 따라.
- 현재 컨텍스트 요약은 참고만 하고, 무조건 코드와 실행 결과로 재검증해.
- git metadata가 없을 수 있으니 `git status`/SHA 전제에 의존하지 말고, 파일 내용과 실행 결과 기준으로 판단해.
- 변경 전에는 짧은 실행 계획을 위해 `superpowers:writing-plans`를 적용해.
- 버그/리스크 수정에 들어가면 반드시 `superpowers:systematic-debugging` 후 `superpowers:test-driven-development` 순서로 진행해.
- 가능하면 `superpowers:subagent-driven-development`, 불가능하면 `superpowers:executing-plans`로 진행해.
- 완료 주장 전에는 `superpowers:requesting-code-review`와 `superpowers:verification-before-completion`을 적용해.
- 모든 수정과 검증이 끝난 뒤에만 `superpowers:finishing-a-development-branch`를 고려해.

먼저 읽을 파일:
1. `/Volumes/mac_dock/github/mystt/AGENTS.md`
2. `/Volumes/mac_dock/github/mystt/services/api/AGENTS.md`
3. `/Volumes/mac_dock/github/mystt/infra/AGENTS.md`
4. `/Volumes/mac_dock/github/mystt/graphify-out/GRAPH_REPORT.md`
5. `/Volumes/mac_dock/github/mystt/graphify-out/wiki/index.md`
6. `/Volumes/mac_dock/github/mystt/docs/superpowers/plans/2026-04-17-remaining-hardening-handoff.md`

이미 검증/수정된 것으로 보이지만 신뢰하지 말고 다시 확인할 범위:
- `/Volumes/mac_dock/github/mystt/services/api/src/lib/session-process.ts`
- `/Volumes/mac_dock/github/mystt/services/api/src/lib/session-process.test.ts`
- `/Volumes/mac_dock/github/mystt/services/api/src/lib/store.ts`
- `/Volumes/mac_dock/github/mystt/services/api/src/lib/store.test.ts`
- `/Volumes/mac_dock/github/mystt/services/api/src/routes/webhooks.ts`

이번 세션의 목표:
1. 남은 hardening plan이 코드와 아직 일치하는지 재검증
2. plan의 남은 리스크 3건만 우선순위대로 처리
3. 관련 테스트를 fresh하게 red/green으로 실행
4. required verification을 다시 수행
5. 끝나면 남은 리스크와 다음 단계만 간단히 정리

핵심 남은 리스크:
- `waitForTerminalSessionSnapshot()`가 snapshot 없음 상태를 성공처럼 반환함
- `processSessionVerticalSlice()` polling loop가 `getAsyncTranscription()` 일시 miss 한 번에 너무 일찍 멈춤
- `saveTranscriptionMetadata()`의 reprocessing replacement contract가 cleanup envelope에 암묵적으로 결합되어 있음
- stale reprocessing path에 persistence round-trip 검증이 약함

최소 검증 명령:
- `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts src/lib/store.test.ts`
- `pnpm --filter @mystt/api typecheck`
- `pnpm --filter @mystt/api build`
- `pnpm validate`
- `pnpm graphify:build`

완료 보고 형식:
1. 현재 상태 재검증 결과
2. 실제로 처리한 작업
3. 실행한 검증
4. 아직 남은 리스크
5. 다음 최선의 진행안
```
