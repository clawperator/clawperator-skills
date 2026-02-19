#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$ROOT/skills"
INDEX_DIR="$SKILLS_DIR/generated"
BY_APP_DIR="$INDEX_DIR/by-app"
BY_PREFIX_DIR="$INDEX_DIR/by-prefix"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

hash_sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return 0
  fi
  echo "Missing hash tool: need sha256sum or shasum" >&2
  exit 1
}

hash_sha1_text() {
  local text="$1"
  if command -v sha1sum >/dev/null 2>&1; then
    printf '%s' "$text" | sha1sum | awk '{print $1}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$text" | shasum | awk '{print $1}'
    return 0
  fi
  echo "Missing hash tool: need sha1sum or shasum" >&2
  exit 1
}

META_FILES=()
while IFS= read -r file; do
  META_FILES+=("$file")
done < <(find "$SKILLS_DIR" -mindepth 2 -type f -name skill.json | sort)

if (( ${#META_FILES[@]} == 0 )); then
  echo "No skill metadata files found under skills/**/skill.json" >&2
  exit 1
fi

for file in "${META_FILES[@]}"; do
  jq -e . "$file" >/dev/null
  id="$(jq -r '.id' "$file")"
  rel_dir="${file#$ROOT/}"
  rel_dir="$(dirname "$rel_dir")"
  declared_path="$(jq -r '.path' "$file")"
  if [[ "$declared_path" != "$rel_dir" ]]; then
    echo "Metadata path mismatch: $file declares path=$declared_path but directory=$rel_dir (id=$id)" >&2
    exit 1
  fi

  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if [[ ! -e "$ROOT/$path" ]]; then
      echo "Missing referenced file in $file: $path" >&2
      exit 1
    fi
  done < <(jq -r '.path, .skillFile, (.scripts[]), (.artifacts[])' "$file")
done

skills_array="$TMP_DIR/skills-array.json"
jq -s 'sort_by(.id)' "${META_FILES[@]}" > "$skills_array"
skill_count="$(jq 'length' "$skills_array")"
generated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

rm -rf "$INDEX_DIR"
mkdir -p "$BY_APP_DIR" "$BY_PREFIX_DIR"

jq \
  --arg ts "$generated_at" \
  '{ "$schema":"./skills-registry.schema.json", schemaVersion:"1.0", generatedAt:$ts, skills:. }' \
  "$skills_array" > "$SKILLS_DIR/skills-registry.json"

jq \
  --arg ts "$generated_at" \
  '{schemaVersion:"1.0", generatedAt:$ts, count:length, skills:(map({id, applicationId, intent, summary, path}))}' \
  "$skills_array" > "$INDEX_DIR/skills-index.min.json"

jq -c '.[]' "$skills_array" > "$INDEX_DIR/skills-index.jsonl"

while IFS= read -r app_id; do
  jq \
    --arg app "$app_id" \
    --arg ts "$generated_at" \
    '{schemaVersion:"1.0", generatedAt:$ts, applicationId:$app, count:([.[] | select(.applicationId == $app)] | length), skills:[.[] | select(.applicationId == $app)]}' \
    "$skills_array" > "$BY_APP_DIR/$app_id.json"
done < <(jq -r '.[].applicationId' "$skills_array" | sort -u)

while IFS= read -r line; do
  id="$(printf '%s' "$line" | jq -r '.id')"
  prefix="$(hash_sha1_text "$id" | awk '{print substr($1,1,2)}')"
  printf '%s\n' "$line" >> "$TMP_DIR/prefix-$prefix.jsonl"
done < "$INDEX_DIR/skills-index.jsonl"

for file in "$TMP_DIR"/prefix-*.jsonl; do
  [[ -e "$file" ]] || continue
  prefix="$(basename "$file" | sed -E 's/^prefix-([^.]+)\.jsonl$/\1/')"
  jq -s \
    --arg p "$prefix" \
    --arg ts "$generated_at" \
    '{schemaVersion:"1.0", generatedAt:$ts, prefix:$p, count:length, skills:.}' \
    "$file" > "$BY_PREFIX_DIR/$prefix.json"
done

app_manifest_jsonl="$TMP_DIR/by-app.jsonl"
app_files=( "$BY_APP_DIR"/*.json )
for file in "${app_files[@]}"; do
  [[ -e "$file" ]] || continue
  app_id="$(jq -r '.applicationId' "$file")"
  count="$(jq -r '.count' "$file")"
  sha256="$(hash_sha256_file "$file")"
  rel="skills/generated/by-app/$(basename "$file")"
  jq -cn \
    --arg app "$app_id" \
    --arg file "$rel" \
    --arg sha "$sha256" \
    --argjson count "$count" \
    '{applicationId:$app, file:$file, sha256:$sha, count:$count}' >> "$app_manifest_jsonl"
done

prefix_manifest_jsonl="$TMP_DIR/by-prefix.jsonl"
prefix_files=( "$BY_PREFIX_DIR"/*.json )
for file in "${prefix_files[@]}"; do
  [[ -e "$file" ]] || continue
  prefix="$(jq -r '.prefix' "$file")"
  count="$(jq -r '.count' "$file")"
  sha256="$(hash_sha256_file "$file")"
  rel="skills/generated/by-prefix/$(basename "$file")"
  jq -cn \
    --arg prefix "$prefix" \
    --arg file "$rel" \
    --arg sha "$sha256" \
    --argjson count "$count" \
    '{prefix:$prefix, file:$file, sha256:$sha, count:$count}' >> "$prefix_manifest_jsonl"
done

registry_sha="$(hash_sha256_file "$SKILLS_DIR/skills-registry.json")"
min_sha="$(hash_sha256_file "$INDEX_DIR/skills-index.min.json")"
jsonl_sha="$(hash_sha256_file "$INDEX_DIR/skills-index.jsonl")"

jq -n \
  --arg ts "$generated_at" \
  --arg registrySha "$registry_sha" \
  --arg minSha "$min_sha" \
  --arg jsonlSha "$jsonl_sha" \
  --argjson total "$skill_count" \
  --slurpfile byApp "$app_manifest_jsonl" \
  --slurpfile byPrefix "$prefix_manifest_jsonl" \
  '{
    schemaVersion: "1.0",
    generatedAt: $ts,
    totalSkills: $total,
    artifacts: {
      registry: { file: "skills/skills-registry.json", sha256: $registrySha, count: $total },
      minIndex: { file: "skills/generated/skills-index.min.json", sha256: $minSha, count: $total },
      jsonlIndex: { file: "skills/generated/skills-index.jsonl", sha256: $jsonlSha, count: $total }
    },
    shards: {
      byApp: $byApp,
      byPrefix: $byPrefix
    }
  }' > "$INDEX_DIR/manifest.json"

echo "Generated skill registry and indexes for $skill_count skills."
