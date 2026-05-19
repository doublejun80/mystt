# mystt Next Context Handoff

Last updated: 2026-05-17 KST

Read this first in the next Codex context. Then read `AGENTS.md`, any nested
`AGENTS.md`, and `graphify-out/GRAPH_REPORT.md` before making architecture or
codebase claims.

## Mission

`mystt` is a meeting recording platform whose first priority is original audio
survival. The product path is:

1. Capture and preserve local original audio.
2. Upload source audio safely.
3. Run Soniox async transcription.
4. Normalize transcript into readable segments.
5. Generate schema-based OpenAI meeting notes.
6. Render web detail, HTML, DOCX, email, and downloads from that structured JSON.

Never put permanent Soniox/OpenAI keys in mobile or web bundles. Never delete
local original audio before upload and hash verification. Background audio
changes are not done without real iOS/Android device evidence.

## Current Runtime State

As of the last handoff, these local services were left running:

- API: `http://localhost:4100/health`, screen `mystt-api-4100`, log `/tmp/mystt-api-4100.out`
- Web portal: `http://localhost:3203`, screen `mystt-web-3203`, log `/tmp/mystt-web-3203.out`
- Session worker: screen `mystt-worker-session`, log `/tmp/mystt-worker-session.log`
- Desktop/Tauri dev server: `http://localhost:1420`

Quick health check:

```bash
curl -s -o /dev/null -w 'api %{http_code}\n' http://localhost:4100/health
curl -s -o /dev/null -w 'web %{http_code}\n' http://localhost:3203
curl -s -o /dev/null -w 'tauri %{http_code}\n' http://localhost:1420/
curl -s http://localhost:4100/health | jq '.queue'
screen -ls | rg 'mystt-api-4100|mystt-worker-session|mystt-web-3203'
```

Expected queue state for a quiet system:

```json
{
  "configured": true,
  "mode": "remote",
  "depth": 0
}
```

## Restart Commands

From repo root unless noted:

```bash
pnpm compose:infra
```

API:

```bash
screen -dmS mystt-api-4100 zsh -lc 'cd /Volumes/mac_dock/github/mystt/services/api && /opt/homebrew/bin/pnpm dev > /tmp/mystt-api-4100.out 2>&1'
```

Worker:

```bash
screen -dmS mystt-worker-session zsh -lc 'cd /Volumes/mac_dock/github/mystt && /opt/homebrew/bin/pnpm --filter @mystt/worker-session dev > /tmp/mystt-worker-session.log 2>&1'
```

Web:

```bash
screen -dmS mystt-web-3203 zsh -lc 'cd /Volumes/mac_dock/github/mystt && /opt/homebrew/bin/pnpm --filter @mystt/web start > /tmp/mystt-web-3203.out 2>&1'
```

`apps/web/package.json` loads the repo root `.env` before `dev`, `build`, and
`start`. If login succeeds but the home page redirects back to `/login`, confirm
the web process is the new one on port `3203` and that no stale `node` process is
still holding the port.

Desktop dev server:

```bash
pnpm --filter @mystt/desktop dev
```

Full Tauri app, when needed:

```bash
pnpm --filter @mystt/desktop tauri dev
```

## Public QA Usage

Public mobile QA uses `https://mystt.doublejun.digital`.

Current intended shape:

- DNS: `mystt.doublejun.digital` points to the `affine` Cloudflare tunnel.
- Cloudflared ingress: `mystt.doublejun.digital -> http://127.0.0.1:3203`.
- The web portal proxies `/health` and `/v1/*` to the local API.
- Do not expose Portainer, MinIO console, Postgres, Redis, or Mailpit through
  the mystt hostname.

Browser entry:

```bash
open "https://mystt.doublejun.digital/login"
```

Mobile dev client entry:

```bash
EXPO_PUBLIC_API_BASE_URL=https://mystt.doublejun.digital \
pnpm mobile:dev-client
```

Preferred public access uses the user-configured `MYSTT_OWNER_EMAIL` and
`MYSTT_OWNER_PASSWORD`. The API stores a signed httpOnly `mystt_owner_session`
cookie. The old `?qa=<token>` entry still works only when `MYSTT_QA_TOKEN` is set
for a temporary harness window.

## User-Facing Recording Flow

