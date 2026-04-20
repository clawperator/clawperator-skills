---
name: com.solaxcloud.starter.get-battery
clawperator-skill-type: replay
description: Read current battery percentage from SolaX Cloud Android app (com.solaxcloud.starter) via ActionTask generic agent actions. Use when asked for current home battery level.
---

Use a fresh app session (script closes then re-opens app) for reliability.

Arguments:

- required positional arg: `<device_id>`
- optional positional arg: `[operator_package]`
- direct script invocation also accepts `DEVICE_ID=<device_id>` from the environment, but the wrapper examples below pass the device id explicitly and that is the preferred usage when multiple Android targets may be connected
- if `DEVICE_ID` is provided via the environment and you also need to override the operator package, use `CLAWPERATOR_OPERATOR_PACKAGE=<operator_package>` rather than passing the operator package as the first positional argument

Run through the wrapper:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.sh <device_id>
```

Optional operator package override:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.sh <device_id> com.clawperator.operator.dev
```

Direct local invocation:

```bash
node skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.js <device_id> [operator_package]
```

Direct local invocation with environment overrides:

```bash
DEVICE_ID=<device_id> CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev \
node skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.js
```

Expected output:

- `✅ SolaX battery level: <value>%`

If parse fails, inspect recent `cmd-solax-battery-*` logs and report the latest `read-battery-value` and `read-battery-unit` values.

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
