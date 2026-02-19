#!/usr/bin/env bash
set -euo pipefail

PKG="${1:-app.actiontask.operator.development}"
ADB_BIN="${ADB_BIN:-adb}"
ADB_SERIAL="${ADB_SERIAL:-}"
SETTINGS_APP_ID="${SETTINGS_APP_ID:-com.android.settings}"
SCREENSHOT_DIR="${SCREENSHOT_DIR:-/tmp/clawperator-settings-screenshots}"
TIMEOUT_SEC="${TIMEOUT_SEC:-120}"

TASK_ID="settings-overview-$(date +%s)-$RANDOM"
CMD_ID="cmd-${TASK_ID}"

adb_cmd() {
  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB_BIN" -s "$ADB_SERIAL" "$@"
  else
    "$ADB_BIN" "$@"
  fi
}

if ! command -v "$ADB_BIN" >/dev/null 2>&1; then
  echo "RESULT|app=${SETTINGS_APP_ID}|status=failure|command_id=${CMD_ID}|task_id=${TASK_ID}|reason=adb_not_found"
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "RESULT|app=${SETTINGS_APP_ID}|status=failure|command_id=${CMD_ID}|task_id=${TASK_ID}|reason=jq_not_found"
  exit 2
fi

read -r -d '' ACTIONS_JSON <<JSON || true
[
  {"id":"close","type":"close_app","params":{"applicationId":"${SETTINGS_APP_ID}"}},
  {"id":"open","type":"open_app","params":{"applicationId":"${SETTINGS_APP_ID}"}},
  {"id":"settle","type":"sleep","params":{"durationMs":1800}},
  {"id":"snap","type":"snapshot_ui","params":{"format":"ascii"}}
]
JSON

PAYLOAD=$(jq -cn \
  --arg taskId "$TASK_ID" \
  --arg commandId "$CMD_ID" \
  --arg source "skill-com.android.settings.capture-overview" \
  --argjson actions "$ACTIONS_JSON" \
  '{taskId:$taskId, commandId:$commandId, source:$source, actions:$actions}')

single_line_payload=$(printf '%s' "$PAYLOAD" | tr -d '\n')
escaped_payload=$(printf '%s' "$single_line_payload" | sed "s/'/'\"'\"'/g")

adb_cmd logcat -c >/dev/null 2>&1 || true
adb_cmd shell "am broadcast -a app.actiontask.operator.ACTION_AGENT_COMMAND -p $PKG --es payload '$escaped_payload' --receiver-foreground" >/dev/null

elapsed=0
terminal_line=""
while (( elapsed < TIMEOUT_SEC )); do
  terminal_line=$(adb_cmd logcat -d | grep -F "$CMD_ID" | grep -F "[Clawperator-Result]" | tail -n 1 || true)
  if [[ -n "$terminal_line" ]]; then
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

if [[ -z "$terminal_line" ]]; then
  echo "RESULT|app=${SETTINGS_APP_ID}|status=failure|command_id=${CMD_ID}|task_id=${TASK_ID}|reason=timeout_waiting_for_terminal_envelope"
  exit 1
fi

envelope_json="${terminal_line#*\[Clawperator-Result\] }"
status=$(printf '%s' "$envelope_json" | jq -r '.status // empty')

mkdir -p "$SCREENSHOT_DIR"
screenshot_path="$SCREENSHOT_DIR/${CMD_ID}.png"
adb_cmd exec-out screencap -p > "$screenshot_path"

if [[ "$status" != "success" ]]; then
  reason=$(printf '%s' "$envelope_json" | jq -r '.error.reason // "unknown"')
  echo "RESULT|app=${SETTINGS_APP_ID}|status=failure|command_id=${CMD_ID}|task_id=${TASK_ID}|reason=${reason}"
  echo "SCREENSHOT|path=${screenshot_path}"
  exit 1
fi

snapshot_text=$(printf '%s' "$envelope_json" | jq -r '.stepResults[]? | select(.id=="snap") | .data.text // empty')

echo "RESULT|app=${SETTINGS_APP_ID}|status=success|command_id=${CMD_ID}|task_id=${TASK_ID}|source=canonical"
echo "TEXT_BEGIN"
printf '%s\n' "$snapshot_text"
echo "TEXT_END"
echo "SCREENSHOT|path=${screenshot_path}"
