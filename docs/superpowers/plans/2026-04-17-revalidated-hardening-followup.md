# Revalidated Hardening Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two remaining API hardening gaps confirmed during fresh revalidation without reopening the already-verified review follow-up fixes.

**Architecture:** Keep the change surface inside the existing API session-processing and store helpers. Add regression tests first, then make the smallest code changes needed to keep polling resilient and make transcription replacement explicit instead of cleanup-envelope-coupled.

**Tech Stack:** TypeScript, Vitest, pnpm workspace scripts, graphify

---

### Task 1: Harden session-process polling semantics

**Files:**
- Modify: `services/api/src/lib/session-process.ts`
- Modify: `services/api/src/lib/session-process.test.ts`
- Test: `services/api/src/lib/session-process.test.ts`

- [ ] **Step 1: Write failing tests**

Add one test for `waitForTerminalSessionSnapshot()` that proves a transient missing snapshot should not be treated as terminal success.

Add one test for `processSessionVerticalSlice()` that proves a single `getAsyncTranscription()` miss should not stop polling before a later completed transcription arrives.

- [ ] **Step 2: Run the red test**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts`

Expected: FAIL because `waitForTerminalSessionSnapshot()` currently returns early on `undefined` snapshots and `processSessionVerticalSlice()` currently `break`s on a transient missing refresh.

- [ ] **Step 3: Write minimal implementation**

Change `services/api/src/lib/session-process.ts` so:

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

- [ ] **Step 4: Run green verification**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts`

Expected: PASS with the new polling regressions and the existing startup-failure regressions.

### Task 2: Make transcription replacement explicit

**Files:**
- Modify: `services/api/src/lib/store.ts`
- Modify: `services/api/src/lib/store.test.ts`
- Test: `services/api/src/lib/store.test.ts`

- [ ] **Step 1: Write failing tests**

Add one test that saves an old transcription, then saves a different `transcriptionId` without the full cleanup envelope, and proves the new transcription still becomes authoritative.

Extend the stale-update-after-reprocessing path with a persistence round-trip so the old `transcriptionId` still does not resolve after reload.

- [ ] **Step 2: Run the red test**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/store.test.ts`

Expected: FAIL because `saveTranscriptionMetadata()` currently ignores replacement updates unless `cleanupStatus`, `cleanupRequestedAt`, and `cleanupTargets` are all present.

- [ ] **Step 3: Write minimal implementation**

Refactor `saveTranscriptionMetadata()` so a new `transcriptionId` is treated as an authoritative replacement on its own, while preserving these invariants:

- old `sessionByTranscriptionId` mapping is removed
- stale later updates for the old transcription remain ignored
- old cleanup state does not bleed into the replacement unless explicitly provided

- [ ] **Step 4: Run green verification**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/store.test.ts`

Expected: PASS with the new replacement regression and persistence round-trip coverage.

### Task 3: Re-run required verification

**Files:**
- Test: `services/api/src/lib/session-process.test.ts`
- Test: `services/api/src/lib/store.test.ts`

- [ ] **Step 1: Run targeted regressions**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts src/lib/store.test.ts`

- [ ] **Step 2: Run API verification**

Run:

- `pnpm --filter @mystt/api typecheck`
- `pnpm --filter @mystt/api build`

- [ ] **Step 3: Run workspace verification**

Run:

- `pnpm validate`
- `pnpm graphify:build`

### Observability / Rollback Notes

- Watch `transcription.metadata.updated`, `transcription.cleanup.updated`, and `soniox.webhook.*` audit events while validating.
- If session polling regresses, rollback only the small polling-loop edits in `services/api/src/lib/session-process.ts`.
- If reprocessing semantics regress, rollback only the replacement logic in `services/api/src/lib/store.ts`.
