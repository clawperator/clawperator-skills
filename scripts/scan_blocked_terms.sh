#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_PARENT="$(cd "$ROOT_DIR/.." && pwd)"
DEFAULT_TERMS_FILE="$WORKSPACE_PARENT/.clawcave/blocked-terms.txt"
TERMS_FILE="${CLAWPERATOR_BLOCKED_TERMS_FILE:-$DEFAULT_TERMS_FILE}"
SCAN_HISTORY="false"

usage() {
  cat <<USAGE
Usage: $0 [--history] [--terms-file <path>]

Scans committed content for blocked terms.
- default: scans current HEAD tree only
- --history: scans all reachable commits (slower)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --history)
      SCAN_HISTORY="true"
      shift
      ;;
    --terms-file)
      TERMS_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$TERMS_FILE" ]]; then
  echo "[scan] blocked terms file not found: $TERMS_FILE" >&2
  echo "[scan] optional guard is not configured; skipping scan." >&2
  exit 0
fi

TMP_TERMS="$(mktemp)"
trap 'rm -f "$TMP_TERMS"' EXIT

awk 'NF && $1 !~ /^#/' "$TERMS_FILE" > "$TMP_TERMS"
if [[ ! -s "$TMP_TERMS" ]]; then
  echo "[scan] no blocked terms configured in $TERMS_FILE"
  exit 0
fi

hits=0

echo "[scan] terms file: $TERMS_FILE"

escape_ere() {
  printf '%s' "$1" | sed -e 's/[].[^$*+?(){}|\\]/\\&/g'
}

search_term() {
  local term="$1"
  if [[ "$SCAN_HISTORY" == "true" ]]; then
    if [[ "$term" =~ ^[[:alpha:]][[:alpha:][:digit:]_-]*$ ]]; then
      local escaped
      escaped="$(escape_ere "$term")"
      git rev-list --all | xargs -n 200 git grep -n -I -i -E -- "(^|[^[:alnum:]_])${escaped}([^[:alnum:]_]|$)" -- 2>/dev/null
    else
      git rev-list --all | xargs -n 200 git grep -n -I -i -F -- "$term" -- 2>/dev/null
    fi
  else
    if [[ "$term" =~ ^[[:alpha:]][[:alpha:][:digit:]_-]*$ ]]; then
      local escaped
      escaped="$(escape_ere "$term")"
      git grep -n -I -i -E -- "(^|[^[:alnum:]_])${escaped}([^[:alnum:]_]|$)" HEAD -- .
    else
      git grep -n -I -i -F -- "$term" HEAD -- .
    fi
  fi
}

if [[ "$SCAN_HISTORY" == "true" ]]; then
  echo "[scan] mode: history (all commits)"
else
  echo "[scan] mode: HEAD tree"
fi

while IFS= read -r term; do
  [[ -z "$term" ]] && continue
  if search_term "$term"; then
    hits=1
  fi
done < "$TMP_TERMS"

if [[ "$hits" -ne 0 ]]; then
  echo "[scan] blocked terms found in committed content." >&2
  exit 1
fi

echo "[scan] no blocked terms found."
