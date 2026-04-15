---
name: com.google.android.apps.chromecast.app.set-power-replay
clawperator-skill-type: replay
description: |-
  Replay baseline skill for setting a Google Home climate unit power on or off.
---

Replay baseline skill for setting a named climate unit power state in the Google Home Android app.

Arguments:

- named wrapper arg: `--climate-state <on|off>`
- named wrapper arg: `--unit-name "<label>"`
- the replay script also accepts the legacy positional state form after the device id
- valid values: `on`, `off`

Declared contract inputs:

- `climate_state`
- `unit_name`

Current behavior:

- opens Google Home from a fresh app session
- clicks `Home` before climate navigation so the replay starts from the same entrypoint the recordings used
- scrolls to the `Climate` chip if needed
- scrolls to the requested climate tile and long-presses it to open the controller
- verifies the opened controller title matches the requested unit label before toggling
- reads the visible power state from `com.google.android.apps.chromecast.app:id/low_value`
- interprets a numeric `low_value` as powered `on` and literal `Off` as powered `off`
- clicks the climate power button only when the current power state differs from the requested one
- closes and reopens Google Home, returns to the controller, verifies the controller title again, and re-reads `low_value` for terminal verification
- emits exactly one terminal `[Clawperator-Skill-Result]` frame with `contractVersion: "1.0.0"`
- omits `source` from the emitted frame; `runSkill` injects `source: { "kind": "script" }`

Known caveats:

- the immediate controller view can be stale after a power-button tap, so this replay only trusts a fresh-session reread for terminal verification
- this first pass assumes the named climate unit is already available on the Google Home `Home` tab under the `Climate` category
- this replay proves the visible Google Home power state, not the physical compressor or fan activity
- the retained baseline came from the `off -> on` recording; the `on -> off` pass was also used as authoring evidence during development even though only one baseline file is retained here

Run through the wrapper:

```bash
clawperator skills run com.google.android.apps.chromecast.app.set-power-replay --device <device_serial> --operator-package com.clawperator.operator.dev -- --climate-state on --unit-name "Living Room AC"
```

Direct local invocation:

```bash
CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev \
node skills/com.google.android.apps.chromecast.app.set-power-replay/scripts/run.js <device_serial> --climate-state off --unit-name "Living Room AC"
```

## Recording Context

This skill was scaffolded with recording context at `recording-context.json`.
Read that file to inspect the recorded interaction timeline and raw events.
The recording context is reference evidence, not an executable skill recipe.
An external agent or human author must write the reusable skill logic.

Usage:

```bash
node skills/com.google.android.apps.chromecast.app.set-power-replay/scripts/run.js <device_id> --climate-state <on|off> --unit-name "<label>"
```
