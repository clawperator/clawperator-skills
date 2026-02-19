#!/bin/bash
set -euo pipefail

PKG="${1:-app.actiontask.operator.development}"
AC_TILE_NAME="${2:-${AC_TILE_NAME:-}}"
AC_TILE_FALLBACKS="${AC_TILE_FALLBACKS:-}"
ADB_BIN="${ADB_BIN:-adb}"
TASK_ID="ac-status-$(date +%s)-$RANDOM"
CMD_ID="cmd-${TASK_ID}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE_PATH="$ROOT/skills/com.google.android.apps.chromecast.app.get-aircon-status/artifacts/ac-status.recipe.json"

wait_for_command_completion() {
  local timeout_sec="${1:-120}"
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

run_with_tile() {
  local tile_name="$1"
  local payload payload_oneline payload_for_remote escaped_tile_name
  escaped_tile_name="$(escape_sed_replacement "$tile_name")"
  payload=$(sed "s/{{COMMAND_ID}}/${CMD_ID}/g" "$TEMPLATE_PATH" | sed "s/{{TASK_ID}}/${TASK_ID}/g" | sed "s/{{AC_TILE_NAME}}/${escaped_tile_name}/g")
  payload_oneline=$(printf '%s' "$payload" | tr -d '\n')
  payload_for_remote="$(escape_single_quoted_shell_arg "$payload_oneline")"
  $ADB_BIN logcat -c
  $ADB_BIN shell "am broadcast -a app.actiontask.operator.ACTION_AGENT_COMMAND -p '$PKG' --es payload '$payload_for_remote' --receiver-foreground" >/dev/null
  wait_for_command_completion 120
}

escape_sed_replacement() {
  local s="$1"
  printf '%s' "$s" | sed -e 's/[\\/&]/\\&/g'
}

escape_single_quoted_shell_arg() {
  local s="$1"
  printf '%s' "$s" | sed "s/'/'\"'\"'/g"
}

trim_whitespace() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

AC_TILE_NAME="$(trim_whitespace "$AC_TILE_NAME")"
if [[ -z "$AC_TILE_NAME" ]]; then
  echo "❌ AC tile label is required. Pass as arg 2 or set AC_TILE_NAME."
  echo "Example: AC_TILE_NAME=\"YOUR_AC_TILE_NAME\" $0"
  exit 1
fi

LOGS=""
if ! run_with_tile "$AC_TILE_NAME"; then
  FOUND_MATCH=0
  IFS=',' read -r -a FALLBACKS <<< "$AC_TILE_FALLBACKS"
  for fallback in "${FALLBACKS[@]}"; do
    fallback="$(trim_whitespace "$fallback")"
    [[ -z "$fallback" ]] && continue
    [[ "$fallback" == "$AC_TILE_NAME" ]] && continue
    if run_with_tile "$fallback"; then
      AC_TILE_NAME="$fallback"
      FOUND_MATCH=1
      break
    fi
  done
  if [[ "$FOUND_MATCH" -ne 1 ]]; then
    echo "⚠️ AC status command failed for provided tile label(s)"
    exit 2
  fi
fi
LOGS="$($ADB_BIN logcat -d | grep "$CMD_ID" || true)"

POWER=$(echo "$LOGS" | sed -nE 's/.*UiActionStepResult\(id=read-power, actionType=read_text, data=\{text=([^,]+),.*/\1/p' | tail -n 1 || true)
MODE=$(echo "$LOGS" | sed -nE 's/.*UiActionStepResult\(id=read-mode, actionType=read_text, data=\{text=([^,]+),.*/\1/p' | tail -n 1 || true)
TEMP=$(echo "$LOGS" | sed -nE 's/.*UiActionStepResult\(id=read-indoor-temp, actionType=read_text, data=\{text=([^,]+),.*/\1/p' | tail -n 1 || true)

if [[ -z "$POWER" ]]; then
  POWER=$(echo "$LOGS" | sed -nE 's/.*stage_success commandId=.* id=read-power data=\{[^}]*text=([^,}]+).*/\1/p' | tail -n 1 || true)
fi
if [[ -z "$MODE" ]]; then
  MODE=$(echo "$LOGS" | sed -nE 's/.*stage_success commandId=.* id=read-mode data=\{[^}]*text=([^,}]+).*/\1/p' | tail -n 1 || true)
fi
if [[ -z "$TEMP" ]]; then
  TEMP=$(echo "$LOGS" | sed -nE 's/.*stage_success commandId=.* id=read-indoor-temp data=\{[^}]*text=([^,}]+).*/\1/p' | tail -n 1 || true)
fi

if [[ -n "$POWER" || -n "$MODE" || -n "$TEMP" ]]; then
  echo "✅ AC status (${AC_TILE_NAME}): power=${POWER:-unknown}, mode=${MODE:-unknown}, indoor_temp=${TEMP:-unknown}"
else
  echo "⚠️ Could not parse AC status values"
fi
