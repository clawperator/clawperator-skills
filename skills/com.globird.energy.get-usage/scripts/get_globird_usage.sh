#!/bin/bash
set -euo pipefail

PKG="${1:-app.actiontask.operator.development}"
ADB_BIN="${ADB_BIN:-adb}"
TASK_ID="globird-usage-$(date +%s)-$RANDOM"
CMD_ID="cmd-${TASK_ID}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE_PATH="$ROOT/skills/com.globird.energy.get-usage/artifacts/usage.recipe.json"
LOGS=""

wait_for_command_completion() {
  local timeout_sec="${1:-140}"
  local elapsed=0
  local polled_logs=""
  while (( elapsed < timeout_sec )); do
    polled_logs="$($ADB_BIN logcat -d | grep "$CMD_ID" || true)"
    if echo "$polled_logs" | grep -q "command_success commandId=$CMD_ID"; then
      return 0
    fi
    if echo "$polled_logs" | grep -q "command_failure commandId=$CMD_ID"; then
      return 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

PAYLOAD=$(cat "$TEMPLATE_PATH" | sed "s/{{COMMAND_ID}}/${CMD_ID}/g" | sed "s/{{TASK_ID}}/${TASK_ID}/g")
ESCAPED_PAYLOAD=$(printf '%s' "$PAYLOAD" | tr -d '\n' | sed 's/"/\\"/g')

$ADB_BIN logcat -c
$ADB_BIN shell "am broadcast -a app.actiontask.operator.ACTION_AGENT_COMMAND -p '$PKG' --es payload \"$ESCAPED_PAYLOAD\" --receiver-foreground" >/dev/null
if ! wait_for_command_completion 140; then
  echo "⚠️ GloBird command failed or timed out"
  exit 2
fi

LOGS="$($ADB_BIN logcat -d | grep "$CMD_ID" || true)"
TREE_LINES="$(echo "$LOGS" | grep "TaskScopeDefault:" || true)"

COST=$(echo "$TREE_LINES" | sed -nE 's/.*text="([^"]*)".*resource-id="energy-usage-cost-left-stat-value".*/\1/p' | tail -n 1 || true)
RIGHT=$(echo "$TREE_LINES" | sed -nE 's/.*text="([^"]*)".*resource-id="energy-usage-cost-right-stat-value".*/\1/p' | tail -n 1 || true)
GRID_USAGE=$(echo "$TREE_LINES" | sed -nE 's/.*text="([^"]*)".*resource-id="energy-usage-grid-usage".*/\1/p' | tail -n 1 || true)
SOLAR_FEED=$(echo "$TREE_LINES" | sed -nE 's/.*text="([^"]*)".*resource-id="energy-usage-solar-feed-in".*/\1/p' | tail -n 1 || true)
YESTERDAY_SUMMARY=$(echo "$TREE_LINES" | sed -nE 's/.*content-desc="(YESTERDAY USAGE,[^"]*)".*/\1/p' | tail -n 1 || true)
YESTERDAY_COST=$(echo "$YESTERDAY_SUMMARY" | sed -nE 's/.*Cost, ([^,]+), Net Usage.*/\1/p' | tail -n 1 || true)
YESTERDAY_NET=$(echo "$YESTERDAY_SUMMARY" | sed -nE 's/.*Net Usage \(kWh\), ([^,]+).*/\1/p' | tail -n 1 || true)

if [[ -n "$COST" || -n "$GRID_USAGE" || -n "$SOLAR_FEED" ]]; then
  echo "✅ GloBird usage: cost_so_far=${COST:-unknown}, avg_cost_per_day=${RIGHT:-unknown}, grid_usage=${GRID_USAGE:-unknown}, solar_feed_in=${SOLAR_FEED:-unknown}"
  if [[ -n "$YESTERDAY_SUMMARY" ]]; then
    echo "✅ Yesterday: cost=${YESTERDAY_COST:-unknown}, net_usage_kwh=${YESTERDAY_NET:-unknown}"
  else
    echo "ℹ️ Yesterday section not detected in current view."
  fi
else
  echo "⚠️ Could not parse GloBird usage values"
fi