1. Open local or public portal.
2. Choose recording mode and title if needed.
3. Start recording.
4. Keep the screen awake during web recording. This is a web mitigation, not a
   true background-audio guarantee.
5. Stop recording.
6. The browser keeps or converts source audio, uploads it, receives a Soniox
   file id, and calls `/v1/sessions/:id/process`.
7. The session worker should consume the Redis job. If the worker does not claim
   it quickly, the API now reclaims the queued job and processes inline.
8. Recent history should move to `completed`, and detail should show report
   summary, topic timeline, decisions, actions, open issues, risks, and transcript.
9. Audio download is MP3 where browser support allows it. On iPhone, downloads
   usually land in the browser downloads UI or Files app Downloads folder.
10. Mac desktop portal downloads request `/source-audio?format=mp3`; the server
    converts the preserved source audio to MP3 for download without replacing the
    original stored audio.

## What Was Implemented In This Workstream

Soniox/OpenAI notes v2:

- Soniox rich context is added.
- Soniox token transcript is normalized into readable `seg_0001`-style internal
  segments.
- OpenAI notes prompt is segment-aware.
- `meeting_notes_v2` schema/prompt exists.
- v2 HTML, DOCX, and email renderers exist.
- `session-process` and notes routes are connected.
- Web session detail displays v2 fields.
- Graphify has been rebuilt.

Mobile/web recording and download QA:

- Web recorder preserves source audio before final processing.
- iPhone/Chrome-family behavior was treated as iOS WebKit behavior.
- WAV was replaced by MP3 where possible to reduce file size.
- Recording screen uses keep-awake behavior while recording.
- Recent records and detail pages were browser-checked.

Latest queue/status fix:

- A real mobile session was stuck after `session.process.enqueued` because
  `worker-session` was not running.
- Latest affected session `71528d92-43da-4468-9a3a-4250b97bf4e2` was processed
  after starting `mystt-worker-session`; it became `completed`.
- `POST /v1/sessions/:sessionId/process` now marks queued jobs as
  `transcribing` and waits briefly.
- If the worker does not claim the job within the wait window, API removes the
  still-queued job and runs `processSessionVerticalSlice` inline.
- Portal session presenter now avoids showing stale `recording` when completed
  notes/artifacts exist, and maps post-upload `recording` to `transcribing`.

Latest output-cleanup fix:

- User-facing web/detail text strips `seg_0001`, confidence/lang diagnostics,
  `[evidence: ...]`, empty brackets, `null::`, `undefined::`, `:null`, and
  punctuation-only placeholders.
- HTML, DOCX, and email renderers apply the same cleanup.
- Artifact download routes regenerate `meeting_notes_html`, `meeting_notes_docx`,
  and `email_preview_html` from current structured notes instead of serving stale
  persisted rendered artifacts.
- Browser QA confirmed latest detail page has no `null::`, `:null`, `기한: ,`,
  or `[evidence...]`, and no console errors.

Latest owner auth/public access fix:

- Public access now uses owner email/password instead of relying on a harness
  token. Required root `.env` values are `MYSTT_OWNER_EMAIL`,
  `MYSTT_OWNER_PASSWORD`, and a 32+ character `MYSTT_AUTH_SECRET`.
- API auth route sets an httpOnly `mystt_owner_session` cookie and logout clears
  both owner and legacy QA cookies.
- Web middleware gates pages and `/v1/*`, allows `/login`, `/health`, `/ready`,
  auth routes, and Soniox webhook. It validates the owner cookie locally and can
  confirm the same cookie through API `/v1/auth/session`.
- Web build/start scripts load root `.env`; this fixed the case where login API
  returned `200` but the web home page redirected back to `/login`.
- Header buttons were tightened so recent sync time, refresh, logout, and
  settings stay in one compact row.

Latest MP3 download fix:

- `/v1/sessions/:sessionId/source-audio?format=mp3` returns
  `content-type: audio/mpeg` and a `.mp3` attachment filename.
- The API uses `ffmpeg` with temporary files for conversion. If the stored source
  is already `.mp3`, it returns the existing buffer as MP3.
- Web recent-session download and latest-recording download now request the MP3
  URL. Original stored audio remains untouched for survival and auditing.
- Verified locally with a smoke WAV upload: response `200`, `audio/mpeg`,
  `attachment; filename="smoke.mp3"`, and `ID3` bytes.
