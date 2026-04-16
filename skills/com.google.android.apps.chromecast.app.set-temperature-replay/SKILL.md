---
name: com.google.android.apps.chromecast.app.set-temperature-replay
clawperator-skill-type: replay
description: |-
  Replay baseline skill for setting a Google Home climate unit temperature.
---

Replay baseline skill for setting a named climate unit set temperature in the Google Home Android app.

Arguments:

- named wrapper arg: `--temperature <integer>`
- named wrapper arg: `--unit-name "<label>"`
- the replay script also accepts the legacy positional target temperature form after the device id

Declared contract inputs:

- `temperature`
- `unit_name`
- the skill verifies the visible setpoint in Google Home after the last adjustment tap

Current behavior:

- opens Google Home from a fresh app session
- scrolls to the `Climate` chip if needed
- scrolls to the requested climate tile and long-presses it to open the controller
- verifies the opened controller title matches the requested unit label
- reads the current visible set temperature from `com.google.android.apps.chromecast.app:id/low_value`
- clicks `Increase temperature` or `Decrease temperature` until the requested setpoint is reached
- re-reads the visible setpoint after each change attempt
- handles the Google Home climate controller's `0.5` degree intermediate values during replay verification
- emits exactly one terminal `[Clawperator-Skill-Result]` frame with `contractVersion: "1.0.0"`
- omits `source` from the emitted frame; `runSkill` injects `source: { "kind": "script" }`
- uses terminal verification only when the visible setpoint matches the requested integer

Known caveats:

- this replay depends on the current Google Home layout and the provided unit label remaining stable
- the recording captured several generic scroll events before entering Climate; this replay replaces those with explicit `scroll_and_click` navigation rather than replaying raw scroll timing
- this skill proves the controller setpoint shown in Google Home, not the physical room temperature
- this first pass assumes the named climate unit is already available in Google Home and reachable from the Home tab
- this first pass does not explicitly toggle the power button; it verifies the target setpoint on the controller screen

Run through the wrapper:

```bash
clawperator skills run com.google.android.apps.chromecast.app.set-temperature-replay --device <device_serial> -- --temperature 23 --unit-name "Living Room AC"
```

Direct local invocation:

```bash
node skills/com.google.android.apps.chromecast.app.set-temperature-replay/scripts/run.js <device_serial> --temperature 23 --unit-name "Living Room AC"
```

## Recording Context

This skill was scaffolded with recording context at `recording-context.json`.
Read that file to inspect the recorded interaction timeline and raw events.
The recording context is reference evidence, not an executable skill recipe.
An external agent or human author must write the reusable skill logic.

Usage:

```bash
node skills/com.google.android.apps.chromecast.app.set-temperature-replay/scripts/run.js <device_id> --temperature <integer> --unit-name "<label>"
```
