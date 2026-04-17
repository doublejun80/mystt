# Soniox Async Review Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the meeting pipeline so raw audio survives first, Soniox async transcript is the only final source of truth for completed sessions, source-audio uploads stay memory-safe, and cleanup telemetry can recover from successful retries.

**Architecture:** The web recorder must stop completing sessions from browser/OpenAI fallback text after source-audio upload. Instead it should upload raw audio, capture the returned Soniox `fileId`, and call `/v1/sessions/:sessionId/process` so the server-side async path creates normalized transcript artifacts, structured notes, and cleanup metadata before the UI shows completion. On the API side, multipart uploads should stream into a staged file while computing integrity metadata, then stream that staged file into local/object storage and Soniox without `Buffer.concat`; cleanup metadata merging must allow explicit clearing of `cleanupLastError`.

**Tech Stack:** Next.js/React, Fastify, Vitest, Node streams/fs/crypto, Soniox Node SDK (`ReadableStream` upload support), Postgres/MinIO persistence fallbacks

---

## Read First

- Root rules: `AGENTS.md`
- Web rules: `apps/web/AGENTS.md`
- API rules: `services/api/AGENTS.md`
- Graph hotspots: `graphify-out/GRAPH_REPORT.md`, `graphify-out/wiki/index.md`, `graphify-out/graph.json`
- Review findings that define the scope:
  - `apps/web/components/live-recorder.tsx:1889-1909`
  - `services/api/src/routes/uploads.ts:43-67`
  - `services/api/src/lib/store.ts:401-409`

## File Map

- Modify: `apps/web/components/live-recorder.tsx`
  - Replace direct `generateSessionNotes()` completion with a tested orchestration helper that waits for the async Soniox pipeline.
- Modify: `apps/web/lib/api.ts`
  - Add a typed client for `/v1/sessions/:sessionId/process`.
- Create: `apps/web/lib/finalize-portal-recording.ts`
  - Own the upload -> process orchestration so it can be tested without mounting the full recorder UI.
- Create: `apps/web/lib/finalize-portal-recording.test.ts`
  - Lock the web flow to `uploadPortalSourceAudio()` plus `processPortalSession()`, not direct notes generation.
- Modify: `services/api/src/routes/notes.ts`
  - Prevent session-backed finalization from bypassing Soniox async with ad-hoc transcript text.
- Modify: `services/api/src/routes/uploads.ts`
  - Replace full-file buffering with a streaming staging path and return integrity metadata with the upload result.
- Create: `services/api/src/lib/source-audio-upload.ts`
  - Stage multipart audio to disk, compute `sha256` and `byteLength`, then fan out the staged file to persistence and Soniox.
- Create: `services/api/src/lib/source-audio-upload.test.ts`
  - Cover streaming staging, digest capture, and cleanup of temp files.
- Modify: `services/api/src/lib/soniox.ts`
  - Allow source-audio upload from a `ReadableStream`/file-backed source instead of requiring a full in-memory `Uint8Array`.
- Modify: `services/api/src/lib/store.ts`
  - Preserve explicit clearing semantics for `cleanupLastError`.
- Create: `services/api/src/lib/store.test.ts`
  - Reproduce the stale cleanup error bug and lock the fix in place.
- Modify: `infra/runbooks/live-slice.md`
  - Document the updated web -> async Soniox finalization path, staging/hash expectations, and what to watch in ops.
- Modify: `evals/README.md`
  - Add the regression checks for the new source-of-truth behavior and memory-safe upload lane.

## Milestones

- `M1`: Web recorder uses Soniox async as the only completion path.
- `M2`: Source-audio uploads stream to disk/object storage and Soniox without loading the full recording into RAM.
- `M3`: Cleanup retries can clear stale `cleanupLastError` values.
- `M4`: Live-slice runbook and eval guidance reflect the new flow and verification steps.