- Verified through `https://mystt.doublejun.digital` that the public route
  returns `200 audio/mpeg` and `.mp3` filename.

Latest API resilience fix:

- `getPostgresPool()` now attaches a pool `error` handler so an idle Postgres
  connection terminated by an administrator command is logged and does not crash
  the API process. This was observed once after public MP3 verification.

Latest 2026-05-17 six-agent resilience hardening:

- Six implementation agents worked in parallel across web recorder/archive,
  upload integrity, Redis queue, Soniox/session processing, webhooks, and
  release QA gates. Six separate review agents then reviewed the result, and the
  highest-impact findings were patched.
- Web recorder teardown now preserves recoverable archive data on unmount and
  waits for the final `dataavailable` write before resetting archive state. This
  is meant to reduce "recording looked done but last audio chunk was missing"
  failures.
- The browser no longer blocks saving only because the live transcript is short
  when source audio exists. Source audio survival wins over transcript prettiness.
- IndexedDB live recording archives reject duplicate chunk sequence writes and
  list recoverable archives by key instead of loading all blobs into memory.
- Finalization refuses gapped/incomplete archive chunks before upload/process.
- Upload flow now verifies local SHA, uploaded SHA, byte length, and persisted
  readback. If the persisted source audio pointer fails readback verification, it
  is cleared with an audit event instead of leaving a corrupt path in session
  state.
- Soniox source audio upload treats missing remote byte length as retryable
  instead of assuming success.
- Session process queue duplicate enqueue now reports `duplicate: true` instead
  of falsely reporting a fresh enqueue.
- Worker recovery now periodically reclaims expired processing leases instead of
  only recovering at startup.
- Worker no longer ACKs a failed terminal snapshot as success; failed snapshots
  go through retry/dead-letter behavior.
- Terminal Soniox webhooks now retry finalizer side effects even when the webhook
  event itself is a duplicate. This prevents duplicate webhook suppression from
  hiding a previous partial finalization failure.
- Source audio fetch in the vertical slice now enforces the 512 MiB guard while
  streaming the response body instead of buffering everything first.
- `completed` async transcriptions are resumable for downstream finalization, so
  a downstream notes/artifact failure does not require creating a new Soniox job.

Observed mobile screen behavior from the user:

- The user reports iPhone/mobile web recording has already stayed awake for up
  to about 1 hour as long as the power button is not pressed.
- Treat that as a valuable observed baseline. Do not casually rewrite the
  keep-awake/recording layout or audio-session behavior unless the change has a
  specific, testable reason.
- This does not prove locked-screen/background survival. It only means "screen
  left on, no power button" was stable for around 1 hour in the user's observed
  state.

Model decision:

- Official OpenAI docs did not show a `gpt-5.5 instant` API model.
- Cheapest official 5.5 model checked was `gpt-5.5`, and it is much more
  expensive than `gpt-5.4-mini`.
- Keep `gpt-5.4-mini` unless the user explicitly prioritizes quality over cost.

## Important Files

- Web recorder: `apps/web/components/live-recorder.tsx`
- Web API client: `apps/web/lib/api.ts`
- Web session detail: `apps/web/app/sessions/[sessionId]/page.tsx`
- Web user text cleanup: `apps/web/lib/user-facing-text.ts`
- MP3 conversion helper: `apps/web/lib/mp3-encoder.ts`
- Finalize upload/process handoff: `apps/web/lib/finalize-portal-recording.ts`
- API session routes: `services/api/src/routes/sessions.ts`
- API upload routes: `services/api/src/routes/uploads.ts`
- API vertical slice: `services/api/src/lib/session-process.ts`
- API session presenter: `services/api/src/lib/session-presenters.ts`
- Queue wrapper: `services/api/src/lib/queue.ts`
- Redis queue package: `packages/session-queue/src/index.ts`
- Soniox integration: `services/api/src/lib/soniox.ts`
- OpenAI notes integration: `services/api/src/lib/openai.ts`
- Notes schema/prompt: `packages/notes-schema/src/index.ts`
- Transcript normalizer: `packages/transcript-normalizer/src/index.ts`
- Artifact renderers: `services/api/src/lib/artifacts.ts`
- Share email draft: `services/api/src/lib/share-email.ts`
- Public QA runbook: `infra/runbooks/public-qa.md`
- Web auth middleware: `apps/web/middleware.ts`
- Owner auth: `services/api/src/routes/auth.ts`,
  `services/api/src/lib/owner-auth.ts`, `services/api/src/lib/public-access.ts`
