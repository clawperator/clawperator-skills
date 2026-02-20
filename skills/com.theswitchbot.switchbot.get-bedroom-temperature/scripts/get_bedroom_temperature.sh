#!/bin/bash
set -euo pipefail

# Usage: ./get_bedroom_temperature.sh <device_id> [receiver_package]

DEVICE_ID="${1:-}"
RECEIVER_PKG="${2:-com.clawperator.operator.dev}"

if [[ -z "$DEVICE_ID" ]]; then
  echo "Usage: $0 <device_id> [receiver_package]"
  exit 1
fi

# Try to find clawperator CLI
CLAW_BIN="clawperator"
if ! command -v "$CLAW_BIN" &> /dev/null; then
    # Fallback to local build if running from skills repo sibling
    CLAW_BIN="node $(pwd)/../clawperator/apps/node/dist/cli/index.js"
fi

RESULT=$($CLAW_BIN action demo-switchbot-temp --device-id "$DEVICE_ID" --receiver-package "$RECEIVER_PKG")

# Parse temperature using sed (no jq dependency required for this PoC)
TEMP=$(echo "$RESULT" | sed -nE 's/.*"id":"read_temp".*"text":"([^"]+)".*/\1/p')

if [[ -n "$TEMP" && "$TEMP" != "null" ]]; then
  echo "✅ Bedroom temperature: ${TEMP}"
else
  echo "⚠️ Could not parse bedroom temperature"
  echo "Raw result: $RESULT"
  exit 2
fi
