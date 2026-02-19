#!/bin/bash
# Temporary implementation note:
# This non-trivial Bash skill is a stopgap and is queued for early migration
# to the Node.js/TypeScript skill SDK/runtime helpers.
set -euo pipefail

PKG="${1:-app.actiontask.operator.development}"
PERSON_NAME="${2:-Person}"
LIFE360_APP_ID="com.life360.android.safetymapd"
ADB_BIN="${ADB_BIN:-adb}"
ADB_SERIAL="${ADB_SERIAL:-}"
RETURN_SCREENSHOT="${RETURN_SCREENSHOT:-0}"
SCREENSHOT_DIR="${SCREENSHOT_DIR:-/tmp/life360-screenshots}"
OVERLAY_CLOSE_TAP_X="${OVERLAY_CLOSE_TAP_X:-1000}"
OVERLAY_CLOSE_TAP_Y="${OVERLAY_CLOSE_TAP_Y:-300}"
TASK_ID="life360-location-$(date +%s)-$RANDOM"
OVERVIEW_SCREENSHOT_PATH=""

LIST_XML="$(mktemp)"
DETAIL_XML="$(mktemp)"
MEMBERS_TSV="$(mktemp)"
trap 'rm -f "$LIST_XML" "$DETAIL_XML" "$MEMBERS_TSV"' EXIT

adb_cmd() {
  if [[ -n "$ADB_SERIAL" ]]; then
    "$ADB_BIN" -s "$ADB_SERIAL" "$@"
  else
    "$ADB_BIN" "$@"
  fi
}

ensure_single_device_or_serial() {
  if [[ -n "$ADB_SERIAL" ]]; then
    return 0
  fi

  local devices
  devices=$(adb_cmd devices | awk 'NR>1 && $2=="device" {print $1}')
  local count
  count=$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')

  if [[ "$count" -eq 0 ]]; then
    echo "ERROR|stage=precheck|message=No adb devices connected"
    exit 2
  fi

  if [[ "$count" -gt 1 ]]; then
    echo "ERROR|stage=precheck|message=Multiple adb devices connected. Set ADB_SERIAL."
    echo "DEVICES|$(printf '%s' "$devices" | tr '\n' ',' | sed 's/,$//')"
    exit 2
  fi
}

build_payload() {
  local command_id="$1"
  local actions_json="$2"
  cat <<JSON
{"taskId":"$TASK_ID","commandId":"$command_id","source":"skill-com.life360.android.safetymapd.get-location","actions":[$actions_json]}
JSON
}