- API backend clients: `services/api/src/lib/backends.ts`

## Debug Recipes

Latest sessions:

```bash
curl -s http://localhost:4100/v1/sessions \
  | jq -r '.snapshots[] | [.session.startedAt,.session.id,.session.title,.session.status,((.notes.notes.summary? // .notes.notes.oneLineConclusion? // "")|tostring|.[0:90])] | @tsv' \
  | head -n 20
```

One session state:

```bash
SESSION_ID=71528d92-43da-4468-9a3a-4250b97bf4e2
curl -s "http://localhost:4100/v1/sessions/$SESSION_ID" \
  | jq '{status:.snapshot.session.status, transcription:.snapshot.transcription.status, hasNotes:(.snapshot.notes!=null), readyArtifacts:[.snapshot.session.artifacts[] | select(.status=="ready") | .kind]}'
```

Audit trail:

```bash
curl -s "http://localhost:4100/v1/sessions/$SESSION_ID/audit-events?limit=60" \
  | jq -r '.data[] | [.createdAt,.kind,(.payload|tostring)] | @tsv'
```

Check rendered artifacts for user-facing leaks:

```bash
curl -s "http://localhost:4100/v1/sessions/$SESSION_ID/artifacts/meeting_notes_html" \
  | rg -n 'null::|:null|기한: ,|\[evidence|evidence:' || true

curl -s -o /tmp/mystt-notes.docx \
  "http://localhost:4100/v1/sessions/$SESSION_ID/artifacts/meeting_notes_docx"
unzip -p /tmp/mystt-notes.docx word/document.xml \
  | rg -n 'null::|:null|기한: ,|\[evidence|evidence:' || true
```

Queue stuck symptom:

- `GET /health` shows `queue.depth > 0`.
- Session audit has `session.process.enqueued` but no
  `session.process.started`.
- Fix first by starting `mystt-worker-session`.
- Current API has inline rescue for future queued wait requests, but an already
  orphaned historical job may still need the worker started or a fresh process
  call.

## Verification Already Run

The latest verified commands were:

```bash
pnpm --filter @mystt/web typecheck
pnpm --filter @mystt/web test -- lib/api.test.ts lib/recording-audio.test.ts lib/desktop-download.test.ts
pnpm --filter @mystt/web build
pnpm --filter @mystt/api typecheck
pnpm --filter @mystt/api test -- src/routes/sessions.test.ts src/lib/source-audio-upload.test.ts
pnpm --filter @mystt/api build
pnpm --filter @mystt/session-queue test
pnpm --filter @mystt/notes-schema test
pnpm --filter @mystt/mobile typecheck
pnpm ops:status
pnpm graphify:build
```

After the 2026-05-17 six-agent hardening pass, these additional commands were
run and passed:

```bash
pnpm --filter @mystt/web test
pnpm --filter @mystt/web typecheck
pnpm --filter @mystt/web build
pnpm --dir services/api test
pnpm --dir services/api run typecheck
pnpm --filter @mystt/session-queue test
pnpm --filter @mystt/session-queue typecheck
pnpm --filter @mystt/worker-session typecheck
pnpm --filter @mystt/worker-session test
pnpm --filter @mystt/audio-core test
pnpm --filter @mystt/audio-core typecheck
git diff --check
pnpm graphify:build
```

Browser QA was run against:

```text
http://localhost:3203/sessions/71528d92-43da-4468-9a3a-4250b97bf4e2
```

Observed:

- `completed` visible.
- report summary visible.
- topic timeline visible.
- no `null::`.
- no `:null`.
- no `기한: ,`.
- no `[evidence...]`.
- no console errors.

Auth and MP3 download smoke:

- Local login through web proxy: `POST /v1/auth/login` returned `200`, then
  authenticated `/` returned `200`.
- Public login through `https://mystt.doublejun.digital` returned `200`, then
  authenticated `/` returned `200`.
- Local/public MP3 source-audio route returned `audio/mpeg` and `.mp3`
  attachment filename.

## Remaining QA Checklist

Run these before treating the current state as release-ready:

1. Owner auth manual QA on public URL:
   - Wrong password stays on login and does not create an authenticated session.
   - Correct email/password opens the portal.
   - Refresh keeps the session.
   - Logout returns to `/login`.
   - Protected `/v1/sessions` returns `401` without cookie.

