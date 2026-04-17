# Review Findings Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the validated review regressions in session processing, transcription metadata remapping, cleanup retry state, and the live-slice runbook.

**Architecture:** Keep the change surface inside the existing vertical-slice flow. Lock `processSessionVerticalSlice()` so staging failures stop the pipeline before Soniox job creation, and tighten `saveTranscriptionMetadata()` so reprocessing replaces old transcription associations instead of merging contradictory cleanup state. Update the runbook only after confirming the real audit payload fields in code.

**Tech Stack:** TypeScript, Vitest, Fastify route/store helpers, pnpm workspace scripts

---

### Task 1: P1 source-audio staging failure must stop processing

**Files:**
- Create: `services/api/src/lib/session-process.test.ts`
- Modify: `services/api/src/lib/session-process.ts`
- Test: `services/api/src/lib/session-process.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that creates a session, mocks `fetch()` to return audio bytes, mocks `saveSourceAudio()` to reject, and asserts `createAsyncTranscriptionJob()` is not called, the returned snapshot is `failed`, and the latest audit trail contains `source_audio.stage_failed`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts`
Expected: FAIL because `processSessionVerticalSlice()` still continues into transcription after the staging error.

- [ ] **Step 3: Write minimal implementation**

Update `services/api/src/lib/session-process.ts` so the `audioUrl` staging branch stops the workflow on failure: record the audit event, move the session to `failed`, and return the current snapshot before `transcribing` or Soniox job creation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts`
Expected: PASS with no Soniox job creation after staging failure.

### Task 2: P1/P2 reprocessing must replace stale transcription identity and cleanup state

**Files:**
- Modify: `services/api/src/lib/store.ts`
- Modify: `services/api/src/lib/store.test.ts`
- Test: `services/api/src/lib/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add one test that saves metadata with an old transcription ID, saves metadata again with a new transcription ID for the same session, and asserts the old ID no longer resolves through `getSessionIdByTranscriptionId()`.

Add one test that simulates a cleanup success followed by a failed retry and asserts `cleanupCompletedAt` is cleared when the later update marks cleanup as failed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/store.test.ts`
Expected: FAIL because the old transcription ID still resolves to the session and `cleanupCompletedAt` survives the failed retry.

- [ ] **Step 3: Write minimal implementation**

Update `services/api/src/lib/store.ts` so `saveTranscriptionMetadata()` deletes the previous `sessionByTranscriptionId` entry when the transcription ID changes, treats cleanup fields as replaceable state instead of unconditional merge carry-over, and avoids preserving contradictory `cleanupCompletedAt` values after later failed/pending updates.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mystt/api exec vitest run src/lib/store.test.ts`
Expected: PASS with stale ID mappings removed and cleanup retry state internally consistent.

### Task 3: P3 live-slice runbook must match real audit payloads

**Files:**
- Modify: `infra/runbooks/live-slice.md`
- Test: code audit against `services/api/src/routes/uploads.ts` and `services/api/src/lib/store.ts`

- [ ] **Step 1: Reconfirm payload fields from code**

Re-read `services/api/src/routes/uploads.ts` for `source_audio.soniox_uploaded` and `services/api/src/lib/store.ts` for `transcription.metadata.updated` / `transcription.cleanup.updated`, then map the exact field list into the runbook.

- [ ] **Step 2: Update the runbook**

Change `infra/runbooks/live-slice.md` so integrity fields are only claimed for `source_audio.soniox_uploaded`, and cleanup detail fields are only claimed for `transcription.cleanup.updated`.

- [ ] **Step 3: Run doc and repo verification**

Run:
- `pnpm --filter @mystt/api exec vitest run src/lib/session-process.test.ts src/lib/store.test.ts`
- `pnpm --filter @mystt/api typecheck`
- `pnpm --filter @mystt/api build`
- `pnpm validate`
- `pnpm graphify:build`

Expected: all required checks pass and graph output refreshes after the code changes.
