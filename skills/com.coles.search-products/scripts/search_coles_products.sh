#!/bin/bash
set -euo pipefail

PKG="${1:-app.actiontask.operator.development}"
QUERY="${2:-Coke Zero}"
MAX_SCROLLS="${MAX_SCROLLS:-8}"
ADB_BIN="${ADB_BIN:-adb}"

APP_ID="com.coles.android.shopmate"
TASK_ID="coles-search-$(date +%s)-$RANDOM"
RAW_RESULTS="$(mktemp)"
XML_FILE="$(mktemp)"
trap 'rm -f "$RAW_RESULTS" "$XML_FILE"' EXIT

build_payload() {
  local command_id="$1"
  local actions_json="$2"
  cat <<JSON
{"taskId":"$TASK_ID","commandId":"$command_id","source":"skill-com.coles.search-products","actions":[$actions_json]}
JSON
}

send_payload() {
  local payload="$1"
  local single_line_payload
  single_line_payload=$(printf '%s' "$payload" | tr -d '\n')
  "$ADB_BIN" shell am broadcast \
    -a app.actiontask.operator.ACTION_AGENT_COMMAND \
    -p "$PKG" \
    --es payload "$single_line_payload" \
    --receiver-foreground >/dev/null
}

wait_for_command_completion() {
  local command_id="$1"
  local timeout_sec="${2:-120}"
  local elapsed=0
  local logs
  while (( elapsed < timeout_sec )); do
    logs=$("$ADB_BIN" logcat -d | grep "$command_id" || true)
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

  "$ADB_BIN" logcat -c
  send_payload "$payload"
  wait_for_command_completion "$command_id" "$timeout_sec"
}

extract_xml_to_file() {
  : > "$XML_FILE"
  "$ADB_BIN" logcat -d \
    | grep "TaskScopeDefault:" \
    | sed -E 's/^.*TaskScopeDefault: //' \
    > "$XML_FILE" || true
}

parse_snapshot() {
  local xml_path="$1"
  awk '
function decode(s) {
  gsub(/&quot;/, "\"", s)
  gsub(/&apos;/, "\047", s)
  gsub(/&amp;/, "&", s)
  gsub(/&lt;/, "<", s)
  gsub(/&gt;/, ">", s)
  return s
}
function attr_value(node, key,     p, v) {
  p = key "=\""
  if (match(node, p "[^\"]*\"")) {
    v = substr(node, RSTART + length(p), RLENGTH - length(p) - 1)
    return decode(v)
  }
  return ""
}
function first_price(s,   m) {
  if (match(s, /\$[0-9]+(\.[0-9]{2})?/)) {
    m = substr(s, RSTART, RLENGTH)
    return m
  }
  return ""
}
function is_unit_price(text) {
  return (text ~ /\$[0-9]+(\.[0-9]{2})?\s*\/\s*[0-9a-zA-Z]/)
}
function lower_trim(s,   t) {
  t = tolower(s)
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", t)
  return t
}
function is_name_candidate(text, lt) {
  if (text == "") return 0
  lt = lower_trim(text)
  if (length(lt) < 6) return 0
  if (lt ~ /^\$/) return 0
  if (lt ~ /^was \$/) return 0
  if (lt ~ /^save \$/) return 0
  if (lt ~ /^special$/) return 0
  if (lt ~ /results for/) return 0
  if (lt ~ /^sort|^filter|^search|^view all|^products you might like|^suggested searches$/) return 0
  if (lt ~ /find a product|item [0-9]+ of [0-9]+/) return 0
  if (text !~ /[[:alpha:]]/) return 0
  return 1
}
function flush_item() {
  if (name == "") return
  if (price == "") price = "NA"
  if (on_sale == "") on_sale = "NO"
  if (original == "") original = "NA"
  gsub(/[\t\r\n]+/, " ", name)
  print name "\t" price "\t" on_sale "\t" original
}
BEGIN {
  name = ""
  price = ""
  original = ""
  on_sale = ""
  pending_special = 0
  in_results = 0
}
{
  line = $0
  text = attr_value(line, "text")
  cdesc = attr_value(line, "content-desc")
  lt = lower_trim(text)
  lcd = lower_trim(cdesc)

  if (!in_results) {
    if (lt ~ /results for/ || lcd ~ /results for/) {
      in_results = 1
    }
  }

  if (!in_results) {
    next
  }

  if (lt == "special" || lcd == "special") {
    if (name != "") {
      on_sale = "YES"
    } else {
      pending_special = 1
    }
    next
  }

  if (lt ~ /^was \$/) {
    op = first_price(text)
    if (op != "") {
      if (name != "") {
        original = op
        on_sale = "YES"
      }
    }
    next
  }

  if (is_name_candidate(text)) {
    flush_item()
    name = text
    price = ""
    original = ""
    on_sale = (pending_special ? "YES" : "NO")
    pending_special = 0
    next
  }

  if (name != "" && text ~ /^\$[0-9]+(\.[0-9]{2})?$/ && !is_unit_price(text)) {
    if (price == "") {
      price = text
    }
    next
  }
}
END {
  flush_item()
}
' "$xml_path"
}

