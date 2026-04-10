---
name: com.solaxcloud.starter.set-discharge-to-limit-replay
description: |-
  Replay baseline skill for setting the discharge-to-limit percentage in the SolaX Cloud app.
---

Replay baseline skill for setting the discharge-to-limit percentage in the SolaX Cloud Android app.

Arguments:

- named wrapper arg: `--limit <percent>`
- the replay script also still accepts the legacy positional percent form after
  the device id for compatibility
- valid range: integer from `0` to `100`

Run through the wrapper:

```bash
clawperator skills run com.solaxcloud.starter.set-discharge-to-limit-replay --device <device_serial> --operator-package com.clawperator.operator.dev --limit 40
```

Direct local invocation:

```bash
DEVICE_ID=<device_serial> CLAWPERATOR_BIN="<node_binary> <clawperator_root>/apps/node/dist/cli/index.js" CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev <node_binary> skills/com.solaxcloud.starter.set-discharge-to-limit-replay/scripts/run.js <device_serial> --limit 40
```

Current behavior:

- opens SolaX Cloud from a fresh app session
- switches to the `Intelligence` tab
- opens the `Peak Export` automation card
- opens the `Device Discharging (By percentage)` action card
- opens the `Discharge to ...` row
- enters the requested percentage
- clicks `Confirm`
- clicks the toolbar `Save`
- clicks the recorded bottom `Save` button using its observed lower-screen position
- re-reads the `Discharge to ...` row after save and only reports success when it matches the requested value
- returns the raw verification `clawperator exec --json` output on success

Known caveats:

- this first version is based on one Samsung recording with snapshot export set
  to omit, so the selectors are intentionally conservative
- the current UI dump shows `Peak Export` as the automation card on the
  `Intelligence` tab that leads to the discharge setting screen
- the current UI dump on the detail screen shows a clickable
  `Device Discharging (By percentage)` card first, and only then a
  `Discharge to 40%`-style row one level deeper
- the first two taps are implemented as device-specific coordinate clicks on
  this Samsung layout because the visible text nodes are not the actual
  clickable containers
- the current Samsung coordinates used by the script are the recorded container
  taps for `Peak Export` and `Device Discharging (By percentage)`, not generic
  text-node clicks
- the final bottom-sheet `Save` tap is also implemented as a recorded
  lower-screen coordinate click to disambiguate it from the earlier toolbar
  `Save` action with the same label
- the `Discharge to` dialog input is persisted reliably only when the script
  uses real key events (`DEL`, `DEL`, text entry, then `Enter`) before
  `Confirm`; plain text-set behavior was not sufficient for this app flow
- this replay version verifies final state itself by re-reading the row text
  after save; if the observed row does not match the requested percentage, the
  skill exits non-zero
- if the row already showed the requested percentage before the change, the
  skill still proves final state but cannot prove that the value changed from a
  different starting value; the script logs that residual risk to `stderr`
- the script assumes the account is already signed in and the app opens to the
  expected home flow
- if the Solax UI text or dialog structure changes, capture a new recording and
  refresh the selectors before broadening the skill

## Validation

Success path:

```bash
CLAWPERATOR_SKILLS_REGISTRY="<clawperator_skills_root>/skills/skills-registry.json" \
CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev \
<node_binary> <clawperator_root>/apps/node/dist/cli/index.js skills run com.solaxcloud.starter.set-discharge-to-limit-replay --device <device_serial> --json --limit 40
```

Forced-failure repro:

```bash
CLAWPERATOR_SKILLS_REGISTRY="<clawperator_skills_root>/skills/skills-registry.json" \
CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev \
CLAWPERATOR_SOLAX_REPLAY_FORCE_FAILURE=1 \
<node_binary> <clawperator_root>/apps/node/dist/cli/index.js skills run com.solaxcloud.starter.set-discharge-to-limit-replay --device <device_serial> --json --limit 40
```

Expected forced-failure shape:

- `ok: false`
- `code: "SKILL_EXECUTION_FAILED"`
- non-zero `exitCode`
- preserved nested `clawperator exec --json` failure output on `stdout`

## Recording Context

This skill was scaffolded with recording context at `recording-context.json`.
Read that file to inspect the recorded interaction timeline and raw events.
The recording context is reference evidence, not an executable skill recipe.
An external agent or human author must write the reusable skill logic.

Usage:

```bash
node skills/com.solaxcloud.starter.set-discharge-to-limit-replay/scripts/run.js <device_id> [--limit <percent>|<percent>]
```
