# 2026-05-23 Handoff: recording survival, notes report, title, and UI fixes

## Repository State

- Repository: `https://github.com/doublejun80/mystt.git`
- Branch: `main`
- Last pushed commit at handoff: `b457528 Fix live transcript panel height`
- Working tree before writing this handoff was clean: `main...origin/main`

## User Priorities From This Context

1. Long recordings must survive. The user explicitly called out the 30-40 minute failure/local recovery flow as existential for the app.
2. Meeting minutes/report output should be report-ready, not a long duplicated pile of sections.
3. If the user did not enter a title, generated STT/meeting-note title must replace automatic date/time titles.
4. Real-time transcript history must not push the whole page down forever. It should be a fixed panel with internal scroll after about five paragraphs.
5. Recent history should start collapsed.

## Commits Pushed In This Context

- `4bef886 Stabilize recording recovery and notes output`
  - Long recording/local archive recovery hardening.
  - Meeting notes schema/report structure cleanup.
  - Initial title replacement and transcript feed scroll work.
- `0a0c1b1 Constrain live transcript feed height`
  - Replaced viewport-based transcript feed height with bounded panel height.
- `a454289 Fix generated title replacement from notes`
  - Expanded automatic-title detection.
  - Added `reportSummary.title` as a title candidate.
  - Updated web and API paths to use notes-based generated title resolution.
- `d24e31f Show generated titles for existing recordings`
  - Existing completed sessions with automatic titles now display generated report titles in list/detail decoration.
- `730b6a4 Start recent history collapsed`
  - Recent history starts collapsed by default.
- `b457528 Fix live transcript panel height`
  - Fixed the global CSS regression where the transcript feed collapsed to about 62px when empty.

## Key Files Changed

- `apps/web/components/live-recorder.tsx`
  - Auto-reupload recoverable local archives.
  - Delete local archive only after verified source upload.
  - Update session title after notes generation using `resolveGeneratedSessionTitleFromNotes`.
  - Auto-scroll live transcript feed.
- `apps/web/app/globals.css`
  - `.transcriptFeedPrimary` is now a fixed-height internal scroll panel:
    - desktop: `height: 420px; max-height: 420px; overflow-y: auto`
    - mobile: `height: 380px; max-height: 380px`
  - Important: do not remove `height`; `max-height` alone caused the panel to collapse when empty.
- `packages/audio-core/src/session-core.ts`
  - `isGeneratedRecordingFallbackTitle`
  - `resolveGeneratedSessionTitle`
  - `resolveGeneratedSessionTitleFromNotes`
  - Automatic titles include `빠른 녹음 ...` and `복구 녹음 ...`, including date/time variants.
- `services/api/src/lib/session-process.ts`
  - After `generateStructuredNotes`, API updates automatic session title from notes.
- `apps/web/lib/demo-data.ts`
  - Existing sessions with automatic titles are displayed with generated report titles when notes exist.
- `packages/notes-schema/src/index.ts`
  - Meeting prompt tells the model to treat `빠른 녹음` / `복구 녹음` session titles as placeholders and generate titles from transcript content.
- `apps/web/components/session-harness.tsx`
  - `isHistoryCollapsed` now initializes to `true`.

## Tests And Verification Already Run

- `pnpm --filter @mystt/audio-core test -- src/index.test.ts`
  - Passed: 10 tests.
- `pnpm --filter @mystt/notes-schema test -- src/index.test.ts`
  - Passed: 2 tests.
- `pnpm --filter @mystt/api test -- src/lib/session-process.test.ts`
  - Passed: 121 tests, 1 skipped.
- `pnpm --filter @mystt/web test -- lib/demo-data.test.ts`
  - Passed as part of web test runs.
- `pnpm --filter @mystt/web test -- components/session-harness.test.tsx`
  - Passed as part of web test runs.
- `pnpm --filter @mystt/web test -- components/session-harness.test.tsx lib/live-recorder-behavior.test.ts`
  - Passed: 83 tests.
- `pnpm --filter @mystt/web typecheck`
  - Passed after rerun.
- `pnpm --filter @mystt/web build`
  - Passed.
- `pnpm --filter @mystt/api typecheck`
  - Passed earlier after API title changes.
- `pnpm --filter @mystt/audio-core typecheck`
  - Passed.
- `pnpm --filter @mystt/notes-schema typecheck`
  - Passed.
- `pnpm graphify:build`
  - Re-run after code changes as required.

## Browser / Render Checks Already Done

- Recent history initial state:
  - URL: local dev server with QA token.
  - Observed: `buttonText="펼치기"`, `ariaExpanded="false"`, `searchRendered=false`.
- Transcript panel after CSS fix:
  - Observed `.transcriptFeedPrimary`:
    - `height: 420px`
    - `maxHeight: 420px`
    - `overflowY: auto`
  - This fixed the regression where the panel collapsed to about `62px`.

## Known Risk / Things To Watch

- The live transcript panel height is intentionally fixed. If product wants exactly five variable-height paragraphs, CSS alone is approximate. Current value is a stable panel height that visually fits about five transcript cards and then scrolls.
- Existing sessions whose persisted DB title is automatic are currently fixed at presentation time if notes exist. The DB title itself is not migrated for old sessions unless reprocessed or explicitly patched.
- Title replacement depends on structured notes containing a usable `reportSummary.title` or `title`.
- Background audio changes still require iOS/Android real-device evidence before being considered complete per `AGENTS.md`.
- Soniox async cleanup was designed into the pipeline, but future changes around async transcription must preserve uploaded file/transcription cleanup.

## Suggested Next Steps

1. Run a real end-to-end recording on the target device/browser:
   - no manual title
   - generate notes
   - confirm recent history displays generated report title
   - confirm detail page title and downloads use expected title.
2. Run a long recording, ideally 40+ minutes:
   - verify local archive survives
   - verify automatic recovery upload
   - verify source upload hash/check before local cleanup.
3. Do real-device mobile validation for background/screen-off recording behavior.
4. If old records need persisted title migration, add an explicit migration or admin repair route rather than relying only on presentation decoration.

## Useful Commands

```bash
pnpm --filter @mystt/web build
pnpm --filter @mystt/web typecheck
pnpm --filter @mystt/web test -- components/session-harness.test.tsx lib/live-recorder-behavior.test.ts lib/demo-data.test.ts
pnpm --filter @mystt/api test -- src/lib/session-process.test.ts
pnpm --filter @mystt/audio-core test -- src/index.test.ts
pnpm --filter @mystt/notes-schema test -- src/index.test.ts
pnpm graphify:build
```
