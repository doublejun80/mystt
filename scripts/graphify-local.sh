#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

resolve_python() {
  local candidate
  local -a candidates=()

  if [[ -n "${GRAPHIFY_PYTHON:-}" ]]; then
    candidates+=("${GRAPHIFY_PYTHON}")
  fi

  if [[ -f "${ROOT_DIR}/graphify-out/.graphify_python" ]]; then
    candidates+=("$(<"${ROOT_DIR}/graphify-out/.graphify_python")")
  fi

  candidates+=(
    "${ROOT_DIR}/.venv-graphify/bin/python"
    "/Volumes/mac_dock/github/mylaw/.venv/bin/python"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "${candidate}" ]] && "${candidate}" -c "import graphify" >/dev/null 2>&1; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  cat >&2 <<'EOF'
error: no usable Python with the graphify package was found.

Tried:
- $GRAPHIFY_PYTHON
- graphify-out/.graphify_python
- .venv-graphify/bin/python
- /Volumes/mac_dock/github/mylaw/.venv/bin/python

Set GRAPHIFY_PYTHON=/abs/path/to/python and try again.
EOF
  return 1
}

usage() {
  cat <<'EOF'
Usage:
  ./scripts/graphify-local.sh build
  ./scripts/graphify-local.sh codex-install
  ./scripts/graphify-local.sh query "<question>" [--budget N]
  ./scripts/graphify-local.sh path "<source>" "<target>"
  ./scripts/graphify-local.sh explain "<node>"
  ./scripts/graphify-local.sh interpreter
EOF
}

main() {
  local command="${1:-}"
  if [[ -z "${command}" ]]; then
    usage
    exit 1
  fi

  local python_bin
  python_bin="$(resolve_python)"

  case "${command}" in
    build|update)
      shift
      if [[ "${1:-}" == "--" ]]; then
        shift
      fi
      cd "${ROOT_DIR}"
      exec "${python_bin}" "${ROOT_DIR}/scripts/graphify_ast_build.py" "${ROOT_DIR}" "$@"
      ;;
    codex-install)
      shift
      if [[ "${1:-}" == "--" ]]; then
        shift
      fi
      cd "${ROOT_DIR}"
      exec "${python_bin}" "${ROOT_DIR}/scripts/graphify_codex_install.py" "${ROOT_DIR}" "$@"
      ;;
    query|path|explain|cluster-only|watch|hook)
      shift
      if [[ "${1:-}" == "--" ]]; then
        shift
      fi
      cd "${ROOT_DIR}"
      exec "${python_bin}" -m graphify "${command}" "$@"
      ;;
    interpreter)
      printf '%s\n' "${python_bin}"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
