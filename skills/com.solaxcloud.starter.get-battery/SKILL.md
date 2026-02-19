---
name: com.solaxcloud.starter.get-battery
description: Read current battery percentage from SolaX Cloud Android app (com.solaxcloud.starter) via ActionTask generic agent actions. Use when asked for current home battery level.
---

Use a fresh app session (script closes then re-opens app) for reliability.

Run:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.solaxcloud.starter.get-battery/scripts/get_solax_battery.sh
```

Expected output:

- `✅ SolaX battery level: <value>%`

If parse fails, inspect recent `cmd-solax-battery-*` logs and report the latest `read-battery-value` and `read-battery-unit` values.

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
