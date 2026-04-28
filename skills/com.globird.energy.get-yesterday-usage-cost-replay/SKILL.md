---
name: com.globird.energy.get-yesterday-usage-cost-replay
clawperator-skill-type: replay
description: |-
  Open the GloBird Android app and extract the signed dollar amount shown for
  Yesterday usage -> Cost.
---

Replay skill for the GloBird Android app (`com.globird.energy`).

This skill:

- force-stops GloBird for a fresh run
- re-opens the app
- taps the `Energy` tab
- waits for the Yesterday usage section and reads its text directly
- extracts the signed dollar amount under `YESTERDAY USAGE` -> `Cost`

The extracted amount may be positive or negative. The parser accepts values such
as `$4.17` and `-$4.17`.

## Recording Context

This skill was scaffolded with recording context at `recording-context.json`.
Read that file to inspect the recorded interaction timeline and raw events.
The recording context is reference evidence, not an executable skill recipe.
An external agent or human author must write the reusable skill logic.

## Retained Compare Baseline

The sanitized retained baseline for compare lives at
`references/compare-baseline.export.json`.

This file is authoring and maintenance evidence only. It is not a runtime
artifact and is intentionally not listed under `skill.json.artifacts`.

## Output

On success, the script prints one line:

```text
GloBird yesterday usage cost: <signed_dollar_amount>
```

Example:

```text
GloBird yesterday usage cost: -$4.17
```

If GloBird has not published the Yesterday usage section yet, the script exits
successfully and prints:

```text
No result available yet.
```

The framed SkillResult uses `status: "success"` with
`result.value.available: false`, `result.value.displayText:
"No result available yet."`, and `diagnostics.runtimeState: "unavailable"`.

## Caveats

- This replay assumes the app can reach the Energy screen from a fresh open.
- It relies on the current GloBird labels `YESTERDAY USAGE` and `Cost`.
- If the Yesterday section is not visible or the UI copy changes, the skill
  exits with a parsing error instead of guessing, except for the expected
  missing `YESTERDAY USAGE` section case described above.
- The runtime uses `wait_for_node` plus `read_text` instead of a fixed sleep and
  full snapshot parsing, which makes it resilient to the installed binary's
  snapshot extraction issues.

Usage:

```bash
node skills/com.globird.energy.get-yesterday-usage-cost-replay/scripts/run.js <device_id> [operator_package]
```
