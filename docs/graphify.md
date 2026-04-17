# Graphify Integration

`mystt` is wired to use a local `graphify-out/` knowledge graph so Codex can read repo structure before scanning raw files.

## What Is Checked In

- `.graphifyignore` keeps recorder artifacts and generated output out of the graph corpus.
- `scripts/graphify-local.sh` resolves a usable Python interpreter that already has the `graphify` package.
- `scripts/graphify_ast_build.py` builds an offline, AST-first graph and emits `graphify-out/` plus `.graphify_analysis.json`.
- `scripts/graphify_codex_install.py` refreshes the `AGENTS.md` graph rules and tries to install a local Codex hook when the sandbox permits `.codex/`.
- `pnpm graphify:build` and related package scripts provide the normal entrypoints.
- `AGENTS.md` is configured so Codex reads graph outputs first when they exist.

## Commands

```bash
pnpm graphify:build
pnpm graphify:query -- "processSessionVerticalSlice"
pnpm graphify:path -- "PcmMicrophoneSource" "processSessionVerticalSlice()"
pnpm graphify:explain -- "processSessionVerticalSlice()"
pnpm graphify:codex
```

If the package is not installed in the repo-local venv, the wrapper falls back to the existing shared interpreter at `/Volumes/mac_dock/github/mylaw/.venv/bin/python`. You can override that with `GRAPHIFY_PYTHON=/abs/path/to/python`.

## Observability

- `graphify-out/GRAPH_REPORT.md`: first-stop navigation summary for Codex and humans.
- `graphify-out/wiki/index.md`: crawlable wiki view of communities and god nodes.
- `graphify-out/graph.json`: queryable graph payload for `query`, `path`, and `explain`.
- `.graphify_analysis.json`: build metadata, counts, and top hotspots.
- `.codex/hooks.json`: optional Bash PreToolUse reminder if the current environment allows writing `.codex/`.

## Validation

Run `pnpm graphify:build` and confirm all of these exist:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/graph.html`
- `graphify-out/wiki/index.md`
- `.graphify_analysis.json`

Then run one focused lookup such as:

```bash
pnpm graphify:query -- "processSessionVerticalSlice"
```

## Rollback

Remove or revert the following if this integration needs to come out:

- the `## graphify` section from `AGENTS.md`
- the graphify PreToolUse entry from `.codex/hooks.json`
- `.graphifyignore`
- `graphify-out/` and `.graphify_analysis.json`
- the `graphify:*` package scripts and local helper scripts

## Current Limitation

This repo-side build is intentionally offline and AST-first. It gives reliable code-structure navigation without requiring network access, but it does not re-run the full doc/image semantic extraction pipeline from upstream `graphify`. Natural-language `query` prompts are therefore weaker than exact node-based lookups such as `processSessionVerticalSlice`. If full multimodal graph extraction is needed later, re-run with a normal `graphify` environment and keep using `pnpm graphify:build` for cheap local refreshes afterward.
