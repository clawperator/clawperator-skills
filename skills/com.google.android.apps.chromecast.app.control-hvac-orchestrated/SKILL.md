---
name: com.google.android.apps.chromecast.app.control-hvac-orchestrated
clawperator-skill-type: orchestrated
description: |-
  Agent-driven Google Home HVAC controller for one named climate action per run.
---

Runtime program for an assisted orchestrated Google Home HVAC skill.

This first pass is intentionally one action per run. The runtime contract is:

- `--action <temperature|mode|fan_speed|climate_state>`
- `--value <target>`
- `--unit-name "<label>"`

This pass is assisted from nearby patterns, not from-scratch only:

- the retained recording is the main route evidence for controller entry,
  temperature adjustment, mode-sheet entry, and fan-speed-sheet entry
- the existing replay siblings informed nearby naming and the fresh-session
  verification pattern
- power verification specifically reuses the same fresh-session reread idea as
  the replay power skill because this recording did not include an on/off tap

Truthfulness boundary:

- this skill is somewhat generic across Google Home HVAC units that expose the
  same controller structure
- this pass does not claim every Google Home climate device has identical mode
  names, fan-speed options, or controller layout
- this pass supports power control as an assisted nearby-pattern branch even
  though the retained recording did not itself include a power-button action

The currently supported runtime agent is `codex`. This skill runs through
Codex with `danger-full-access` sandbox posture so the runtime agent can reach
the live adb target through the local Clawperator CLI.

Immediate execution rules:

- Do not summarize the plan. Start with a real Clawperator CLI command.
- Stay inside `com.google.android.apps.chromecast.app`.
- Do not open launcher search, the Google app, Assistant, Chrome, Settings, or
  any unrelated app.
- Use one live device command at a time.
- Do not use `skills install`, `skills list`, `skills get`, or any other local
  skills-store management command during a live run.
- Do not call `clawperator skills run` from inside this skill. That would
  recurse back into the wrapper instead of operating the device.
- Do not run `clawperator --help`, `clawperator exec --help`, or any other help
  or introspection command during a live run.
- Do not run `clawperator exec ... --validate-only` during a live run.
- Do not use `exec best-effort`.
- Do not use the flat `wait` command for this skill. Use bounded `exec`
  payloads with `wait_for_node` instead.
- Do not emit a final success result unless terminal verification came from a
  fresh-session reread of the Google Home controller state.
- If the visible UI differs materially from this route, fail or mark the run
  indeterminate truthfully instead of improvising a different product journey.

Inputs:

- raw argv passed through by `clawperator skills run`
- `clawperator skills run` provides the selected device as
  `CLAWPERATOR_DEVICE_ID`
- canonical invocation shape:
  `clawperator skills run com.google.android.apps.chromecast.app.control-hvac-orchestrated --device <device_serial> -- --action temperature --value 24 --unit-name "Panasonic"`
- valid actions:
  - `temperature`
  - `mode`
  - `fan_speed`
  - `climate_state`

Runtime contract:

- emit `goal: { "kind": "control_hvac", "action": <action>, "value": <value>, "unit_name": <unit_name> }`
- emit `inputs: { "action": <action>, "value": <value>, "unit_name": <unit_name> }`
- preserve this checkpoint subset in this exact order:
  - `app_opened`
  - `controller_opened`
  - `current_state_read`
  - `action_applied`
  - `terminal_state_verified`
- each checkpoint must include both `id` and `status`
- checkpoint `status` must be one of `ok`, `failed`, `skipped`
- terminalVerification `status` must be one of `verified`, `failed`, `not_run`
- do not emit `source`; Clawperator injects it from `skill.json`
- emit exactly one terminal `[Clawperator-Skill-Result]` frame on stdout

Recorded route and nearby-pattern route:

1. Open Google Home from a fresh app session.
2. Ensure the `Home` tab is active.
3. Scroll horizontally to the `Climate` chip if needed.
4. Scroll to the requested climate tile and long-press it to open the
   controller.
