#!/bin/bash
set -euo pipefail

PKG="${1:-app.actiontask.operator.development}"
QUERY="${2:-Coke Zero}"
MAX_SCROLLS="${MAX_SCROLLS:-8}"
ADB_BIN="${ADB_BIN:-adb}"

TASK_ID="wool-search-$(date +%s)-$RANDOM"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RAW_RESULTS="$(mktemp)"
XML_FILE="$(mktemp)"
trap 'rm -f "$RAW_RESULTS" "$XML_FILE"' EXIT

log() {
  echo "$*" >&2
}

build_payload() {
  local command_id="$1"
  local actions_json="$2"
  cat <<JSON
{"taskId":"$TASK_ID","commandId":"$command_id","source":"skill-com.woolworths.search-products","actions":[$actions_json]}
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

  if ! wait_for_command_completion "$command_id" "$timeout_sec"; then
    return 1
  fi
  return 0
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
function first_price(s,    m) {
  if (match(s, /\$[0-9]+(\.[0-9]{2})?/)) {
    m = substr(s, RSTART, RLENGTH)
    return m
  }
  return ""
}
function flush_item() {
  if (name == "") {
    return
  }
  if (current_price == "") {
    current_price = "NA"
  }
  if (on_sale != "YES") {
    on_sale = "NO"
  }
  if (original_price == "") {
    original_price = "NA"
  }
  gsub(/[\t\r\n]+/, " ", name)
  print name "\t" current_price "\t" on_sale "\t" original_price
}
BEGIN {
  name = ""
  current_price = ""
  original_price = ""
  on_sale = "NO"
}
{
  gsub(/></, ">\n<", $0)
  n = split($0, parts, "\n")
  for (i = 1; i <= n; i++) {
    node = parts[i]
    rid = attr_value(node, "resource-id")
    txt = attr_value(node, "text")
    desc = attr_value(node, "content-desc")
    lower = tolower(txt " " desc " " rid)

    if (rid ~ /com\.woolworths:id\/product_name_text_view/) {
      flush_item()
      name = txt
      current_price = ""
      original_price = ""
      on_sale = "NO"
      continue
    }

    if (name == "") {
      continue
    }

    if (rid ~ /com\.woolworths:id\/product_price_view/ && current_price == "") {
      price_candidate = first_price(desc)
      if (price_candidate == "") {
        price_candidate = first_price(txt)
      }
      if (price_candidate != "") {
        current_price = price_candidate
      }
      continue
    }

    if (rid ~ /was/ || lower ~ /\bwas\b/) {
      op = first_price(desc)
      if (op == "") {
        op = first_price(txt)
      }
      if (op != "") {
        original_price = op
        on_sale = "YES"
      }
    }

    if (lower ~ /special|\bsave\b|discount|half price/) {
      on_sale = "YES"
    }
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
    if ((current[name] == "" || current[name] == "NA") && cur != "" && cur != "NA") {
      current[name] = cur
    }
    if (sale == "YES") {
      on_sale[name] = "YES"
    }
    if ((original[name] == "" || original[name] == "NA") && orig != "" && orig != "NA") {
      original[name] = orig
    }
  }
}
END {
  for (i = 1; i <= count; i++) {
    name = names[i]
    cur = current[name]
    sale = on_sale[name]
    orig = original[name]
    if (cur == "") cur = "NA"
    if (sale == "") sale = "NO"
    if (orig == "") orig = "NA"
    printf "%d\t%s\t%s\t%s\t%s\n", i, name, cur, sale, orig
  }
}
' "$raw_file"
}

log "Running Woolworths search for query: $QUERY"

NAV_CMD="cmd-${TASK_ID}-nav"
NAV_ACTIONS=$(cat <<'JSON'
{"id":"nav-close","type":"close_app","params":{"applicationId":"com.woolworths"}},
{"id":"nav-sleep-1","type":"sleep","params":{"durationMs":800}},
{"id":"nav-open","type":"open_app","params":{"applicationId":"com.woolworths"}},
{"id":"nav-sleep-2","type":"sleep","params":{"durationMs":3200}},
{"id":"nav-click-search","type":"click","params":{"matcher":{"textContains":"Search"},"retry":{"maxAttempts":3,"initialDelayMs":500,"maxDelayMs":500}}}
JSON
)

if ! run_actions "$NAV_CMD" "$NAV_ACTIONS" 140; then
  echo "ERROR|stage=navigation|message=Failed to open Woolworths and focus search"
  exit 2
fi

TYPE_CMD="cmd-${TASK_ID}-type"
TYPE_TEXT_ESCAPED=$(printf '%s' "$QUERY" | sed 's/"/\\"/g')
TYPE_ACTIONS=$(cat <<JSON
{"id":"type-enter-text","type":"enter_text","params":{"matcher":{"role":"textfield"},"text":"$TYPE_TEXT_ESCAPED","submit":true,"retry":{"maxAttempts":3,"initialDelayMs":500,"maxDelayMs":500}}},
{"id":"type-sleep","type":"sleep","params":{"durationMs":1200}}
JSON
)

if ! run_actions "$TYPE_CMD" "$TYPE_ACTIONS" 120; then
  echo "ERROR|stage=typing|message=Failed to enter search query"
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

  "$ADB_BIN" shell input swipe 540 2050 540 950 260 >/dev/null || true
  sleep 1
done

SUMMARY_LINES=$(summarize_results "$RAW_RESULTS" || true)
TOTAL=$(printf '%s\n' "$SUMMARY_LINES" | sed '/^$/d' | wc -l | tr -d ' ')

if [[ "$TOTAL" -eq 0 ]]; then
  echo "ERROR|stage=parse|message=No products parsed from snapshots"
  exit 4
fi

echo "SEARCH|app=com.woolworths|query=$QUERY|total_results=$TOTAL"
printf '%s\n' "$SUMMARY_LINES" | while IFS=$'\t' read -r idx name cur sale orig; do
  if [[ "$sale" == "YES" && "$orig" != "NA" ]]; then
    echo "RESULT|index=$idx|name=$name|current_price=$cur|on_sale=YES|original_price=$orig"
  else
    echo "RESULT|index=$idx|name=$name|current_price=$cur|on_sale=$sale|original_price=NA"
  fi
done
