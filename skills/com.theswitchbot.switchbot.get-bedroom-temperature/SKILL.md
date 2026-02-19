---
name: com.theswitchbot.switchbot.get-bedroom-temperature
description: Read bedroom temperature from SwitchBot on Android via ActionTask generic agent actions. Use when asked for current bedroom temperature.
---

Use the skill-local script:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.theswitchbot.switchbot.get-bedroom-temperature/scripts/get_bedroom_temperature.sh
```

Expected output:

- `✅ Bedroom temperature: <value>`

If parse fails, inspect recent `cmd-bedroom-temp-*` logs and report the latest `read` step text value.

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
