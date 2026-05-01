# AirTouch 5 Home Controls Notes

This note captures implementation context for
`au.com.polyaire.airtouch5.set-home-controls` and the shared AirTouch Home
helpers. It is maintainer context, not part of the runtime contract.

## Skill Shape

The compound Home-controls skill exists so a caller can satisfy requests such as
"turn on the a/c at the highest fan speed" with one Clawperator skill run. The
shared runtime skill intentionally accepts only canonical values:

- `--state on|off`
- `--mode cool|heat|fan|dry|auto`
- `--fan-level auto|low|medium|high`

Natural-language aliases such as `fast` or `highest` belong in a personal or
agent wrapper, not in this shared skill. For example, wrappers may map
"highest" to `--fan-level high`.

The script must handle any subset of those arguments, including only one or two
fields. It must fail before opening the app when no Home-control field is
requested, when an unknown or duplicate argument is passed, or when a
combination cannot be proved safely.

## Shared AirTouch Helpers

Most behavior lives in `skills/utils/airtouch5_home_controls.js` so the
single-purpose AirTouch skills and this compound skill share the same lower
level behavior:

- `au.com.polyaire.airtouch5.set-power-state`
- `au.com.polyaire.airtouch5.set-mode`
- `au.com.polyaire.airtouch5.set-fan-level`
- `au.com.polyaire.airtouch5.set-home-controls`

Changes to Home control detection, selector handling, power classification, or
Clawperator command invocation can affect all of those skills. In particular,
power-classification fixes also apply to `set-power-state`.

## Home Screen Model

AirTouch 5 renders the relevant controls in a WebView. The Home screen provides
enough text to verify mode and fan values, but the power tile does not expose a
semantic on/off value. The helper therefore combines:

- snapshot text and geometry for mode and fan controls
- a screenshot crop around the Home power tile for power state
- Home-control text as diagnostics only, not as a substitute for visual power
  proof

The power crop classifier is heuristic. A successful run is stronger than simple
process success because it requires terminal verification, but power proof is
still visual classification rather than a true semantic app state.

## Ordering And Unsafe Combinations

When `--state on` is combined with mode or fan changes, power is handled first.
The skill then re-observes the Home screen and requires visible Home controls
before touching mode or fan.

`--state off` must not be combined with mode or fan. Turning power off hides or
changes the controls needed for deterministic verification.

`--mode dry` must not be combined with `--fan-level`. Dry mode does not expose a
fan-level value on the AirTouch Home screen, so the shared skill cannot prove
the requested fan level after changing mode.

Fan mode can expose fan-level controls while looking visually different from
cool/heat modes. Do not treat the absence of Set Point by itself as proof that
power is off.

## Power Toggling

Do not retry the power toggle automatically. Power is a toggle control, so a
second tap can undo the first tap if the first command succeeded but observation
lagged. The current helper records the mutation start, performs at most one
power tap, then observes and either verifies or fails clearly.

This rule is important for both the compound skill and
`au.com.polyaire.airtouch5.set-power-state`.

## Clawperator Command Routing

The AirTouch helpers add a longer Clawperator command timeout for direct
commands. The timeout is a Clawperator global flag, so
`skills/utils/common.js` hoists `--timeout` and `--timeout-ms` before the
subcommand when invoking the CLI.

Do not force `--no-daemon` in the AirTouch helper by default. During live
testing, the normal serialized Clawperator route was more reliable for selector
taps than forced direct execution.

The runtime may pass the selected device both through environment and as a
leading positional script argument. The compound skill's `scripts/run.js` strips
that runtime device token before parsing user Home-control arguments. This is
why the strict parser can reject stray positional user values without rejecting
the runtime wrapper itself.

## Live Validation

Use the committed live validator when changing selectors, Home control geometry,
power proof, or command routing:

```bash
CLAWPERATOR_SKILLS_REGISTRY=skills/skills-registry.json \
  node skills/au.com.polyaire.airtouch5.set-home-controls/scripts/validate_live.js \
  --device <device_serial>
```

The validator intentionally accepts a device id rather than hardcoding one. It
runs these transition checks:

- precondition to Fan/Medium
- Fan/on -> Cool/High
- Cool/High -> Dry
- Dry -> Cool/High
- Cool/High -> Fan/Medium
- return to Cool/High

It retries only runtime failures that happen before a mutation checkpoint. Once
the skill has started a mode, fan, or real power mutation, the validator does
not mask the result with a blind retry.

Transient Clawperator transport failures can still appear on physical devices.
Before live validation, it can help to stop any stale daemon for the target
device:

```bash
clawperator daemon stop --device <device_serial> --output json
```

## Validation Checklist

For non-trivial changes in this area, run:

```bash
./scripts/test_all.sh
CLAWPERATOR_SKILLS_REGISTRY=skills/skills-registry.json \
  clawperator skills validate au.com.polyaire.airtouch5.set-home-controls --dry-run
find skills -type f -path '*/scripts/*.sh' -print0 | xargs -0 -n1 bash -n
find scripts -maxdepth 1 -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
```

Run `scripts/validate_live.js` on a physical device whenever behavior affects
selectors, navigation, power classification, command routing, or terminal
verification.
