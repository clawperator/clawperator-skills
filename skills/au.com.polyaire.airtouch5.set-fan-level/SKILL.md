---
name: au.com.polyaire.airtouch5.set-fan-level
clawperator-skill-type: replay
description: |-
  Set the AirTouch 5 fan level to auto, low, medium, or high from the Home screen.
---

Deterministic AirTouch 5 skill for setting the Home-screen fan level to `auto`, `low`, `medium`, or `high`.

Arguments:

- named wrapper arg: `--fan-level <auto|low|medium|high>`
- legacy positional form after the device id also works

Declared contract inputs:

- `fan_level`

Current behavior:

- opens `au.com.polyaire.airtouch5`
- waits for the `Home` surface to stabilize
- reads the current fan label from the text shown above the right-hand Home control
- derives the fan control hitbox from the live Home geometry
- opens the fan selector from the Home control and chooses the requested option by visible text
- emits exactly one terminal `[Clawperator-Skill-Result]` frame with `contractVersion: "1.0.0"`
- omits `source` from the emitted frame; `runSkill` injects `source: { "kind": "script" }`

Known caveats:

- verification is snapshot-text-based because the AirTouch WebView does not expose a separate semantic fan-level value
- the skill assumes the fan control is only adjustable while AirTouch power is on
- if tapping the control launches an unexpected foreground app, the skill reopens AirTouch and continues reading the Home state before deciding whether it succeeded

Run through the wrapper:

```bash
clawperator skills run au.com.polyaire.airtouch5.set-fan-level --device <device_serial> --operator-package <operator_package> -- --fan-level medium
```

Direct local invocation:

```bash
node skills/au.com.polyaire.airtouch5.set-fan-level/scripts/run.js <device_serial> --fan-level auto
```
