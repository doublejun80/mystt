# Review Follow-Up Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two remaining review gaps in async session processing failure handling and Soniox webhook idempotency.

**Architecture:** Keep the fix surface inside the existing API vertical slice. Harden `processSessionVerticalSlice()` so post-stage startup failures leave a terminal failed session plus recovery breadcrumbs, and make Soniox webhook dedupe depend on stable event identity instead of receive-time timestamps. Prefer narrow regression tests in the existing lib tests over broader route harness churn.

**Tech Stack:** TypeScript, Vitest, Fastify store/session helpers, pnpm workspace scripts

---

### Task 1: P1 post-stage startup failures must fail terminally with rollback breadcrumbs

**Files:**
- Modify: `services/api/src/lib/session-process.ts`
- Modify: `services/api/src/lib/session-process.test.ts`
- Test: `services/api/src/lib/session-process.test.ts`

- [ ] **Step 1: Write the failing tests**

Add one test that makes `createAsyncTranscriptionJob()` reject after successful source-audio staging and asserts the session returns a failed snapshot, `updateSessionStatus()` records a terminal `failed`, `saveTranscriptionMetadata()` is not called, and a failure audit is attempted.

Add one test that makes the first `saveTranscriptionMetadata()` call reject after a transcription job has already been created and asserts cleanup is attempted for that remote transcription, the session ends `failed`, and the failure audit includes the startup stage.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts`
Expected: FAIL because startup exceptions currently escape after `transcribing`, leaving no terminal rollback path.

- [ ] **Step 3: Write minimal implementation**

Update `services/api/src/lib/session-process.ts` so the block from `updateSessionStatus("transcribing")` through the initial `saveTranscriptionMetadata()` is wrapped in a failure handler that:

```ts
await updateSessionStatus(session.id, "failed");
await recordAuditEvent({
  sessionId: session.id,
  kind: "transcription.start_failed",
  payload: { stage, transcriptionId, fileId, error }
});
```

If the transcription job was already created, do a best-effort `cleanupAsyncTranscriptionResources()` call before returning the failed snapshot so the remote transcription/file does not become an untracked orphan.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts`
Expected: PASS with both startup failure paths producing failed snapshots and cleanup rollback on metadata persistence failure.

### Task 2: P2 webhook retries must dedupe across different receive times

**Files:**
- Modify: `services/api/src/lib/store.ts`
- Modify: `services/api/src/lib/store.test.ts`
- Test: `services/api/src/lib/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that seeds a session/transcription mapping, calls `applySonioxWebhook()` twice with the same `transcriptionId` and `status` but different `deliveredAt` values, and asserts the second call returns `duplicate: true` with only one non-duplicate state transition recorded.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/store.test.ts`
Expected: FAIL because the current fingerprint includes `deliveredAt`, so every retry with a new receive time is treated as a fresh webhook.

- [ ] **Step 3: Write minimal implementation**

Update `services/api/src/lib/store.ts` so webhook dedupe uses stable event identity:

```ts
const fingerprint = `${event.transcriptionId}:${event.status}`;
```

Keep `deliveredAt` in audit payloads for observability, but do not use it as the dedupe key.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/store.test.ts`
Expected: PASS with the second retry recognized as duplicate even when receive timestamps differ.

### Task 3: Verify the full follow-up set after both fixes

**Files:**
- Test: `services/api/src/lib/session-process.test.ts`
- Test: `services/api/src/lib/store.test.ts`

- [ ] **Step 1: Run targeted regression checks**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts src/lib/store.test.ts`
Expected: PASS with the new regressions and prior review-follow-up tests all green.

- [ ] **Step 2: Run workspace verification**

Run:
- `pnpm --filter @mystt/api typecheck`
- `pnpm --filter @mystt/api build`
- `pnpm validate`
- `pnpm graphify:build`

Expected: all commands pass, and graphify refreshes after the code changes.
