---
name: au.com.polyaire.airtouch5.set-power-state
clawperator-skill-type: replay
description: |-
  Set the AirTouch 5 system power state to on or off from the Home screen.
---

Deterministic AirTouch 5 skill for setting whole-system power to `on` or `off`.

Arguments:

- named wrapper arg: `--state <on|off>`
- legacy positional form after the device id also works: `on` or `off`

Declared contract inputs:

- `state`

Current behavior:

- opens `au.com.polyaire.airtouch5`
- waits for the `Home` surface to stabilize
- derives the power button hitbox from the live Home layout, with a geometry fallback when the WebView exposes fewer semantics than usual
- infers current power from the average color of a screenshot crop over the power control
- taps the power control only when the inferred state differs from the requested state
- emits exactly one terminal `[Clawperator-Skill-Result]` frame with `contractVersion: "1.0.0"`
- omits `source` from the emitted frame; `runSkill` injects `source: { "kind": "script" }`

Known caveats:

- verification is heuristic because the AirTouch Home power button does not expose a semantic on/off value through the WebView tree
- the skill classifies the power button from screenshot color metrics instead of a semantic WebView state
- if the Home layout changes materially, the geometry fallback may need to be updated

Run through the wrapper:

```bash
clawperator skills run au.com.polyaire.airtouch5.set-power-state --device <device_serial> --operator-package <operator_package> -- --state on
```

Direct local invocation:

```bash
node skills/au.com.polyaire.airtouch5.set-power-state/scripts/run.js <device_serial> --state off
```