summarize_results() {
  local raw_file="$1"
  awk -F'\t' '
{
  if ($1 == "") next
  name = $1
  cur = $2
  sale = $3
  orig = $4

  if (!(name in order)) {
    count += 1
    order[name] = count
    names[count] = name
    current[name] = cur
    on_sale[name] = sale
    original[name] = orig
  } else {
    if ((current[name] == "" || current[name] == "NA") && cur != "" && cur != "NA") current[name] = cur
    if (sale == "YES") on_sale[name] = "YES"
    if ((original[name] == "" || original[name] == "NA") && orig != "" && orig != "NA") original[name] = orig
  }
}
END {
  for (i = 1; i <= count; i++) {
    name = names[i]
    cur = current[name]; if (cur == "") cur = "NA"
    sale = on_sale[name]; if (sale == "") sale = "NO"
    orig = original[name]; if (orig == "") orig = "NA"
    printf "%d\t%s\t%s\t%s\t%s\n", i, name, cur, sale, orig
  }
}
' "$raw_file"
}

echo "Running Coles search for query: $QUERY" >&2

NAV_CMD="cmd-${TASK_ID}-nav"
NAV_ACTIONS=$(cat <<JSON
{"id":"nav-close","type":"close_app","params":{"applicationId":"$APP_ID"}},
{"id":"nav-sleep-1","type":"sleep","params":{"durationMs":900}},
{"id":"nav-open","type":"open_app","params":{"applicationId":"$APP_ID"}},
{"id":"nav-sleep-2","type":"sleep","params":{"durationMs":4200}},
{"id":"nav-click-search","type":"click","params":{"matcher":{"textContains":"Search"},"retry":{"maxAttempts":3,"initialDelayMs":600,"maxDelayMs":600}}}
JSON
)

if ! run_actions "$NAV_CMD" "$NAV_ACTIONS" 140; then
  echo "ERROR|stage=navigation|message=Failed to open Coles and focus search"
  exit 2
fi

TYPE_CMD="cmd-${TASK_ID}-type"
TYPE_TEXT_ESCAPED=$(printf '%s' "$QUERY" | sed 's/"/\\"/g')
TYPE_ACTIONS=$(cat <<JSON
{"id":"type-enter-text","type":"enter_text","params":{"matcher":{"role":"textfield"},"text":"$TYPE_TEXT_ESCAPED","submit":true,"retry":{"maxAttempts":3,"initialDelayMs":600,"maxDelayMs":600}}},
{"id":"type-sleep","type":"sleep","params":{"durationMs":1800}}
JSON
)

if ! run_actions "$TYPE_CMD" "$TYPE_ACTIONS" 120; then
  echo "ERROR|stage=typing|message=Failed to enter Coles query"
  exit 3
fi

"$ADB_BIN" shell input keyevent 66 >/dev/null || true
sleep 2

for ((i = 1; i <= MAX_SCROLLS; i++)); do
  SNAP_CMD="cmd-${TASK_ID}-snap-$i"
  SNAP_ACTIONS="{\"id\":\"snap-$i\",\"type\":\"snapshot_ui\",\"params\":{\"format\":\"ascii\"}}"

  if run_actions "$SNAP_CMD" "$SNAP_ACTIONS" 120; then
    extract_xml_to_file
    if [[ -s "$XML_FILE" ]]; then
      parse_snapshot "$XML_FILE" >> "$RAW_RESULTS" || true
    fi
  fi

  "$ADB_BIN" shell input swipe 540 1980 540 930 260 >/dev/null || true
  sleep 1
done

SUMMARY_LINES=$(summarize_results "$RAW_RESULTS" || true)
TOTAL=$(printf '%s\n' "$SUMMARY_LINES" | sed '/^$/d' | wc -l | tr -d ' ')

if [[ "$TOTAL" -eq 0 ]]; then
  echo "ERROR|stage=parse|message=No products parsed from snapshots"
  exit 4
fi

echo "SEARCH|app=$APP_ID|query=$QUERY|total_results=$TOTAL"
printf '%s\n' "$SUMMARY_LINES" | while IFS=$'\t' read -r idx name cur sale orig; do
  if [[ "$sale" == "YES" && "$orig" != "NA" ]]; then
    echo "RESULT|index=$idx|name=$name|current_price=$cur|on_sale=YES|original_price=$orig"
  else
    echo "RESULT|index=$idx|name=$name|current_price=$cur|on_sale=$sale|original_price=NA"
  fi
done
