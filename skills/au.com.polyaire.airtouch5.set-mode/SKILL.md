---
name: au.com.polyaire.airtouch5.set-mode
clawperator-skill-type: replay
description: |-
  Set the AirTouch 5 operating mode to cool, heat, fan, dry, or auto from the Home screen.
---

Deterministic AirTouch 5 skill for setting the Home-screen operating mode to `cool`, `heat`, `fan`, `dry`, or `auto`.

Arguments:

- named wrapper arg: `--mode <cool|heat|fan|dry|auto>`
- legacy positional form after the device id also works

Declared contract inputs:

- `mode`

Current behavior:

- opens `au.com.polyaire.airtouch5`
- waits for the `Home` surface to stabilize
- reads the current mode label from the text shown above the middle Home control
- derives the mode control hitbox from the live Home geometry
- opens the mode selector from the Home control and chooses the requested option by visible text
- emits exactly one terminal `[Clawperator-Skill-Result]` frame with `contractVersion: "1.0.0"`
- omits `source` from the emitted frame; `runSkill` injects `source: { "kind": "script" }`

Known caveats:

- verification is snapshot-text-based because the AirTouch WebView does not expose a separate semantic mode value
- the skill assumes the mode control is only adjustable while AirTouch power is on
- if tapping the control launches an unexpected foreground app, the skill reopens AirTouch and continues reading the Home state before deciding whether it succeeded

Run through the wrapper:

```bash
clawperator skills run au.com.polyaire.airtouch5.set-mode --device <device_serial> --operator-package <operator_package> -- --mode heat
```

Direct local invocation:

```bash
node skills/au.com.polyaire.airtouch5.set-mode/scripts/run.js <device_serial> --mode auto
```
