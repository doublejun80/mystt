# M3 Re-Dispatch Prompt With Superpowers

아래 프롬프트를 새 컨텍스트에 그대로 붙여 넣어.

```text
이 저장소에서 M3만 구현해.

시작할 때 반드시 아래 superpowers 스킬 순서로 진행해:

1. `superpowers:using-superpowers`
2. `superpowers:receiving-code-review`
3. 서브에이전트를 쓸 수 있으면 `superpowers:subagent-driven-development`
4. 서브에이전트를 못 쓰면 `superpowers:executing-plans`
5. 완료 주장 전에 `superpowers:verification-before-completion`

작업 전에 아래 파일을 순서대로 읽어:

1. `AGENTS.md`
2. `services/api/AGENTS.md`
3. `graphify-out/GRAPH_REPORT.md`
4. `graphify-out/wiki/index.md`
5. `graphify-out/graph.json`
6. `docs/superpowers/plans/2026-04-17-soniox-async-review-followups.md`

이 작업은 code review findings를 받은 뒤 후속 수정하는 작업이므로, feedback을 무조건 수용하지 말고 먼저 코드베이스 기준으로 검증해. 다만 아래 3개 finding은 이미 이 저장소 기준으로 확인된 범위로 보고 진행해:

1. `[P1]` `apps/web/components/live-recorder.tsx:1889-1909`
   - source audio 업로드 후 Soniox async 결과를 기다리지 않고 로컬 transcript/fallback text로 바로 notes를 생성하고 세션을 완료 처리함
2. `[P2]` `services/api/src/routes/uploads.ts:43-67`
   - multipart source-audio 업로드가 전체 파일을 RAM에 모아서 `Buffer.concat()` 후 처리함
3. `[P2]` `services/api/src/lib/store.ts:401-409`
   - cleanup 성공 후 `cleanupLastError`를 지우려 해도 merge 로직 때문에 예전 에러가 남음

이번 컨텍스트에서는 `M3`만 구현해.
`M1`, `M2`, `M4`는 건드리지 말고 필요한 TODO나 리스크만 남겨.
이미 들어간 M1의 “finalize through async process” 계약과 M2의 memory-safe upload lane은 깨지지 않게 유지해.

M3 목표:

- cleanup 재시도가 성공했을 때 이전 `cleanupLastError` 값이 snapshot/store에 남지 않도록 고쳐
- `saveTranscriptionMetadata()` merge semantics가 “필드가 아예 없는 경우는 이전 값 유지, `cleanupLastError: undefined` 를 명시한 경우는 기존 값을 clear” 하도록 만들어
- 이 동작을 재현하는 targeted test를 추가해
- 변경 범위는 가능한 한 `services/api/src/lib/store.ts` 와 해당 테스트에 국한해

중요한 해석:

- 이 이슈의 본질은 cleanup 성공 경로가 이미 `cleanupLastError: undefined` 를 의도적으로 보내고 있어도 store merge 로직이 `??` 때문에 이전 에러 문자열을 되살린다는 점이다
- 따라서 이번 M3의 핵심은 cleanup metadata merge semantics correction이지, cleanup workflow 자체를 재설계하는 것이 아니다
- 다른 필드까지 광범위하게 merge 규칙을 바꾸지 말고, 실제 버그를 해결하는 최소 범위로 진행해
- runbook/evals(M4)나 업로드 lane(M2)은 이번 범위가 아니다

제약:

- raw audio survival과 async finalization 계약을 건드리지 마
- cleanup 성공 이후 stale error가 남는 문제만 정확히 해결해
- 불필요하게 API contract를 넓히지 마
- 기존 store/persistence 패턴은 최대한 유지해
- 명시적 clear semantics가 필요한 필드만 presence check를 적용하고, 나머지 필드는 근거 없이 함께 바꾸지 마

구현 가이드:

- 먼저 현재 `services/api/src/lib/store.ts` 의 `saveTranscriptionMetadata()` merge 로직과, `services/api/src/lib/session-process.ts` 에서 cleanup 성공 시 어떤 payload를 보내는지 코드로 다시 확인해
- 가능하면 `services/api/src/lib/store.test.ts` 를 새로 만들어 stale `cleanupLastError` 재현 테스트부터 추가해
- 테스트는 “이전 update에서 cleanupLastError가 있었고, 이후 성공 update가 `cleanupLastError: undefined` 를 명시했을 때 최종 snapshot에서는 clear된다”는 시나리오를 잠가
- 구현은 `"cleanupLastError" in input ? input.cleanupLastError : previous?.cleanupLastError` 같은 explicit presence check를 우선 고려해
- 필요하다면 같은 의미를 가진 다른 clearable 필드가 있는지 확인하되, 이번 M3에서 꼭 필요한 범위가 아니면 건드리지 마

검증:

- `pnpm --filter @mystt/api test -- store.test.ts`
- `pnpm --filter @mystt/api typecheck`
- `pnpm --filter @mystt/api build`
- `pnpm graphify:build`

작업 방식:

- 구현 전에 현재 플랜(`docs/superpowers/plans/2026-04-17-soniox-async-review-followups.md`)의 M3 범위를 비판적으로 검토해
- 치명적인 갭이 없으면 그대로 진행해
- 갭이 있으면 작업 멈추고 정확히 어떤 갭인지 먼저 설명해
- 가능하면 TDD에 가깝게 작은 테스트부터 추가해
- 마지막에 `cleanupLastError` clear semantics가 실제로 test에서 잠겼는지 확인해

완료 보고 형식:

1. 바꾼 내용
2. 왜 이 변경이 stale `cleanupLastError` 문제를 막는지
3. 실행한 검증
4. 남은 리스크
5. 다음 milestone(M4) 진입 조건
```
