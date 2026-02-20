#!/bin/bash
set -euo pipefail

# Usage: ./get_globird_usage.sh <device_id> [receiver_package]

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

RESULT=$($CLAW_BIN action demo-globird-usage --device-id "$DEVICE_ID" --receiver-package "$RECEIVER_PKG")

# Extract snapshot text from the JSON result
# Use python for robust JSON + newline handling since it is likely installed
SNAPSHOT=$(echo "$RESULT" | python3 -c 'import sys, json; data=json.load(sys.stdin); print(next((s["data"].get("text", "") for s in data["envelope"]["stepResults"] if s["id"] == "snap"), ""))')

if [[ -n "$SNAPSHOT" ]]; then
  COST=$(echo "$SNAPSHOT" | sed -nE 's/.*text="([^"]*)".*resource-id="energy-usage-cost-left-stat-value".*/\1/p' | tail -n 1 || true)
  RIGHT=$(echo "$SNAPSHOT" | sed -nE 's/.*text="([^"]*)".*resource-id="energy-usage-cost-right-stat-value".*/\1/p' | tail -n 1 || true)
  GRID_USAGE=$(echo "$SNAPSHOT" | sed -nE 's/.*text="([^"]*)".*resource-id="energy-usage-grid-usage".*/\1/p' | tail -n 1 || true)
  SOLAR_FEED=$(echo "$SNAPSHOT" | sed -nE 's/.*text="([^"]*)".*resource-id="energy-usage-solar-feed-in".*/\1/p' | tail -n 1 || true)
  
  if [[ -n "$COST" || -n "$GRID_USAGE" || -n "$SOLAR_FEED" ]]; then
    echo "✅ GloBird usage: cost_so_far=${COST:-unknown}, avg_cost_per_day=${RIGHT:-unknown}, grid_usage=${GRID_USAGE:-unknown}, solar_feed_in=${SOLAR_FEED:-unknown}"
  else
    echo "⚠️ Could not parse GloBird values from snapshot. Is the app on the Energy tab?"
    exit 2
  fi
else
  echo "⚠️ Could not capture GloBird usage snapshot"
  echo "Raw result: $RESULT"
  exit 2
fi