### Task 1 (M1): Restore Soniox Async As The Web Source Of Truth

**Files:**
- Create: `apps/web/lib/finalize-portal-recording.ts`
- Test: `apps/web/lib/finalize-portal-recording.test.ts`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/live-recorder.tsx`
- Modify: `services/api/src/routes/notes.ts`

- [x] **Step 1: Write the failing web orchestration test**

```ts
import { describe, expect, it, vi } from "vitest";

import { finalizePortalRecording } from "./finalize-portal-recording";

describe("finalizePortalRecording", () => {
  it("uploads raw audio and then processes the session through Soniox async", async () => {
    const uploadPortalSourceAudio = vi.fn().mockResolvedValue({
      fileId: "file_123",
      sessionId: "session_1",
      fileName: "meeting.m4a",
      byteLength: 1024,
      createdAt: "2026-04-17T09:00:00.000Z"
    });
    const processPortalSession = vi.fn().mockResolvedValue({
      id: "session_1",
      status: "completed",
      notes: { summary: "done" }
    });

    const snapshot = await finalizePortalRecording({
      sessionId: "session_1",
      file: new Blob(["audio"]),
      fileName: "meeting.m4a",
      wait: true,
      uploadPortalSourceAudio,
      processPortalSession
    });

    expect(uploadPortalSourceAudio).toHaveBeenCalledOnce();
    expect(processPortalSession).toHaveBeenCalledWith({
      sessionId: "session_1",
      fileId: "file_123",
      wait: true
    });
    expect(snapshot.status).toBe("completed");
  });
});
```

- [x] **Step 2: Run the targeted web test and confirm it fails before implementation**

Run: `pnpm --filter @mystt/web test -- finalize-portal-recording.test.ts`

Expected: FAIL because `finalizePortalRecording()` and `processPortalSession()` do not exist yet.

- [x] **Step 3: Add the thin web API client and orchestration helper**

```ts
// apps/web/lib/api.ts
export async function processPortalSession(input: {
  sessionId: string;
  fileId: string;
  wait?: boolean;
}): Promise<SessionSnapshotRecord> {
  const payload = await requestJson<{ data: SessionSnapshotRecord }>(
    `/v1/sessions/${input.sessionId}/process`,
    {
      method: "POST",
      body: JSON.stringify({
        fileId: input.fileId,
        wait: input.wait ?? true
      })
    }
  );

  return payload.data;
}
```

```ts
// apps/web/lib/finalize-portal-recording.ts
import { processPortalSession, uploadPortalSourceAudio } from "./api";

export async function finalizePortalRecording(input: {
  sessionId: string;
  file: Blob;
  fileName: string;
  wait?: boolean;
  uploadPortalSourceAudio?: typeof uploadPortalSourceAudio;
  processPortalSession?: typeof processPortalSession;
}) {
  const upload = await (input.uploadPortalSourceAudio ?? uploadPortalSourceAudio)({
    sessionId: input.sessionId,
    file: input.file,
    fileName: input.fileName
  });

  return (input.processPortalSession ?? processPortalSession)({
    sessionId: input.sessionId,
    fileId: upload.fileId,
    wait: input.wait ?? true
  });
}
```

- [x] **Step 4: Wire the recorder UI to the helper instead of `generateSessionNotes()`**

```ts
// apps/web/components/live-recorder.tsx
const snapshot = await finalizePortalRecording({
  sessionId: created.id,
  file: downloadableBlob,
  fileName: nextAudioDownloadName,
  wait: true
});
```

```ts
// Remove the old direct finalization call
// const snapshot = await generateSessionNotes({ sessionId: created.id, mode, transcript });
```

Keep the UI honest: do not call `setPhase("saved")` until the async snapshot comes back as completed. If the process call returns `transcribing`, `summarizing`, or `emailing`, show that in the recorder state instead of a false success.

- [x] **Step 5: Add a server-side guard so session-backed finalization cannot bypass async Soniox**

```ts
// services/api/src/routes/notes.ts
if (resolvedSessionId && body.transcript && !body.transcriptionId) {
  return reply.code(400).send({
    message: "session-backed final notes must be generated from Soniox transcription output"
  });
}
```

This guard protects the contract even if another caller accidentally reintroduces the old client behavior.

- [x] **Step 6: Run targeted verification for M1**

Run: `pnpm --filter @mystt/web test -- finalize-portal-recording.test.ts`

Run: `pnpm --filter @mystt/web typecheck`

Run: `pnpm --filter @mystt/api typecheck`

Run: `pnpm graphify:build`

Expected:
- The new web test passes.
- TypeScript passes for both web and API.
- `graphify-out` refreshes without new hot paths bypassing `/v1/sessions/:sessionId/process`.

- [ ] **Step 7: Commit M1 cleanly**

```bash
git add \
  apps/web/components/live-recorder.tsx \
  apps/web/lib/api.ts \
  apps/web/lib/finalize-portal-recording.ts \
  apps/web/lib/finalize-portal-recording.test.ts \
  services/api/src/routes/notes.ts \
  graphify-out
