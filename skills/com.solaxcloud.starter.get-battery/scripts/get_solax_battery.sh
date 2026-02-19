#!/bin/bash
set -euo pipefail

PKG="${1:-app.actiontask.operator.development}"
ADB_BIN="${ADB_BIN:-adb}"
TASK_ID="solax-battery-$(date +%s)-$RANDOM"
CMD_ID="cmd-${TASK_ID}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE_PATH="$ROOT/skills/com.solaxcloud.starter.get-battery/artifacts/battery.recipe.json"
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
  echo "⚠️ SolaX command failed or timed out"
  exit 2
fi
LOGS="$($ADB_BIN logcat -d | grep "$CMD_ID" || true)"

BATTERY=$(echo "$LOGS" | sed -nE 's/.*UiActionStepResult\(id=read-battery-value, actionType=read_text, data=\{text=([^,]+),.*/\1/p' | tail -n 1 || true)
UNIT=$(echo "$LOGS" | sed -nE 's/.*UiActionStepResult\(id=read-battery-unit, actionType=read_text, data=\{text=([^,]+),.*/\1/p' | tail -n 1 || true)
if [[ -z "$BATTERY" ]]; then
  BATTERY=$(echo "$LOGS" | sed -nE 's/.*stage_success commandId=.* id=read-battery-value data=\{[^}]*text=([^,}]+).*/\1/p' | tail -n 1 || true)
fi
if [[ -z "$UNIT" ]]; then
  UNIT=$(echo "$LOGS" | sed -nE 's/.*stage_success commandId=.* id=read-battery-unit data=\{[^}]*text=([^,}]+).*/\1/p' | tail -n 1 || true)
fi

if [[ -n "$BATTERY" ]]; then
  echo "✅ SolaX battery level: ${BATTERY}${UNIT}"
else
  echo "⚠️ Could not parse SolaX battery level"
fi
