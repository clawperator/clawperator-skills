---
name: com.google.android.apps.chromecast.app.get-climate-replay
clawperator-skill-type: replay
description: |-
  Replay baseline skill for reading a Google Home climate unit status.
---

Replay baseline skill for reading the visible climate status of a named Google Home climate unit.

Arguments:

- named wrapper arg: `--unit-name "<label>"`

Declared contract inputs:

- `unit_name`

Current behavior:

- opens Google Home from a fresh app session
- clicks `Home`
- scrolls to the `Climate` chip if needed
- scrolls to the requested climate tile and long-presses it to open the controller
- verifies the opened controller title matches the requested unit label
- reads:
  - device name from the controller toolbar
  - desired temperature from `com.google.android.apps.chromecast.app:id/low_value`
  - mode from `com.google.android.apps.chromecast.app:id/body_text`
  - fan speed from the visible fan speed tile
  - indoor temperature from the controller values area
  - outdoor temperature from the controller values area
- emits exactly one terminal `[Clawperator-Skill-Result]` frame with the parsed values

Known caveats:

- this replay depends on the current Google Home layout and the provided unit label remaining stable
- this first pass assumes the named climate unit is already available on the Google Home `Home` tab under the `Climate` category
- this first pass expects the controller screen to expose all of the above values in the same Google Home layout seen during recording

Run through the wrapper:

```bash
clawperator skills run com.google.android.apps.chromecast.app.get-climate-replay --device <device_serial> --operator-package com.clawperator.operator -- --unit-name "Living Room AC"
```

Direct local invocation:

```bash
CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator \
node skills/com.google.android.apps.chromecast.app.get-climate-replay/scripts/run.js <device_serial> --unit-name "Living Room AC"
```

## Recording Context

This skill was scaffolded with recording context at `recording-context.json`.
Read that file to inspect the recorded interaction timeline and raw events.
The recording context is reference evidence, not an executable skill recipe.
An external agent or human author must write the reusable skill logic.

Usage:

```bash
node skills/com.google.android.apps.chromecast.app.get-climate-replay/scripts/run.js <device_id> --unit-name "<label>"
```
