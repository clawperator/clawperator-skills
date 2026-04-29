---
name: com.eco.global.app.home-robot-vacuum-orchestrated
clawperator-skill-type: orchestrated
description: |-
  Agent-driven Ecovacs home robot vacuum controller for reading state or
  sending Start, Pause, or Docking actions from the main robot surface.
---

Runtime program for the Ecovacs home robot vacuum surface.

This skill is intentionally narrow:

- it stays on `com.eco.global.app`
- it uses the live home surface only
- it infers robot state from the left action label
- it supports one requested action per run

Supported input:

- `--action <get_state|start|pause|return_to_dock>`

State model inferred from the UI:

- if the left button says `Start`, the robot is paused
- if the left button says `Pause`, the robot is operating
- the right button says `Docking`

Behavior:

1. Open Ecovacs from a fresh app session.
2. Wait for the main robot surface to appear.
3. Read the visible action labels from the live UI.
4. If the action is `get_state`, return the inferred state without tapping.
5. If the action is `start`, tap `Start` only when the robot is paused.
6. If the action is `pause`, tap `Pause` only when the robot is operating.
7. If the action is `return_to_dock`, tap `Docking` and reread the visible UI.
8. Use the live UI reread as the proof source for the final result.

Verification notes:

- `get_state` verifies the visible button label without changing the app state
- `start` verifies the left label changes to `Pause`
- `pause` verifies the left label changes to `Start`
- `return_to_dock` verifies the live UI reread after tapping `Docking`
- the app does not expose a separate dock-complete flag, so the runtime result
  reports the observed UI state rather than claiming physical dock completion

Examples:

```bash
clawperator skills run com.eco.global.app.home-robot-vacuum-orchestrated \
  --device <device_serial> \
  -- \
  --action get_state
```

```bash
clawperator skills run com.eco.global.app.home-robot-vacuum-orchestrated \
  --device <device_serial> \
  -- \
  --action start
```

```bash
clawperator skills run com.eco.global.app.home-robot-vacuum-orchestrated \
  --device <device_serial> \
  -- \
  --action pause
```

```bash
clawperator skills run com.eco.global.app.home-robot-vacuum-orchestrated \
  --device <device_serial> \
  -- \
  --action return_to_dock
```
