---
name: au.com.polyaire.airtouch5.set-office-power
clawperator-skill-type: script
description: |-
  Set an AirTouch 5 zone power on or off using snapshot geometry plus screenshot verification.
---

Deterministic AirTouch 5 skill for toggling a named zone power on a Samsung Android device.

Arguments:

- named wrapper arg: `--zone-name <label>`
- named wrapper arg: `--state <on|off>`
- legacy positional form after the device id also works: `on` or `off`

Declared contract inputs:

- `zone_name`
- `state`

Current behavior:

- opens `au.com.polyaire.airtouch5`
- switches to the `Zones` tab
- locates the requested zone row from the live snapshot XML
- derives the row's power hitbox from live geometry rather than a single fixed screen pixel
- captures a screenshot and classifies the zone power icon as visually `on` or `off`
- clicks the power hitbox only when the current visual state differs from the requested state
- captures a second screenshot and requires the zone power icon to match the requested state
- emits exactly one terminal `[Clawperator-Skill-Result]` frame with `contractVersion: "1.0.0"`
- omits `source` from the emitted frame; `runSkill` injects `source: { "kind": "script" }`

Known caveats:

- this first pass uses the same screenshot classifier that was proven against `Office`, `AJ`, and other visually similar zone power buttons
- verification is screenshot-based because the AirTouch WebView does not expose a semantic power state for the zone icon
- global screenshots are not bit-stable, so verification compares only the cropped zone power region
- if the app layout changes materially, the row-geometry heuristic may need to be updated

Run through the wrapper:

```bash
clawperator skills run au.com.polyaire.airtouch5.set-office-power --device <device_serial> --operator-package com.clawperator.operator.dev -- --zone-name AJ --state on
```

Direct local invocation:

```bash
node skills/au.com.polyaire.airtouch5.set-office-power/scripts/run.js <device_serial> --zone-name Office --state off
```
