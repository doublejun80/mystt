#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

pnpm exec tsx scripts/vertical-slice.ts \
  --audio_url "https://soniox.com/media/examples/coffee_shop.mp3" \
  --title "Eval Smoke" \
  --mode meeting \
  --project evals

