#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

GRAPHIFY_SECTION = """## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `pnpm graphify:build` to keep the graph current (AST-only, no API cost)
"""

GRAPHIFY_HOOK = {
    "matcher": "Bash",
    "hooks": [
        {
            "type": "command",
            "command": (
                "[ -f graphify-out/graph.json ] && "
                r"""echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"graphify: Knowledge graph exists. Read graphify-out/GRAPH_REPORT.md for god nodes and community structure before searching raw files."}}' """
                "|| true"
            ),
        }
    ],
}


def upsert_agents(root: Path) -> Path:
    agents_path = root / "AGENTS.md"
    if agents_path.exists():
        content = agents_path.read_text(encoding="utf-8")
        if "## graphify" in content:
            updated = re.sub(
                r"\n*## graphify\n.*?(?=\n## |\Z)",
                "\n\n" + GRAPHIFY_SECTION.rstrip() + "\n",
                content,
                flags=re.DOTALL,
            ).rstrip() + "\n"
        else:
            updated = content.rstrip() + "\n\n" + GRAPHIFY_SECTION
    else:
        updated = GRAPHIFY_SECTION
    agents_path.write_text(updated, encoding="utf-8")
    return agents_path


def try_write_hook(root: Path) -> Path | None:
    hooks_path = root / ".codex" / "hooks.json"
    try:
        hooks_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            existing = json.loads(hooks_path.read_text(encoding="utf-8")) if hooks_path.exists() else {}
        except json.JSONDecodeError:
            existing = {}
        pre_tool = existing.setdefault("hooks", {}).setdefault("PreToolUse", [])
        existing["hooks"]["PreToolUse"] = [entry for entry in pre_tool if "graphify" not in str(entry)]
        existing["hooks"]["PreToolUse"].append(GRAPHIFY_HOOK)
        hooks_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        return hooks_path
    except OSError as exc:
        print(f"warning: could not write {hooks_path}: {exc}", file=sys.stderr)
        return None


def main() -> None:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    agents_path = upsert_agents(root)
    hooks_path = try_write_hook(root)
    print(f"graphify section ready in {agents_path}")
    if hooks_path is not None:
        print(f"codex PreToolUse hook ready in {hooks_path}")
    else:
        print("codex PreToolUse hook skipped; AGENTS.md remains the always-on mechanism.")


if __name__ == "__main__":
    main()