json_escape_string() {
  local input="$1"
  input=${input//\\/\\\\}
  input=${input//\"/\\\"}
  input=${input//$'\n'/\\n}
  input=${input//$'\r'/\\r}
  input=${input//$'\t'/\\t}
  input=${input//$'\f'/\\f}
  input=${input//$'\b'/\\b}
  printf '%s' "$input"
}

escape_for_single_quoted_shell_arg() {
  local input="$1"
  printf '%s' "$input" | sed "s/'/'\"'\"'/g"
}

validate_package_name() {
  if ! [[ "$PKG" =~ ^[a-zA-Z0-9._]+$ ]]; then
    echo "ERROR|stage=precheck|message=Invalid package name argument"
    exit 2
  fi
}

send_payload() {
  local payload="$1"
  local single_line_payload
  local escaped_payload
  single_line_payload=$(printf '%s' "$payload" | tr -d '\n')
  escaped_payload=$(escape_for_single_quoted_shell_arg "$single_line_payload")
  adb_cmd shell "am broadcast -a app.actiontask.operator.ACTION_AGENT_COMMAND -p '$PKG' --es payload '$escaped_payload' --receiver-foreground" >/dev/null
}

wait_for_command_completion() {
  local command_id="$1"
  local timeout_sec="${2:-120}"
  local elapsed=0
  local logs

  while (( elapsed < timeout_sec )); do
    logs=$(adb_cmd logcat -d | grep "$command_id" || true)
    if echo "$logs" | grep -q "command_success commandId=$command_id"; then
      return 0
    fi
    if echo "$logs" | grep -q "command_failure commandId=$command_id"; then
      return 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

run_actions() {
  local command_id="$1"
  local actions_json="$2"
  local timeout_sec="${3:-120}"
  local payload

  payload=$(build_payload "$command_id" "$actions_json")
  adb_cmd logcat -c
  send_payload "$payload"
  wait_for_command_completion "$command_id" "$timeout_sec"
}

snapshot_to_file() {
  local out_file="$1"
  : > "$out_file"
  adb_cmd logcat -d | grep 'TaskScopeDefault:' | sed -E 's/^.*TaskScopeDefault: //' > "$out_file" || true
}

parse_members_from_list() {
  local xml_file="$1"
  local out_file="$2"
  awk '
function decode(s) {
  gsub(/&quot;/, "\"", s)
  gsub(/&apos;/, "\047", s)
  gsub(/&amp;/, "&", s)
  gsub(/&lt;/, "<", s)
  gsub(/&gt;/, ">", s)
  return s
}
function attr_value(node, key,    p, v) {
  p = key "=\""
  if (match(node, p "[^\"]*\"")) {
    v = substr(node, RSTART + length(p), RLENGTH - length(p) - 1)
    return decode(v)
  }
  return ""
}
function center(bounds, axis,  a,b,c,d,m) {
  if (match(bounds, /\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]/)) {
    m = substr(bounds, RSTART, RLENGTH)
    gsub(/\[|\]/, "", m)
    gsub(/,/, " ", m)
    split(m, v, " ")
    a=v[1]; b=v[2]; c=v[3]; d=v[4]
    if (axis == "x") return int((a + c) / 2)
    return int((b + d) / 2)
  }
  return ""
}
function flush_member() {
  if (member_bounds == "") return
  idx += 1
  cx = center(member_bounds, "x")
  cy = center(member_bounds, "y")
  print idx "\t" cx "\t" cy "\t" member_name "\t" member_place
}
BEGIN {
  idx = 0
  in_member = 0
  member_bounds = ""
  member_name = ""
  member_place = ""
}
{
  rid = attr_value($0, "resource-id")
  txt = attr_value($0, "text")
  b = attr_value($0, "bounds")

  if (rid ~ /com\.life360\.android\.safetymapd:id\/profile_cell_view_me/) {
    flush_member()
    in_member = 1
    member_bounds = b
    member_name = ""
    member_place = ""
    next
  }

  if (!in_member) next

  if (rid ~ /com\.life360\.android\.safetymapd:id\/name_textView/ && member_name == "") {
    member_name = txt
  }
  if (rid ~ /com\.life360\.android\.safetymapd:id\/place_textView/ && member_place == "") {
    member_place = txt
  }
}
END {
  flush_member()
}
' "$xml_file" > "$out_file"
}

extract_detail_summary() {
  local xml_file="$1"
  awk '
function decode(s) {
  gsub(/&quot;/, "\"", s)
  gsub(/&apos;/, "\047", s)
  gsub(/&amp;/, "&", s)
  gsub(/&lt;/, "<", s)
  gsub(/&gt;/, ">", s)
  return s
}
function attr_value(node, key,    p, v) {
  p = key "=\""
  if (match(node, p "[^\"]*\"")) {
    v = substr(node, RSTART + length(p), RLENGTH - length(p) - 1)
    return decode(v)
  }
  return ""
}
function interesting_text(t, lt) {
  lt = tolower(t)
  if (lt == "") return 0
  if (lt ~ /^location$|^driving$|^safety$|^membership$|^sos$|^save place$|^eta\?$/) return 0
  if (lt ~ /last updated|near |^at |battery|driving|location permissions off|precise location off|not at a location|summary|arrived|left|ago|km|mile|%/) return 1
  return 0
}
BEGIN {
  title = ""
  name = ""
  place = ""
  battery = ""
  last_updated = ""
}
{
  rid = attr_value($0, "resource-id")
  txt = attr_value($0, "text")

  if (rid ~ /customToolbarTitle/ && title == "") title = txt
  if (rid ~ /name_textView/ && name == "") name = txt
  if (rid ~ /place_textView/ && place == "") place = txt
  if (rid ~ /battery_percentages_textView/ && battery == "") battery = txt
  if (rid ~ /ds_label/ && tolower(txt) ~ /last updated/ && last_updated == "") last_updated = txt

  if (interesting_text(txt) && !(txt in seen)) {
    seen[txt] = 1
    extras[++n] = txt
  }
}
END {
  print "DETAIL|title=" title "|name=" name "|place=" place "|battery=" battery "|last_updated=" last_updated
  for (i = 1; i <= n; i++) {
    print "DETAIL_EXTRA|" extras[i]
  }
}
' "$xml_file"
}

detail_name_matches_target() {
  local xml_file="$1"
  local target="$2"
  awk -v target="$target" '
function decode(s) {
  gsub(/&quot;/, "\"", s); gsub(/&apos;/, "\047", s); gsub(/&amp;/, "&"); gsub(/&lt;/, "<"); gsub(/&gt;/, ">"); return s
}
function attr_value(node, key,    p, v) {
  p = key "=\""; if (match(node, p "[^\"]*\"")) { v = substr(node, RSTART + length(p), RLENGTH - length(p) - 1); return decode(v) } return ""
}
BEGIN { t = tolower(target) }
{
  rid = attr_value($0, "resource-id")
  txt = tolower(attr_value($0, "text"))
  if ((rid ~ /customToolbarTitle/ || rid ~ /name_textView/) && txt == t) {
    print "match"
    exit 0
  }
}
' "$xml_file" | grep -q match
}

has_permissions_warning_dialog() {
  local xml_file="$1"
  if grep -qE 'resource-id="com\.life360\.android\.safetymapd:id/dialogTitle".*location sharing features only work' "$xml_file"; then
    return 0
  fi
  if grep -qE 'resource-id="com\.life360\.android\.safetymapd:id/buttonTxt".*Go to Settings' "$xml_file"; then
    return 0
  fi
  return 1
}

has_blocking_overlay_dialog() {
  local xml_file="$1"
  if has_permissions_warning_dialog "$xml_file"; then
    return 0
  fi
  if grep -qE 'resource-id="com\.life360\.android\.safetymapd:id/ds_dialog_content"' "$xml_file"; then
    return 0
  fi
  if grep -qE 'Turn off Battery Optimization for Location Sharing|Change now' "$xml_file"; then
    return 0
  fi
  return 1
}

dismiss_blocking_overlays() {
  local xml_file="$1"
  local attempts=0
  local snap_cmd

  while (( attempts < 4 )); do
    if ! has_blocking_overlay_dialog "$xml_file"; then
      return 0
    fi

    # First try hardware back.
    adb_cmd shell input keyevent 4 >/dev/null || true
    sleep 0.35

    snap_cmd="cmd-${TASK_ID}-overlay-clear-$attempts"
    if run_actions "$snap_cmd" '{"id":"snap-overlay-clear","type":"snapshot_ui","params":{"format":"ascii"}}' 120; then
      snapshot_to_file "$xml_file"
      if ! has_blocking_overlay_dialog "$xml_file"; then
        return 0
      fi
    fi

    # If still visible, try tapping likely top-right close icon area.
    adb_cmd shell input tap "$OVERLAY_CLOSE_TAP_X" "$OVERLAY_CLOSE_TAP_Y" >/dev/null || true
    sleep 0.35
    if run_actions "$snap_cmd-tap" '{"id":"snap-overlay-tap","type":"snapshot_ui","params":{"format":"ascii"}}' 120; then
      snapshot_to_file "$xml_file"
    fi

    attempts=$((attempts + 1))
  done

  if has_blocking_overlay_dialog "$xml_file"; then
    return 1
  fi
  return 0
}

clear_permissions_warning_on_detail() {
  local attempts=0
  local clear_cmd

  while (( attempts < 3 )); do
    if ! has_permissions_warning_dialog "$DETAIL_XML"; then
      return 0
    fi

    adb_cmd shell input keyevent 4 >/dev/null || true
    sleep 1

    clear_cmd="cmd-${TASK_ID}-detail-clear-$attempts"
    if run_actions "$clear_cmd" '{"id":"snap-detail-clear","type":"snapshot_ui","params":{"format":"ascii"}}' 120; then
      snapshot_to_file "$DETAIL_XML"
    fi
    attempts=$((attempts + 1))
  done

  if has_permissions_warning_dialog "$DETAIL_XML"; then
    return 1
  fi
  return 0
}

capture_screenshot() {
  local person="$1"
  local ts
  local safe_person
  local file_path

  ts=$(date +%Y%m%d-%H%M%S)
  safe_person=$(printf '%s' "$person" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-')
  mkdir -p "$SCREENSHOT_DIR"
  file_path="$SCREENSHOT_DIR/life360-${safe_person}-${ts}.png"

  adb_cmd exec-out screencap -p > "$file_path"

  echo "$file_path"
}

ensure_single_device_or_serial
validate_package_name

echo "Running Life360 location lookup for person: $PERSON_NAME" >&2

NAV_CMD="cmd-${TASK_ID}-nav"
NAV_ACTIONS=$(cat <<JSON
{"id":"close","type":"close_app","params":{"applicationId":"$LIFE360_APP_ID"}},
{"id":"s1","type":"sleep","params":{"durationMs":900}},
{"id":"open","type":"open_app","params":{"applicationId":"$LIFE360_APP_ID"}},
{"id":"s2","type":"sleep","params":{"durationMs":6200}}
JSON
)

if ! run_actions "$NAV_CMD" "$NAV_ACTIONS" 140; then
  echo "ERROR|stage=navigation|message=Failed to open Life360"
  exit 3
fi

# Detect and dismiss the permission warning only when it is actually visible.
PRECHECK_SNAP_CMD="cmd-${TASK_ID}-precheck-snap"
if run_actions "$PRECHECK_SNAP_CMD" '{"id":"snap-precheck","type":"snapshot_ui","params":{"format":"ascii"}}' 120; then
  snapshot_to_file "$LIST_XML"
  if has_permissions_warning_dialog "$LIST_XML"; then
    adb_cmd shell input keyevent 4 >/dev/null || true
    sleep 1
  fi
fi

LIST_SNAP_CMD="cmd-${TASK_ID}-list-snap"
if ! run_actions "$LIST_SNAP_CMD" '{"id":"snap-list","type":"snapshot_ui","params":{"format":"ascii"}}' 120; then
  echo "ERROR|stage=snapshot|message=Failed to capture Life360 member list"
  exit 4
fi
snapshot_to_file "$LIST_XML"
if ! dismiss_blocking_overlays "$LIST_XML"; then
  echo "WARN|message=Could not fully dismiss overlay dialogs on overview screen"
fi
parse_members_from_list "$LIST_XML" "$MEMBERS_TSV"
if [[ "$RETURN_SCREENSHOT" == "1" || "$RETURN_SCREENSHOT" == "true" || "$RETURN_SCREENSHOT" == "yes" ]]; then
  OVERVIEW_SCREENSHOT_PATH=$(capture_screenshot "${PERSON_NAME}-overview")
fi

TARGET_CLICK_CMD="cmd-${TASK_ID}-click-target"
TARGET_NAME_ESC=$(json_escape_string "$PERSON_NAME")
TARGET_CLICK_ACTIONS=$(cat <<JSON
{"id":"click-target","type":"click","params":{"matcher":{"textEquals":"$TARGET_NAME_ESC"},"retry":{"maxAttempts":3,"initialDelayMs":500,"maxDelayMs":500}}},
{"id":"s1","type":"sleep","params":{"durationMs":1800}},
{"id":"snap-target","type":"snapshot_ui","params":{"format":"ascii"}}
JSON
)

found_target="false"
if run_actions "$TARGET_CLICK_CMD" "$TARGET_CLICK_ACTIONS" 120; then
  snapshot_to_file "$DETAIL_XML"
  if detail_name_matches_target "$DETAIL_XML" "$PERSON_NAME"; then
    found_target="true"
  fi
fi

if [[ "$found_target" != "true" ]]; then
  while IFS=$'\t' read -r idx cx cy member_name member_place; do
    [[ -z "$idx" ]] && continue
    if ! [[ "$cx" =~ ^[0-9]+$ && "$cy" =~ ^[0-9]+$ ]]; then
      echo "WARN|stage=coordinate_fallback|message=Skipping member row with invalid coordinates|idx=$idx|name=${member_name:-UNKNOWN}|cx=$cx|cy=$cy"
      continue
    fi
    adb_cmd shell input tap "$cx" "$cy" >/dev/null || true
    sleep 2

    DETAIL_SNAP_CMD="cmd-${TASK_ID}-detail-snap-$idx"
    if run_actions "$DETAIL_SNAP_CMD" '{"id":"snap-detail","type":"snapshot_ui","params":{"format":"ascii"}}' 120; then
      snapshot_to_file "$DETAIL_XML"
      if detail_name_matches_target "$DETAIL_XML" "$PERSON_NAME"; then
        found_target="true"
        break
      fi
    fi

    adb_cmd shell input keyevent 4 >/dev/null || true
    sleep 1
  done < "$MEMBERS_TSV"
fi

if [[ "$found_target" != "true" ]]; then
  echo "ERROR|stage=match|message=Could not find person '$PERSON_NAME'"
  echo "MEMBERS_DISCOVERED|"
  awk -F'\t' '{ if ($4 != "") print "- " $4 " @ " $5 }' "$MEMBERS_TSV"
  exit 5
fi

# Clear permissions warning if it appears on the detail screen before output.
if ! clear_permissions_warning_on_detail; then
  echo "WARN|message=Life360 permissions warning dialog still visible after retries"
fi

echo "SEARCH|app=$LIFE360_APP_ID|person=$PERSON_NAME|status=found"
extract_detail_summary "$DETAIL_XML"

if [[ "$RETURN_SCREENSHOT" == "1" || "$RETURN_SCREENSHOT" == "true" || "$RETURN_SCREENSHOT" == "yes" ]]; then
  screenshot_path="$OVERVIEW_SCREENSHOT_PATH"
  echo "SCREENSHOT|path=$screenshot_path"
  echo "SCREENSHOT_NOTE|captured_on=map_overview_before_detail_to_avoid_permissions_overlay"
fi
