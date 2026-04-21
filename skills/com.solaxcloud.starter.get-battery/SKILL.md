---
name: com.solaxcloud.starter.get-battery
clawperator-skill-type: replay
description: Read current battery percentage from SolaX Cloud Android app (com.solaxcloud.starter) via ActionTask generic agent actions. Use when asked for current home battery level.
---

Use a fresh app session (script closes then re-opens app) for reliability.

Arguments:

- required positional arg: `<device_id>`
- optional positional arg: `[operator_package]`
- the public examples below pass the device id explicitly and stay on the default release operator package path

Run through the wrapper:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.sh <device_id>
```

Direct local invocation:

```bash
node skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.js <device_id> [operator_package]
```

Expected output:

- `✅ SolaX battery level: <value>%`
- a terminal `[Clawperator-Skill-Result]` frame with the parsed battery level in `result`

If parse fails, the skill emits a failed terminal `SkillResult` and reports the latest `read-battery-value` and `read-battery-unit` values in diagnostics.

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
