---
name: com.globird.energy.get-yesterday-usage-cost-replay
description: |-
  Open the GloBird Android app and extract the signed dollar amount shown for
  Yesterday usage -> Cost.
---

Replay skill for the GloBird Android app (`com.globird.energy`).

This skill:

- force-stops GloBird for a fresh run
- re-opens the app
- taps the `Energy` tab
- captures a UI snapshot
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

## Caveats

- This replay assumes the app can reach the Energy screen from a fresh open.
- It relies on the current GloBird labels `YESTERDAY USAGE` and `Cost`.
- If the Yesterday section is not visible or the UI copy changes, the skill
  exits with a parsing error instead of guessing.

Usage:

```bash
node skills/com.globird.energy.get-yesterday-usage-cost-replay/scripts/run.js <device_id> [operator_package]
```
