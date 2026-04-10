---
name: com.solaxcloud.starter.set-discharge-to-limit
description: |-
  Set the discharge-to-limit percentage in the SolaX Cloud app.
---

Set the discharge-to-limit percentage in the SolaX Cloud Android app.

Arguments:

- first positional arg after the device id: target percentage as an integer
  from `0` to `100`

Run through the wrapper:

```bash
clawperator skills run com.solaxcloud.starter.set-discharge-to-limit --device <device_serial> --operator-package com.clawperator.operator.dev -- 40
```

Direct local invocation:

```bash
DEVICE_ID=<device_serial> CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev node skills/com.solaxcloud.starter.set-discharge-to-limit/scripts/run.js <device_serial> 40
```

Current behavior:

- opens SolaX Cloud from a fresh app session
- switches to the `Intelligence` tab
- opens the `Peak Export` automation card
- opens the `Device Discharging (By percentage)` action card
- opens the `Discharge to ...` row
- enters the requested percentage
- clicks `Confirm`
- clicks the two observed `Save` buttons from the recorded flow
- returns the raw `clawperator exec --json` output

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
- the script assumes the account is already signed in and the app opens to the
  expected home flow
- if the Solax UI text or dialog structure changes, capture a new recording and
  refresh the selectors before broadening the skill

## Recording Context

This skill was scaffolded with recording context at `recording-context.json`.
Read that file to inspect the recorded interaction timeline and raw events.
The recording context is reference evidence, not an executable skill recipe.
An external agent or human author must write the reusable skill logic.

Usage:

```bash
node skills/com.solaxcloud.starter.set-discharge-to-limit/scripts/run.js <device_id> <percent>
```