git commit -m "fix: finalize web sessions through Soniox async pipeline"
```

### Task 2 (M2): Stream Source-Audio Uploads And Capture Integrity Metadata

**Files:**
- Create: `services/api/src/lib/source-audio-upload.ts`
- Test: `services/api/src/lib/source-audio-upload.test.ts`
- Modify: `services/api/src/routes/uploads.ts`
- Modify: `services/api/src/lib/soniox.ts`
- Modify: `services/api/src/lib/store.ts`

- [ ] **Step 1: Write the failing streaming helper test**

```ts
import { describe, expect, it } from "vitest";

import { stageIncomingSourceAudio } from "./source-audio-upload";

describe("stageIncomingSourceAudio", () => {
  it("writes multipart chunks to disk while computing sha256 and byte length", async () => {
    const staged = await stageIncomingSourceAudio({
      sessionId: "session_1",
      fileName: "meeting.m4a",
      chunks: [Buffer.from("abc"), Buffer.from("def")],
      contentType: "audio/mp4"
    });

    expect(staged.byteLength).toBe(6);
    expect(staged.sha256).toBe(
      "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1f6c5c6dcd93c4721f"
    );
    expect(staged.tempPath.endsWith(".m4a")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the targeted API test and confirm it fails first**

Run: `pnpm --filter @mystt/api test -- source-audio-upload.test.ts`

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Implement a file-backed staging helper**

```ts
// services/api/src/lib/source-audio-upload.ts
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function stageIncomingSourceAudio(input: {
  sessionId: string;
  fileName: string;
  chunks: AsyncIterable<Buffer> | Iterable<Buffer>;
  contentType?: string;
}) {
  const tempDir = await mkdtemp(join(tmpdir(), `mystt-source-${input.sessionId}-`));
  const tempPath = join(tempDir, input.fileName);
  const hash = createHash("sha256");
  const writer = createWriteStream(tempPath);
  let byteLength = 0;

  for await (const chunk of input.chunks) {
    byteLength += chunk.byteLength;
    hash.update(chunk);
    if (!writer.write(chunk)) {
      await new Promise((resolve) => writer.once("drain", resolve));
    }
  }

  writer.end();
  await finished(writer);

  return {
    tempDir,
    tempPath,
    byteLength,
    sha256: hash.digest("hex"),
    cleanup: () => rm(tempDir, { recursive: true, force: true })
  };
}
```

- [ ] **Step 4: Switch the upload route and Soniox helper to the staged-file flow**

```ts
// services/api/src/lib/soniox.ts
import { createReadStream } from "node:fs";

export async function uploadSourceAudioFile(input: {
  sessionId: string;
  fileName: string;
  filePath: string;
}) {
  const client = getSonioxClient();
  const file = await client.files.upload(createReadStream(input.filePath), {
    filename: input.fileName,
    client_reference_id: input.sessionId
  });

  return {
    fileId: file.id,
    fileName: file.filename,
    byteLength: file.size,
    createdAt: file.created_at
  };
}
```

```ts
// services/api/src/routes/uploads.ts
const staged = await stageIncomingSourceAudio({
  sessionId,
  fileName,
  chunks: part.file,
  contentType
});

const location = await saveSourceAudioFromFile({
  sessionId,
  fileName,
  filePath: staged.tempPath,
  byteLength: staged.byteLength,
  sha256: staged.sha256,
  contentType
});
const uploadedFile = await uploadSourceAudioFile({
  sessionId,
  fileName,
  filePath: staged.tempPath
});
await staged.cleanup();
```

Also extend the response payload and audit event with `sha256` and `byteLength` from the staged file.

- [ ] **Step 5: Preserve raw-audio-first storage semantics**

```ts
// services/api/src/lib/store.ts
export async function saveSourceAudioFromFile(input: {
  sessionId: string;
  fileName: string;
  filePath: string;
  byteLength: number;
  sha256: string;
  contentType?: string;
}) {
  const location = await writeSessionSourceAudioFromFile({
    sessionId: input.sessionId,
    fileName: input.fileName,
    filePath: input.filePath,
    contentType: input.contentType
  });

  appendAuditEvent({
    sessionId: input.sessionId,
    kind: "source_audio.staged",
    payload: {
      location,
      fileName: input.fileName,
      byteLength: input.byteLength,
      sha256: input.sha256,
      contentType: input.contentType ?? null
    }
  });
}
```

Implement `writeSessionSourceAudioFromFile()` in the persistence layer using `rename`/`copyFile` for local storage and `createReadStream(filePath)` for MinIO so large recordings never require a full in-memory buffer.

- [ ] **Step 6: Run targeted verification for M2**

Run: `pnpm --filter @mystt/api test -- source-audio-upload.test.ts`

Run: `pnpm --filter @mystt/api typecheck`

Run: `pnpm --filter @mystt/api build`

Expected:
- Streaming helper tests pass.
- The API still builds with the file-backed Soniox upload path.
- No `Buffer.concat(chunks)` remains in `services/api/src/routes/uploads.ts`.

- [ ] **Step 7: Commit M2 cleanly**

```bash
git add \
  services/api/src/lib/source-audio-upload.ts \
  services/api/src/lib/source-audio-upload.test.ts \
  services/api/src/routes/uploads.ts \
  services/api/src/lib/soniox.ts \
  services/api/src/lib/store.ts \
  services/api/src/lib/persistence.ts
git commit -m "fix: stream source-audio uploads without buffering entire recordings"
```

### Task 3 (M3): Allow Cleanup Retries To Clear Previous Errors

**Files:**
- Modify: `services/api/src/lib/store.ts`
- Test: `services/api/src/lib/store.test.ts`

- [ ] **Step 1: Write the failing store merge test**

```ts
import { describe, expect, it } from "vitest";

import { saveTranscriptionMetadata, getSessionSnapshot } from "./store";

describe("saveTranscriptionMetadata", () => {
  it("clears cleanupLastError when a later update explicitly omits it", async () => {
    await saveTranscriptionMetadata("session_1", {
      transcriptionId: "11111111-1111-4111-8111-111111111111",
      cleanupStatus: "failed",
      cleanupLastError: "delete failed"
    });

    await saveTranscriptionMetadata("session_1", {
      transcriptionId: "11111111-1111-4111-8111-111111111111",
      cleanupStatus: "completed",
      cleanupCompletedAt: "2026-04-17T09:30:00.000Z",
      cleanupLastError: undefined
    });

    expect(
      getSessionSnapshot("session_1")?.transcription?.cleanupLastError
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the targeted API test and confirm it fails first**

Run: `pnpm --filter @mystt/api test -- store.test.ts`

Expected: FAIL because the current merge logic restores the old error string.

- [ ] **Step 3: Fix the merge semantics**

```ts
// services/api/src/lib/store.ts
cleanupLastError:
  "cleanupLastError" in input ? input.cleanupLastError : previous?.cleanupLastError
```

Use the same explicit-presence pattern for any field where `undefined` should mean "clear this value now" rather than "keep the previous one".

- [ ] **Step 4: Run targeted verification for M3**

Run: `pnpm --filter @mystt/api test -- store.test.ts`

Run: `pnpm --filter @mystt/api typecheck`

Expected:
- The targeted store test passes.
- Successful cleanup retries now clear stale errors in the snapshot.

- [ ] **Step 5: Commit M3 cleanly**

```bash
git add services/api/src/lib/store.ts services/api/src/lib/store.test.ts
git commit -m "fix: clear stale cleanup errors after successful retries"
```

### Task 4 (M4): Update Runbook, Evals, And Verification Notes

**Files:**
- Modify: `infra/runbooks/live-slice.md`
- Modify: `evals/README.md`

- [ ] **Step 1: Document the updated finalization contract**

```md
Web and mobile live captions are preview-only. A session may be marked `completed` only after:
1. raw source audio is staged locally/object storage,
2. Soniox async transcription completes from `fileId` or `audioUrl`,
3. normalized transcript artifacts are written,
4. structured notes are generated from the normalized async transcript,
5. Soniox cleanup metadata is recorded.
```

- [ ] **Step 2: Add regression checks for the new flow**

```md
- Start a portal recording, upload source audio, and verify the session transitions through
  `uploading -> transcribing -> summarizing -> emailing/completed`.
- Confirm the final notes are absent if `/v1/sessions/:sessionId/process` is skipped or fails.
- Upload a large recording and verify the API process does not grow linearly with file size in RAM.
- Force a cleanup failure, retry cleanup successfully, and verify `cleanupLastError` clears.
```

- [ ] **Step 3: Run the final validation sweep**

Run: `pnpm --filter @mystt/api test`

Run: `pnpm --filter @mystt/web test`

Run: `pnpm validate`

Expected:
- Targeted tests continue to pass in the full package suites.
- Workspace validation passes or any existing unrelated failures are explicitly called out.

- [ ] **Step 4: Commit M4 cleanly**

```bash
git add infra/runbooks/live-slice.md evals/README.md
git commit -m "docs: record Soniox async finalization and upload regression checks"
```

## Observability Points

- Watch audit events:
  - `source_audio.staged`
  - `source_audio.soniox_uploaded`
  - `session.process.enqueued`
  - `session.process.inline_fallback`
  - `transcription.metadata.updated`
  - `transcript.artifacts.saved`
- Add or preserve integrity payload fields:
  - `byteLength`
  - `sha256`
  - `fileId`
  - `location`
- During manual verification, confirm the session never reaches `completed` unless transcript artifacts and notes are both present.

## Rollback Plan

- Roll back in reverse milestone order so docs do not describe behavior that is no longer deployed.
- If `M2` creates unexpected storage regressions, revert the streaming helper commit first and keep `M1` plus `M3` in place; that preserves the async source-of-truth fix while restoring the old upload implementation temporarily.
- If `M1` causes portal save regressions, keep the session in a non-terminal state instead of restoring direct transcript completion. The repo contract is safer with a delayed completion than a false-success session.

## Done When

- Web recorder completion depends on Soniox async output, not direct transcript fallback text.
- Source-audio upload no longer buffers the full recording in RAM.
- Successful cleanup retries clear stale `cleanupLastError`.
- `infra/runbooks/live-slice.md` and `evals/README.md` reflect the new behavior.
- Tests and verification commands above have been run, or any blockers have been documented explicitly.
