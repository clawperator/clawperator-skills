---
name: au.com.polyaire.airtouch5.set-zone-state
clawperator-skill-type: script
description: |-
  Set an AirTouch 5 zone state to on or off using snapshot geometry plus screenshot verification.
---

Deterministic AirTouch 5 skill for setting a named zone state on a Samsung Android device.

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
- derives the row's on/off control hitbox from live geometry rather than a single fixed screen pixel
- captures a screenshot and classifies the zone control as visually `on` or `off`
- clicks the control hitbox only when the current visual state differs from the requested state
- captures a second screenshot and requires the zone control to match the requested state
- emits exactly one terminal `[Clawperator-Skill-Result]` frame with `contractVersion: "1.0.0"`
- omits `source` from the emitted frame; `runSkill` injects `source: { "kind": "script" }`

Known caveats:

- this first pass uses the same screenshot classifier that was proven against multiple visually similar zone controls
- verification is screenshot-based because the AirTouch WebView does not expose a semantic on/off state for the zone icon
- global screenshots are not bit-stable, so verification compares only the cropped zone control region
- if the app layout changes materially, the row-geometry heuristic may need to be updated

Run through the wrapper:

```bash
clawperator skills run au.com.polyaire.airtouch5.set-zone-state --device <device_serial> --operator-package com.clawperator.operator.dev -- --zone-name Office --state on
```

Direct local invocation:

```bash
node skills/au.com.polyaire.airtouch5.set-zone-state/scripts/run.js <device_serial> --zone-name Office --state off
```
