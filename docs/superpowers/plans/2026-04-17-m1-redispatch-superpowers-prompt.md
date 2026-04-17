# M1 Re-Dispatch Prompt With Superpowers

아래 프롬프트를 새 컨텍스트에 그대로 붙여 넣어.

```text
이 저장소에서 M1만 구현해.

시작할 때 반드시 아래 superpowers 스킬 순서로 진행해:

1. `superpowers:using-superpowers`
2. `superpowers:receiving-code-review`
3. 서브에이전트를 쓸 수 있으면 `superpowers:subagent-driven-development`
4. 서브에이전트를 못 쓰면 `superpowers:executing-plans`
5. 완료 주장 전에 `superpowers:verification-before-completion`

작업 전에 아래 파일을 순서대로 읽어:

1. `AGENTS.md`
2. `services/api/AGENTS.md`
3. `apps/web/AGENTS.md`
4. `graphify-out/GRAPH_REPORT.md`
5. `graphify-out/wiki/index.md`
6. `graphify-out/graph.json`
7. `docs/superpowers/plans/2026-04-17-soniox-async-review-followups.md`

이 작업은 code review findings를 받은 뒤 후속 수정하는 작업이므로, feedback을 무조건 수용하지 말고 먼저 코드베이스 기준으로 검증해. 다만 아래 3개 finding은 이미 이 저장소 기준으로 확인된 범위로 보고 진행해:

1. `[P1]` `apps/web/components/live-recorder.tsx:1889-1909`
   - source audio 업로드 후 Soniox async 결과를 기다리지 않고 로컬 transcript/fallback text로 바로 notes를 생성하고 세션을 완료 처리함
2. `[P2]` `services/api/src/routes/uploads.ts:43-67`
   - multipart source-audio 업로드가 전체 파일을 RAM에 모아서 `Buffer.concat()` 후 처리함
3. `[P2]` `services/api/src/lib/store.ts:401-409`
   - cleanup 성공 후 `cleanupLastError`를 지우려 해도 merge 로직 때문에 예전 에러가 남음

이번 컨텍스트에서는 `M1`만 구현해.
`M2`, `M3`, `M4`는 건드리지 말고 필요한 TODO나 리스크만 남겨.

M1 목표:

- web recorder가 source-audio 업로드 응답의 `fileId`를 사용해서 `/v1/sessions/:sessionId/process`를 호출하도록 바꿔
- 세션 최종 완료는 Soniox async transcript, normalized transcript artifacts, structured notes가 만들어진 뒤에만 가능하게 해
- 실시간 STT와 최종본 생성 lane을 분리해
- 테스트 가능하도록 `apps/web/lib/finalize-portal-recording.ts` 같은 orchestration helper를 도입해도 좋아
- 가능하면 `services/api/src/routes/notes.ts`에 session-backed direct transcript finalization을 막는 최소한의 guard도 같이 넣어

중요한 해석:

- 지금도 Soniox realtime STT와 OpenAI 요약/보조 자막은 존재한다
- 하지만 P1은 “최종 저장 완료 경로가 Soniox async 최종 transcript를 source of truth로 쓰지 않는다”는 의미다
- 따라서 실시간 자막 lane 자체를 없애는 게 아니라, 저장 완료 lane을 async Soniox 최종본으로 다시 연결해야 한다

제약:

- raw audio survival이 최우선이다
- false-success UI를 만들지 마
- 영구 API 키를 클라이언트 번들에 넣지 마
- 불필요한 구조 변경은 하지 마
- 기존 패턴을 최대한 유지하되, 테스트 가능한 작은 helper 분리는 허용

구현 가이드:

- 먼저 현재 `generateSessionNotes({ sessionId, mode, transcript })` 호출이 왜 문제인지 코드로 다시 확인해
- `apps/web/lib/api.ts`에 `/v1/sessions/:sessionId/process`용 typed client 추가를 우선 고려해
- `apps/web/components/live-recorder.tsx`에서는 직접 notes 생성 대신 `upload -> process` orchestration helper를 호출하게 바꿔
- `services/api/src/routes/notes.ts`는 sessionId가 있는 direct transcript finalization을 막는 최소 guard만 넣고, 범위를 넓히지 마
- 완료 상태 표시는 실제 async pipeline 결과 snapshot 기준으로만 반영해

검증:

- `pnpm --filter @mystt/web test -- finalize-portal-recording.test.ts`
- `pnpm --filter @mystt/web typecheck`
- `pnpm --filter @mystt/api typecheck`
- `pnpm graphify:build`

작업 방식:

- 구현 전에 현재 플랜(`docs/superpowers/plans/2026-04-17-soniox-async-review-followups.md`)의 M1 범위를 비판적으로 검토해
- 치명적인 갭이 없으면 그대로 진행해
- 갭이 있으면 작업 멈추고 정확히 어떤 갭인지 먼저 설명해
- 가능하면 TDD에 가깝게 작은 테스트부터 추가해

완료 보고 형식:

1. 바꾼 내용
2. 왜 이 변경이 P1을 막는지
3. 실행한 검증
4. 남은 리스크
5. 다음 milestone(M2/M3/M4) 진입 조건
```