2. Mac desktop download QA:
   - Run the Tauri app, record a short meeting, stop, wait for upload/process.
   - Click latest recording download and confirm the saved file in Downloads has
     `.mp3`, opens in a player, and is not zero bytes.
   - From recent sessions, click the audio download button for an older `.m4a`
     source and confirm it saves as `.mp3`.

3. iOS device QA:
   - iPhone Safari/public portal recording.
   - iPhone dev-client native recording.
   - Confirm local ledger keeps source audio until upload hash verification.
   - Confirm downloaded/shareable audio behavior is still acceptable after MP3
     route changes.

4. Android device QA:
   - Native/background behavior still needs real device evidence. Do not mark
     background audio survival done from simulator/browser results.

5. Pipeline failure QA:
   - Stop `mystt-worker-session`, submit a recording, and confirm queued wait
     either gets inline rescue or is visible as stuck with clear audit trail.
   - Restart worker and confirm no duplicate processing from the reliable queue.

6. Public ingress QA:
   - `https://mystt.doublejun.digital/health` and `/ready` return public minimal
     health.
   - `https://portainer.doublejun.digital/` remains unavailable/not routed.
   - No admin/storage surfaces are exposed through the mystt hostname.

7. Render/output QA:
   - For at least one real completed Korean meeting, inspect web detail, HTML,
     DOCX, email preview, and share draft.
   - Confirm no speaker numeric prefixes, severity labels, `null::`, `:null`,
     `기한: ,`, `[evidence...]`, or raw internal segment ids leak to users.

8. Operational QA:
   - Restart Postgres/MinIO while API is running and confirm API logs errors but
     recovers instead of crashing.
   - Run `pnpm ops:status` after restart.

## Presentation Talking Points

- mystt treats realtime captions as helpful but non-authoritative.
- The source of truth is preserved source audio plus Soniox async transcript.
- The notes are schema-first JSON, with HTML/DOCX/email as render outputs.
- The pipeline is resilient to the common local QA failure where the Redis job is
  enqueued but the worker is not running.
- User-facing summaries are cleaned so internal segment ids, evidence markers,
  and placeholder nulls do not leak into reports or emails.
- For public mobile QA, expose only the web portal through Cloudflared and keep
  storage/admin surfaces private.

## Known Limits And Cautions

- Web keep-awake helps during recording, but true locked-screen survival must be
  proven in native iOS/Android device evidence.
- Do not regress the current mobile-web baseline: user observed recording stays
  awake for roughly 1 hour when the screen is left on and the power button is
  not pressed. Preserve this behavior unless a tested change clearly improves
  source audio survival.
- iOS phone calls, focus interruptions, Safari/Chrome handoff from Shortcuts,
  and the physical power button can still interrupt browser microphone capture.
  Treat these as platform interruption risks, not as Soniox API failures.
- Android foreground microphone/background audio service is not yet proven as
  complete.
- Real locked-screen/background audio is still a native-device evidence task.
  Do not claim it is done from web, simulator, or desktop tests.
- Web archive recovery now has a user-facing `로컬 복구` panel. Complete
  IndexedDB archives can be uploaded; gapped/incomplete archives must not be
  uploaded and should only be preserved or explicitly discarded.
- Client-side SHA calculation still reads the blob into memory. For very long
  recordings, replace this with streaming/incremental hashing or native-side
  hashing.
- Source upload uses a process-local lock plus Postgres advisory lock when
  Postgres is configured. The real compose-backed Postgres integration test is
  still blocked locally because Docker/OrbStack is not running.
- Redis queue claim/retry/recovery is more robust, but transitions are not fully
  Lua-atomic. If duplicate/lost work appears under crash testing, harden the
  queue operations atomically before adding more features.
- Same-SHA/byte-length Soniox file-id reuse is intentionally limited to safe
  same-session retries before transcription exists. Do not reuse a ledger file id
  after cleanup may have deleted the provider resource.
- Webhook terminal finalization now retries inline, but a queue-backed
  idempotent finalizer would be safer under webhook spikes or downstream
  outages.
- Base64 upload fallback still buffers the request body. Prefer multipart or
  streaming paths for large audio.
- Existing raw `meeting_notes_json` can still contain model-produced placeholder
  values because it is the structured source record. User-facing web, HTML, DOCX,
  and email renderers clean those values.
