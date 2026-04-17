다음 작업을 이 저장소에서 이어서 해줘.

먼저 아래 파일을 순서대로 읽어:

1. `AGENTS.md`
2. `services/api/AGENTS.md`
3. `apps/web/AGENTS.md`
4. `graphify-out/GRAPH_REPORT.md`
5. `graphify-out/wiki/index.md`
6. `graphify-out/graph.json`
7. `docs/superpowers/plans/2026-04-17-soniox-async-review-followups.md`

현재 고정된 review findings는 아래 3개야:

1. `[P1]` `apps/web/components/live-recorder.tsx:1889-1909`
   - source audio 업로드 후 Soniox async 결과를 기다리지 않고 로컬 transcript/fallback text로 바로 notes를 생성하고 세션을 완료 처리함
2. `[P2]` `services/api/src/routes/uploads.ts:43-67`
   - multipart source-audio 업로드가 전체 파일을 RAM에 모아서 `Buffer.concat()` 후 처리함
3. `[P2]` `services/api/src/lib/store.ts:401-409`
   - cleanup 성공 후 `cleanupLastError`를 지우려 해도 merge 로직 때문에 예전 에러가 남음

이번 컨텍스트에서는 `M1`만 구현해.

작업 목표:

- web recorder가 source-audio 업로드 응답의 `fileId`를 사용해서 `/v1/sessions/:sessionId/process`를 호출하도록 바꿔
- 세션 최종 완료는 Soniox async transcript, normalized transcript artifacts, structured notes가 만들어진 뒤에만 가능하게 해
- 테스트 가능하도록 `apps/web/lib/finalize-portal-recording.ts` 같은 orchestration helper를 도입해도 좋아
- 가능하면 `services/api/src/routes/notes.ts`에 session-backed direct transcript finalization을 막는 최소한의 guard도 같이 넣어

제약:

- raw audio survival이 최우선이다
- false-success UI를 만들지 마
- 영구 API 키를 클라이언트 번들에 넣지 마
- 변경 후 `pnpm --filter @mystt/web test -- finalize-portal-recording.test.ts`, `pnpm --filter @mystt/web typecheck`, `pnpm --filter @mystt/api typecheck`, `pnpm graphify:build`까지 가능한 범위에서 검증해

완료 보고 형식:

- 바꾼 내용
- 실행한 검증
- 남은 리스크 또는 다음 milestone(M2/M3/M4) 진입 조건
