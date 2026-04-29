---
name: com.eco.global.app.control-home-robot-vacuum-orchestrated
clawperator-skill-type: orchestrated
description: |-
  Agent-driven Ecovacs home robot vacuum control skill for reading the
  current state, including Offline, or sending Start, Pause, or Docking
  actions from the main robot surface.
---

# Control Home Robot Vacuum

Runtime program for the Ecovacs home robot vacuum surface. It can both get the
current robot state and control the robot from the live main surface.

This skill is intentionally narrow:

- it stays on `com.eco.global.app`
- it uses the live home surface only
- it infers robot state from the left action label
- it supports one requested action per run

Supported input:

- `--action <get_state|start|pause|return_to_dock>`

State model inferred from the UI:

- if the left button says `Start`, the robot is paused
- if the left button says `Pause`, the robot is running
- if the top status says `Offline` or the screen shows `Why is my device offline`, the robot is offline
- the right button says `Docking`
- the top bar battery text shows the current charge percentage

Behavior:

1. Open Ecovacs from a fresh app session.
2. Wait for the main robot surface to appear.
3. Read the visible action labels from the live UI.
4. If the action is `get_state`, return the inferred state and battery percentage without tapping.
5. If the action is `start`, control the robot by tapping `Start` only when
   the robot is paused.
6. If the action is `pause`, control the robot by tapping `Pause` only when
   the robot is running.
7. If the action is `return_to_dock`, tap `Docking` and reread the visible UI.
8. Use the live UI reread as the proof source for the final result.
9. If the robot is offline, report the offline state and do not attempt a control tap.

Verification notes:

- `get_state` verifies the visible button label and battery percentage without changing the app state
- `start` verifies the left label changes to `Pause`
- `pause` verifies the left label changes to `Start`
- `offline` is reported as a read-only error state with the current battery percentage when visible
- `return_to_dock` verifies the live UI reread after tapping `Docking`
- the app does not expose a separate dock-complete flag, so the runtime result
  reports the observed UI state rather than claiming physical dock completion

Examples:

```bash
clawperator skills run com.eco.global.app.control-home-robot-vacuum-orchestrated \
  --device <device_serial> \
  -- \
  --action get_state
```

```bash
clawperator skills run com.eco.global.app.control-home-robot-vacuum-orchestrated \
  --device <device_serial> \
  -- \
  --action start
```

```bash
clawperator skills run com.eco.global.app.control-home-robot-vacuum-orchestrated \
  --device <device_serial> \
  -- \
  --action pause
```

```bash
clawperator skills run com.eco.global.app.control-home-robot-vacuum-orchestrated \
  --device <device_serial> \
  -- \
  --action return_to_dock
```
