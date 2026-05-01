---
name: au.com.polyaire.airtouch5.set-home-controls
clawperator-skill-type: replay
description: |-
  Set one or more AirTouch 5 Home-screen controls in a single run.
---

Deterministic AirTouch 5 skill for applying multiple Home-screen controls after
opening AirTouch once.

Arguments:

- optional named wrapper arg: `--state <on|off>`
- optional named wrapper arg: `--fan-level <auto|low|medium|high>`
- optional named wrapper arg: `--mode <cool|heat|fan|dry|auto>`

At least one argument is required. Use canonical values only; wrapper layers may
map natural language such as "highest" to `--fan-level high`.

Declared contract inputs:

- `state`
- `fan_level`
- `mode`

Current behavior:

- opens `au.com.polyaire.airtouch5` once
- waits for the `Home` surface to stabilize
- when `--state on` is combined with `--fan-level` or `--mode`, turns power on first and then verifies live Home controls are visible
- rejects `--state off` when combined with `--fan-level` or `--mode`, because those controls are not safely adjustable while power is off
- derives Home control hitboxes from the live Home geometry
- uses the same selector dialog flow as the single-purpose fan and mode skills
- uses the same screenshot crop power classification as the single-purpose power skill
- emits exactly one terminal `[Clawperator-Skill-Result]` frame with `contractVersion: "1.0.0"`
- verifies every requested field before returning success
- omits `source` from the emitted frame; `runSkill` injects `source: { "kind": "script" }`

Known caveats:

- power verification is heuristic because the AirTouch Home power button does not expose a semantic on/off value through the WebView tree
- mode and fan verification is snapshot-text-based because the AirTouch WebView does not expose separate semantic values for those controls
- if the Home layout changes materially, the geometry fallback may need to be updated

Run through the wrapper:

```bash
clawperator skills run au.com.polyaire.airtouch5.set-home-controls --device <device_serial> --operator-package <operator_package> -- --state on --fan-level high
```

Direct local invocation:

```bash
node skills/au.com.polyaire.airtouch5.set-home-controls/scripts/run.js <device_serial> --state on --mode cool --fan-level high
```
