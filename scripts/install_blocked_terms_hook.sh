#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_PATH="$ROOT_DIR/.git/hooks/pre-commit"
WORKSPACE_PARENT="$(cd "$ROOT_DIR/.." && pwd)"
DEFAULT_SHARED_HOOK="$WORKSPACE_PARENT/.clawcave/pre-commit-blocked-terms.sh"
DEFAULT_TERMS_FILE="$WORKSPACE_PARENT/.clawcave/blocked-terms.txt"
SHARED_HOOK="${CLAWPERATOR_SHARED_HOOK:-$DEFAULT_SHARED_HOOK}"

cat > "$HOOK_PATH" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
if [[ -x "$SHARED_HOOK" ]]; then
  "$SHARED_HOOK"
else
  echo "[pre-commit] shared blocked-terms hook not found at: $SHARED_HOOK (skipping)." >&2
fi
HOOK
chmod +x "$HOOK_PATH"

echo "Installed pre-commit hook at $HOOK_PATH"
echo "Shared hook path: $SHARED_HOOK"
echo "Default blocked terms file: \${CLAWPERATOR_BLOCKED_TERMS_FILE:-$DEFAULT_TERMS_FILE}"
