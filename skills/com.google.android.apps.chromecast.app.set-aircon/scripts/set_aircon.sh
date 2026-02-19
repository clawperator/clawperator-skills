#!/bin/bash
set -euo pipefail

STATE="${1:-on}"
PKG="${2:-app.actiontask.operator.development}"
ADB_BIN="${ADB_BIN:-adb}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STATUS_SCRIPT="$ROOT/skills/com.google.android.apps.chromecast.app.get-aircon-status/scripts/get_aircon_status.sh"
AC_TILE_NAME="${AC_TILE_NAME:-}"

if [[ "$STATE" != "on" && "$STATE" != "off" ]]; then
  echo "Usage: $0 <on|off> [package]"
  exit 1
fi
if [[ -z "${AC_TILE_NAME// }" ]]; then
  echo "❌ AC_TILE_NAME is required and must match your Google Home climate tile label."
  echo "Example: AC_TILE_NAME=\"YOUR_AC_TILE_NAME\" $0 $STATE $PKG"
  exit 1
fi

CURRENT_LINE=$("$STATUS_SCRIPT" "$PKG" "$AC_TILE_NAME" | tail -n 1 || true)
CURRENT_POWER=$(echo "$CURRENT_LINE" | sed -nE 's/.*power=([^,]+).*/\1/p' | tr '[:upper:]' '[:lower:]')

echo "Current power: ${CURRENT_POWER:-unknown}; requested: $STATE"

if [[ "$CURRENT_POWER" == "$STATE" ]]; then
  echo "✅ Already in requested state"
  exit 0
fi

echo "ℹ️ Direct semantic ac:on/ac:off invocation is not exposed via local debug broadcast yet."
echo "ℹ️ This script currently acts as a status verifier/precheck only and does not change AC power state."
echo "ℹ️ Use the production command pipeline for state-changing actions, then verify with get_aircon_status."
exit 0