- MP3 download conversion depends on `ffmpeg` being available on the API host.
  Add an explicit preflight if this moves to a host that may not have ffmpeg.
- Worktree has many unrelated dirty changes from earlier work. Do not revert
  changes you did not make.
- After code changes, run focused tests, `pnpm typecheck`, and
  `pnpm graphify:build`.

## Latest 2026-05-17 Continuation

Focus shortcuts:

- iPhone Chrome/CriOS cannot be treated as a reliable Shortcuts round-trip back
  to the original Chrome/MYSTT tab.
- `apps/web/lib/ios-focus-shortcuts.ts` now separates Safari-supported behavior
  from Chrome/other iOS browser unsupported guidance.
- `apps/web/components/live-recorder.tsx` no longer shows a false success
  Shortcut flow for unsupported iOS browsers.
- Docs and device matrix were updated. Real iPhone Chrome/Safari manual evidence
  is still required before claiming behavior on device.

IndexedDB recovery:

- `apps/web/lib/live-recorder-behavior.ts` contains the complete/gapped archive
  guard and status copy.
- `apps/web/components/live-recorder.tsx` loads recoverable archives on entry,
  shows a `로컬 복구` panel, uploads only complete archives, and blocks
  incomplete/gapped archive upload.
- Check `apps/web/lib/live-recording-archive.ts` for archive storage/finalize
  primitives.

Source audio storage and ledger:

- `services/api/src/routes/uploads.ts` stores new source audio with
  `source-<sha256-prefix>-<original-file-name>`.
- `services/api/src/lib/store.ts` separates candidate write
  (`source_audio.staged`) from verified pointer commit
  (`source_audio.verified`). `sessions.local_audio_path` is set only after
  persisted readback hash verification.
- `services/api/src/lib/source-audio-upload-lock.ts` adds Postgres advisory lock
  around same-session source-audio upload, with process-local fallback.
- `services/api/src/lib/source-audio-upload-ledger.postgres.test.ts` is a real
  Postgres integration test, but it is skipped unless
  `MYSTT_RUN_POSTGRES_INTEGRATION=1` and a Postgres URL are set.
- Local compose Postgres could not be started because Docker/OrbStack socket was
  unavailable:
  `dial unix /Users/doublejun/.orbstack/run/docker.sock: connect: no such file or directory`.

Latest CSS hotfix:

- User reported the current screen looked wrong.
- Root cause candidate was the mobile CSS rule
  `.recorderMain { display: contents; }` in `apps/web/app/globals.css`, which
  let sidebar/workspace children escape the recorder grid and made `order`
  rules reorder the recording console above title/input content.
- It was changed back to a normal one-column grid on mobile:
  `.recorderMain { display: grid; grid-template-columns: 1fr; }`,
  `.recordSidebar { order: 1; }`, `.workspaceSurface { order: 2; }`.
- Browser verification was limited to accessible `/login` and `/shortcuts`
  screens because the app redirects unauthenticated `/` to `/login`.

## Next Context Priority Plan

Use this order unless the user gives a newer instruction:

1. Re-check the recorder UI visually after login.
   - Start at `apps/web/app/globals.css` around the `@media (max-width: 640px)`
     recorder rules.
   - Then inspect `apps/web/components/live-recorder.tsx` around
     `recorderMain`, `recordSidebar`, `archiveRecoveryPanel`, and
     `focusShortcutPanel`.
   - Verify an authenticated recorder screen on desktop and mobile widths. The
     Browser plugin can see `/login` and `/shortcuts`, but actual recorder QA
     needs an owner session or an explicitly safe dev auth setup.

2. Finish actual Postgres ledger integration evidence.
   - Start Docker/OrbStack.
   - Run `pnpm compose:infra`.
   - Then run:
     `MYSTT_RUN_POSTGRES_INTEGRATION=1 MYSTT_POSTGRES_INTEGRATION_URL=postgresql://postgres:postgres@127.0.0.1:55432/mystt pnpm --dir services/api test -- src/lib/source-audio-upload-ledger.postgres.test.ts`.
   - Confirm persist/reload/upsert/cascade behavior on real Postgres.

3. Stabilize the mobile recording survival path.
   - Preserve the current "screen left on, no power button, about 1 hour stable"
     behavior.
   - Keep original audio as the source of truth even when transcript/live caption
     output is missing or short.

