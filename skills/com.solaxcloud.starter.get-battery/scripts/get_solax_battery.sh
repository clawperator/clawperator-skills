#!/bin/bash
set -euo pipefail

# Usage: ./get_solax_battery.sh <device_id> [receiver_package]

DEVICE_ID="${1:-}"
RECEIVER_PKG="${2:-com.clawperator.operator.dev}"

if [[ -z "$DEVICE_ID" ]]; then
  echo "Usage: $0 <device_id> [receiver_package]"
  exit 1
fi

CLAW_BIN="clawperator"
if ! command -v "$CLAW_BIN" &> /dev/null; then
    CLAW_BIN="node $(pwd)/../clawperator/apps/node/dist/cli/index.js"
fi

RESULT=$($CLAW_BIN action demo-solax-battery --device-id "$DEVICE_ID" --receiver-package "$RECEIVER_PKG")

# Robust JSON extraction
BATTERY=$(echo "$RESULT" | python3 -c 'import sys, json; data=json.load(sys.stdin); print(next((s["data"].get("text", "") for s in data["envelope"]["stepResults"] if s["id"] == "read-battery-value"), ""))')
UNIT=$(echo "$RESULT" | python3 -c 'import sys, json; data=json.load(sys.stdin); print(next((s["data"].get("text", "") for s in data["envelope"]["stepResults"] if s["id"] == "read-battery-unit"), ""))')

if [[ -n "$BATTERY" && "$BATTERY" != "null" ]]; then
  echo "✅ SolaX battery level: ${BATTERY}${UNIT}"
else
  echo "⚠️ Could not parse SolaX battery level"
  echo "Raw result: $RESULT"
  exit 2
fi
