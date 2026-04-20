---
name: com.solaxcloud.starter.get-battery
clawperator-skill-type: replay
description: Read current battery percentage from SolaX Cloud Android app (com.solaxcloud.starter) via ActionTask generic agent actions. Use when asked for current home battery level.
---

Use a fresh app session (script closes then re-opens app) for reliability.

Arguments:

- required positional arg: `<device_id>`
- optional positional arg: `[operator_package]`
- direct script invocation also accepts `DEVICE_ID=<device_id>` from the environment, but the wrapper example below passes the device id explicitly and that is the preferred usage when multiple Android targets may be connected

Run through the wrapper:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.sh <device_serial>
```

Optional operator package override:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.sh <device_serial> com.clawperator.operator.dev
```

Direct local invocation:

```bash
node skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.js <device_serial> [operator_package]
```

Expected output:

- `✅ SolaX battery level: <value>%`

If parse fails, inspect recent `cmd-solax-battery-*` logs and report the latest `read-battery-value` and `read-battery-unit` values.

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
