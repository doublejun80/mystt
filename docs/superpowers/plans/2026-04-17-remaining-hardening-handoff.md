# Remaining Hardening Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining API hardening gaps discovered during review-follow-up revalidation without reopening the already-fixed Soniox startup and webhook idempotency regressions.

**Architecture:** Keep the change surface inside the existing API session-processing/store logic. Harden polling and terminal-state semantics in `session-process.ts`, then make reprocessing replacement semantics in `store.ts` explicit and durable with a persistence round-trip test. Preserve the repository mission priorities: original audio survival first, then async pipeline fault tolerance, then notes quality.

**Tech Stack:** TypeScript, Vitest, Fastify API helpers, pnpm workspace scripts, graphify

---

### Context Snapshot

Validated/fixed in the immediately previous session:

- `source_audio` staging failure stops before Soniox job creation.
- post-stage startup failures now mark the session failed, emit `transcription.start_failed`, and best-effort cleanup remote Soniox resources.
- webhook dedupe now uses stable event identity instead of `deliveredAt`.
- required verification passed:
  - `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts src/lib/store.test.ts`
  - `pnpm --filter @mystt/api typecheck`
  - `pnpm --filter @mystt/api build`
  - `pnpm validate`
  - `pnpm graphify:build`

Remaining code-level risks to address:

- [session-process.ts](/Volumes/mac_dock/github/mystt/services/api/src/lib/session-process.ts:43) treats missing snapshot as terminal success.
- [session-process.ts](/Volumes/mac_dock/github/mystt/services/api/src/lib/session-process.ts:271) breaks polling on a single transient `getAsyncTranscription()` miss.
- [store.ts](/Volumes/mac_dock/github/mystt/services/api/src/lib/store.ts:403) silently drops replacement metadata unless a pending cleanup envelope is already present.
- [store.test.ts](/Volumes/mac_dock/github/mystt/services/api/src/lib/store.test.ts:171) does not persistence-round-trip the stale-reprocessing path.

### Task 1: Fix false-success terminal polling semantics

**Files:**
- Modify: `services/api/src/lib/session-process.ts`
- Modify: `services/api/src/lib/session-process.test.ts`
- Test: `services/api/src/lib/session-process.test.ts`

- [ ] **Step 1: Write the failing tests**

Add one test for `waitForTerminalSessionSnapshot()` that simulates `refreshStore()` completing but `getSessionSnapshot()` returning `undefined` on the first poll and a non-terminal session on the next poll, then a terminal session after that. The test should assert the helper does not return early on the missing snapshot.

Add one test for `processSessionVerticalSlice()` polling where `getAsyncTranscription()` returns `undefined` once and later returns a completed transcription. The test should assert the function keeps polling and reaches transcript fetch/save instead of taking the timeout/early-exit path.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts`

Expected:
- FAIL because `waitForTerminalSessionSnapshot()` currently returns `{ timedOut: false, snapshot: undefined }`.
- FAIL because the async transcription loop currently `break`s on the first transient miss.

- [ ] **Step 3: Write minimal implementation**

Update `services/api/src/lib/session-process.ts` so:

```ts
if (!snapshot) {
  await sleep(pollIntervalMs);
  continue;
}
```

and:

```ts
const refreshed = await getAsyncTranscription(current.id);
if (!refreshed) {
  continue;
}
current = refreshed;
```

Keep the existing deadline-based timeout contract intact.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts`

Expected: PASS with the new polling regression tests and the existing startup failure tests all green.

### Task 2: Make reprocessing replacement semantics explicit

**Files:**
- Modify: `services/api/src/lib/store.ts`
- Modify: `services/api/src/lib/store.test.ts`
- Test: `services/api/src/lib/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add one test that saves old transcription metadata, then saves a new `transcriptionId` without the full cleanup envelope, and asserts the new transcription replaces the old one instead of being silently dropped.

Add one persistence round-trip assertion to the existing stale-update-after-reprocessing path: reload from mocked persistence after writing the new transcription and stale old update, then verify the stale `transcriptionId` still does not resolve and the new transcription remains authoritative.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/store.test.ts`

Expected:
- FAIL because the replacement without cleanup envelope is currently ignored.
- FAIL or remain uncovered until the round-trip expectation is added and validated against persisted state.

- [ ] **Step 3: Write minimal implementation**

Refactor `saveTranscriptionMetadata()` so transcription replacement is explicit instead of coupled to cleanup fields. Replace the current guard:

```ts
const isAuthoritativeReplacement =
  isReplacement &&
  input.cleanupStatus === "pending" &&
  input.cleanupRequestedAt !== undefined &&
  input.cleanupTargets !== undefined;

if (isReplacement && !isAuthoritativeReplacement) {
  return;
}
```

with a clearer replacement rule that accepts a new transcription as authoritative when the caller provides a genuinely new `transcriptionId`, while still resetting old cleanup state safely for the replacement.

At minimum, preserve these invariants:

- old `sessionByTranscriptionId` mapping is removed
- new transcription becomes authoritative for the session
- stale later updates for the old transcription remain ignored
- cleanup state from the old transcription does not bleed into the new one unless explicitly provided

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/store.test.ts`

Expected: PASS with both the new replacement test and the persistence round-trip stale-update coverage.

### Task 3: Re-verify the hardened API slice

**Files:**
- Test: `services/api/src/lib/session-process.test.ts`
- Test: `services/api/src/lib/store.test.ts`

- [ ] **Step 1: Run targeted regression checks**

Run:

- `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts src/lib/store.test.ts`

Expected: PASS with all review-follow-up and hardening regressions green.

- [ ] **Step 2: Run API/package verification**

Run:

- `pnpm --filter @mystt/api typecheck`
- `pnpm --filter @mystt/api build`

Expected: both pass.

- [ ] **Step 3: Run workspace verification**

Run:

- `pnpm validate`
- `pnpm graphify:build`

Expected:
- full workspace validation passes
- graphify rebuild completes successfully after the code changes

### Observability / Rollback Notes

- Observe `session.status.updated`, `transcription.start_failed`, `transcription.metadata.updated`, `transcription.cleanup.updated`, and `soniox.webhook.*` audit events while testing.
- If Task 1 changes regress the async terminal flow, rollback only the `waitForTerminalSessionSnapshot()` and polling-loop edits in `services/api/src/lib/session-process.ts`.
- If Task 2 changes regress reprocessing semantics, rollback only the replacement-guard refactor in `services/api/src/lib/store.ts` and keep the already-validated startup/webhook fixes intact.
- Do not delete local source audio or relax existing cleanup safeguards while doing this hardening pass.
