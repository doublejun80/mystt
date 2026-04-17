# M2 Re-Dispatch Prompt With Superpowers

아래 프롬프트를 새 컨텍스트에 그대로 붙여 넣어.

```text
이 저장소에서 M2만 구현해.

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

이번 컨텍스트에서는 `M2`만 구현해.
`M1`, `M3`, `M4`는 건드리지 말고 필요한 TODO나 리스크만 남겨.
이미 들어간 M1의 “finalize through async process” 계약은 깨지지 않게 유지해.

M2 목표:

- source-audio multipart 업로드가 전체 녹음 파일을 메모리에 합치지 않도록 바꿔
- 업로드 입력을 staged temp file로 흘리면서 `sha256` 과 `byteLength` 를 계산해
- staged file을 기준으로 로컬/object storage 저장과 Soniox file upload를 처리해
- raw-audio-first 저장 semantics를 유지해
- upload response와 audit metadata에 staged file 기준 무결성 정보가 남도록 해

중요한 해석:

- 이 이슈의 본질은 “route 하나에서 `Buffer.concat(chunks)` 로 큰 녹음을 통째로 RAM에 올린다”는 점이다
- 따라서 단순히 helper 이름만 바꾸는 게 아니라, multipart 수신 -> temp staging -> persistence fan-out -> Soniox upload 전체 경로가 file-backed 이어야 한다
- 다만 이번 M2는 memory-safe upload lane에만 집중한다
- cleanup merge semantics(M3)나 runbook/evals(M4)는 건드리지 말고 리스크만 남겨

제약:

- raw audio survival이 최우선이다
- temp file cleanup은 성공/실패 경로 모두 고려해
- Soniox 업로드를 위해 다시 전체 파일을 메모리에 읽어오지 마
- 불필요하게 API contract를 넓히지 마
- 기존 store/persistence 패턴은 최대한 유지하되, file-backed helper 추가는 허용
- M1에서 정리한 async finalization lane을 되돌리지 마

구현 가이드:

- 먼저 현재 `services/api/src/routes/uploads.ts` 에서 `Buffer.concat()` 기반 처리 경로가 실제로 어떻게 동작하는지 코드로 다시 확인해
- `services/api/src/lib/source-audio-upload.ts` 같은 staging helper를 추가해도 좋다
- Fastify multipart stream을 temp file로 쓰면서 `sha256` 과 `byteLength` 를 동시에 계산해
- `services/api/src/lib/soniox.ts` 는 `Uint8Array` 대신 file-backed upload path를 받을 수 있게 최소 범위로 바꿔
- `services/api/src/lib/store.ts` 와 필요하면 `services/api/src/lib/persistence.ts` 에 `saveSourceAudioFromFile` / `writeSessionSourceAudioFromFile` 같은 helper를 추가해도 좋다
- upload route 응답과 audit event에 `sha256`, `byteLength` 가 포함되게 해
- temp file은 성공/실패 어느 쪽에서도 누수되지 않게 정리해

검증:

- `pnpm --filter @mystt/api test -- source-audio-upload.test.ts`
- `pnpm --filter @mystt/api typecheck`
- `pnpm --filter @mystt/api build`
- `pnpm graphify:build`

작업 방식:

- 구현 전에 현재 플랜(`docs/superpowers/plans/2026-04-17-soniox-async-review-followups.md`)의 M2 범위를 비판적으로 검토해
- 치명적인 갭이 없으면 그대로 진행해
- 갭이 있으면 작업 멈추고 정확히 어떤 갭인지 먼저 설명해
- 가능하면 TDD에 가깝게 작은 테스트부터 추가해
- `services/api/src/routes/uploads.ts` 에서 `Buffer.concat(chunks)` 가 사라졌는지 마지막에 꼭 확인해

완료 보고 형식:

1. 바꾼 내용
2. 왜 이 변경이 P2 메모리 버퍼링 문제를 막는지
3. 실행한 검증
4. 남은 리스크
5. 다음 milestone(M3/M4) 진입 조건
```