4. Close the remaining pipeline reliability gaps.
   - Make queue transitions atomic with Redis Lua or a database-backed job
     table if crash testing shows duplicate or lost work.
   - Move terminal webhook finalization into an idempotent queued finalizer.
   - Replace client-side whole-blob SHA with streaming/incremental hashing for
     very long recordings.

5. Finish device evidence.
   - iPhone mobile web: record at least 60 minutes with screen left on, then
     save/process and confirm source audio hash, duration, transcript, notes,
     and downloadable MP3.
   - iPhone interruption test: incoming call, focus mode on/off, Shortcuts
     handoff, and power-button press. Record exact failure mode instead of
     guessing.
   - Android native: prove foreground/background microphone behavior on real
     device before claiming background support.

6. Product polish only after survival and pipeline are stable.
   - Keep mobile top controls compact.
   - Do not reintroduce long explanatory pills or large wasted vertical space on
     the recording screen.
   - Do not move the primary start/pause/save/cancel controls below secondary
     metadata fields on mobile.

## Next Context Prompt

Paste this into the next Codex context:

```text
모든 답변은 한국어로 한다.

/Volumes/mac_dock/github/mystt 에서 이어서 작업한다.

먼저 반드시 읽는다:
- AGENTS.md
- NEXT_CONTEXT.md
- graphify-out/GRAPH_REPORT.md 또는 graphify-out/wiki/index.md
- 관련 하위 AGENTS.md: apps/web/AGENTS.md, services/api/AGENTS.md, infra/AGENTS.md

절대 지킬 것:
- 원본 오디오 생존이 1순위다.
- 모바일/웹 번들에 영구 Soniox/OpenAI 키를 넣지 않는다.
- 로컬 원본 오디오는 업로드 완료와 해시 검증 전 삭제하지 않는다.
- iOS/Android background audio는 실제 기기 증거 없이는 완료라고 말하지 않는다.
- “고쳤다/된다/완료”라고 말하기 전 반드시 새 검증 증거를 만든다.
- 기존 dirty worktree 변경을 되돌리지 않는다.

최근 작업 상태:
- iPhone Chrome/CriOS Focus Shortcuts는 원래 Chrome/MYSTT 탭으로 왕복 복귀를 보장할 수 없다고 보고, false-success UX를 제거했다.
- Safari만 지원 경로로 두고 Chrome/기타 iOS 브라우저는 경고/대체 안내로 처리했다.
- IndexedDB recoverable archive UX가 생겼다. complete archive만 복구 업로드 가능하고 gapped/incomplete archive는 업로드하지 않는다.
- source audio는 `source-<sha256-prefix>-<original-file-name>`로 저장한다.
- `source_audio.staged`는 후보 객체 저장, `source_audio.verified`는 readback 해시 검증 후 `sessions.local_audio_path` commit이다.
- 같은 세션 source-audio upload는 Postgres advisory lock을 우선 사용하고, Postgres unavailable이면 process-local fallback으로 간다.
- Postgres ledger 통합 테스트 파일은 `services/api/src/lib/source-audio-upload-ledger.postgres.test.ts`에 있다. 기본 실행에서는 skip된다.
- 실제 compose Postgres 테스트는 Docker/OrbStack 소켓 부재로 아직 못 돌렸다.
- 사용자가 “지금 화면 이상해 글로벌 CSS 확인해”라고 했고, `apps/web/app/globals.css`에서 모바일 `.recorderMain { display: contents; }`가 레코더 grid/order를 깨는 원인 후보라 제거했다.
- 현재 CSS는 모바일에서 `.recorderMain`을 one-column grid로 유지하고, `.recordSidebar { order: 1 }`, `.workspaceSurface { order: 2 }`로 둔다.
- iPhone/Safari 상단 상태바가 흰색 또는 검정 띠로 뜨는 문제 후보를 보강했다. `apps/web/app/layout.tsx`에 `viewportFit: "cover"`, `themeColor: "#121327"`, dark `colorScheme`, `appleWebApp.statusBarStyle: "black-translucent"`가 들어갔다.
- `apps/web/app/globals.css`는 `html/body` 배경색을 `--page-start`로 고정하고 `safe-area-inset-top/bottom` padding을 반영한다.
- `apps/web/components/session-harness.tsx`는 포털 테마 변경 시 `meta[name="theme-color"]`를 현재 테마의 `--page-start` 계열 색으로 갱신한다.

바로 볼 곳:
- 화면/CSS: `apps/web/app/globals.css`의 `@media (max-width: 640px)` 레코더 규칙
- iPhone 상단바/viewport: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/components/session-harness.tsx`
- 레코더 구조: `apps/web/components/live-recorder.tsx`의 `recorderMain`, `recordSidebar`, `archiveRecoveryPanel`, `focusShortcutPanel`
- Focus Shortcut 로직: `apps/web/lib/ios-focus-shortcuts.ts`, `apps/web/lib/ios-focus-shortcuts.test.ts`
- IndexedDB recovery: `apps/web/lib/live-recording-archive.ts`, `apps/web/lib/live-recorder-behavior.ts`, `apps/web/components/live-recorder.tsx`
- Source audio upload: `services/api/src/routes/uploads.ts`
- Source audio pointer commit/ledger: `services/api/src/lib/store.ts`, `services/api/src/lib/persistence.ts`
- Upload lock: `services/api/src/lib/source-audio-upload-lock.ts`
- Postgres ledger integration: `services/api/src/lib/source-audio-upload-ledger.postgres.test.ts`
- 운영 문서: `infra/postgres/README.md`, `infra/minio/README.md`, `infra/runbooks/live-slice.md`, `evals/README.md`