5. Verify the controller toolbar title exactly matches `unit_name`.
6. Read the current state for the requested action before changing anything.
7. Apply exactly one requested action.
8. Close and reopen Google Home, reopen the same controller, and reread the
   resulting state for terminal verification.

Action branches:

- `temperature`
  - read `resourceId=com.google.android.apps.chromecast.app:id/low_value`
  - if the visible setpoint already matches the requested integer, treat the
    action step as a no-op but still do the fresh-session reread for proof
  - otherwise use `Increase temperature` or `Decrease temperature` until the
    requested integer is reached
  - reread `low_value` after each adjustment attempt instead of assuming a tap
    landed
- `mode`
  - read the current mode from the `Mode` action tile
  - click the `Mode ...` tile
  - wait for the `Select a mode` sheet
  - choose the requested visible mode label
  - wait until the controller view is back before moving on
- `fan_speed`
  - read the current fan speed from the `Fan speed` action tile
  - click the `Fan speed ...` tile
  - wait for the `Fan speed` pop-up
  - in the bottom sheet, choose the requested visible option label exactly as
    rendered there; on the proving device this sheet uses lowercase labels such
    as `auto`, `high`, `low`, and `med`
  - wait until the controller view is back before moving on
- `climate_state`
  - read the current state before acting
  - interpret a numeric `low_value` as powered `on`
  - interpret literal `Off` as powered `off`
  - only click the power button when the current state differs from the
    requested state
  - emit normalized terminal verification text as lowercase `on` or `off` so
    it stays aligned with the declared `value` input
  - use the fresh-session reread as the only trustworthy terminal proof, just
    like the replay power sibling

Navigation policy:

- the only allowed Google Home path is the recorded `Home -> Climate -> named
  tile -> long press controller` route
- do not explore Favorites, Devices, Activity, Settings, or device settings as
  part of this run
- if the controller title does not match the requested unit label after open,
  fail truthfully instead of applying the action to a different unit

Verification policy:

- terminal verification must come from a fresh-session reread
- for `temperature`, verify the reopened controller `low_value`
- for `mode`, verify the reopened `Mode` action tile body text
- for `fan_speed`, verify the reopened `Fan speed` action tile body text
- for `climate_state`, verify the reopened normalized lowercase power state
  from `low_value`
- do not trust the immediate in-place controller after a change as final proof

Execution templates:

- prefer the exact `exec --execution` route shown in the harness prompt over
  inventing new exploratory commands
- for `temperature`, use a bounded controller-entry exec, then a bounded
  read-current-temperature exec, then one or more bounded adjustment execs, and
  finally a fresh-session reread exec
- for `fan_speed`, use a bounded controller-entry exec, then a bounded
  read-current-fan-speed exec, then a bounded open-sheet-and-click-option exec,
  and finally a fresh-session reread exec

Known caveats:

- this first pass assumes the named climate unit is reachable from the Google
  Home `Home` tab under `Climate`
- power support is informed by the replay sibling because the retained
  recording did not include a power-button tap
- mode and fan-speed option labels are device-specific and must match the
  visible option text
- this skill proves the state visible in Google Home, not the physical HVAC
  hardware response

Debugging support:

- the harness writes a per-run prompt file, agent stdout log, agent stderr log,
  and metadata file into a temporary run directory
- set `CLAWPERATOR_SKILL_RETAIN_LOGS=1` to keep those artifacts after a
  successful run
- set `CLAWPERATOR_SKILL_DEBUG=1` to also stream agent stdout to stderr while
  retaining the run directory
- set `CLAWPERATOR_SKILL_LOG_DIR=<dir>` to place retained run directories under
  a predictable parent path during local debugging

Emission rules:

- no extra prose after the final frame
- the final non-empty stdout suffix must be:
  1. `[Clawperator-Skill-Result]`
  2. one JSON object line containing the emitted `SkillResult`
- the emitted `SkillResult` must include `result` before `status`; use an
  evidence-shaped JSON result for a confirmed final state and `result: null`
  when no truthful final state is available

Recording note:

- `recording-context.json` and `references/compare-baseline.export.json` are
  authoring and compare evidence only
- they are not runtime inputs to this skill