남은 우선순위:
1. 인증된 recorder 화면을 실제로 열어 desktop/mobile 폭에서 CSS가 정상인지 확인한다. Browser plugin으로 `/login`, `/shortcuts`는 확인했지만 recorder 본화면은 owner session 또는 안전한 dev auth setup이 필요하다.
2. Docker/OrbStack을 켠 뒤 `pnpm compose:infra`와 실제 Postgres ledger integration test를 실행한다:
   `MYSTT_RUN_POSTGRES_INTEGRATION=1 MYSTT_POSTGRES_INTEGRATION_URL=postgresql://postgres:postgres@127.0.0.1:55432/mystt pnpm --dir services/api test -- src/lib/source-audio-upload-ledger.postgres.test.ts`
3. 실제 iPhone Chrome/Safari Focus Shortcut behavior를 수동 증거로 남긴다. 증거 전에는 완료 주장 금지.
4. iPhone 60분 screen-on recording, call/focus/Shortcuts/power-button interruption, Android real-device foreground/background microphone evidence를 남긴다.
5. Redis queue transition atomicity와 webhook terminal finalization queued/idempotent hardening을 계속한다.
6. 장시간 녹음용 streaming/incremental hash를 검토한다.

마지막 검증 증거:
- `pnpm test` 통과
- `pnpm typecheck` 통과
- `pnpm build` 통과
- `git diff --check` 통과
- `pnpm ops:status` 통과
- `pnpm graphify:build` 통과
- CSS hotfix 후 `pnpm --filter @mystt/web build` 통과
- iPhone 상단바 hotfix 후 `pnpm --filter @mystt/web build` 통과
- 새 빌드 기준 `next start` 재시작 후 `http://127.0.0.1:3203/login` 모바일 390x844 Browser 검증:
  - `meta[name="theme-color"]` = `#121327`
  - viewport = `width=device-width, initial-scale=1, viewport-fit=cover`
  - `apple-mobile-web-app-status-bar-style` = `black-translucent`
  - `html/body` computed background = `rgb(5, 6, 10)`
  - CSS rules loaded = 250
  - console error/warn 없음
  - screenshot = `/tmp/mystt-login-mobile-statusbar.png`
- 사용자 iPhone 스크린샷 `/Users/doublejun/Downloads/httpsmystt.doublejun.digital.png`에서 상태바 영역이 `#05060a`, 앱 상단 배경이 대략 `#121327`~`#14142a`로 분리되어 보여서 `theme-color`를 `#121327`로 조정했다.
- 조정 후 원격 `https://mystt.doublejun.digital/`도 `theme-color #121327`을 반환한다.

작업 방식:
- 먼저 baseline/focused 검증을 돌린다.
- UI 변경 후 Browser plugin으로 렌더링, 콘솔 에러, 스크린샷을 확인한다.
- 코드 파일 변경 후 `git diff --check`와 `pnpm graphify:build`를 실행한다.
```
