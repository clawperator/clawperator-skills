---
name: com.globird.energy.get-usage
clawperator-skill-type: replay
description: Read GloBird energy usage summary from Android app (com.globird.energy), including Cost So Far, right-side summary value (Avg Cost Per Day where available), and Yesterday usage details when present.
---

Use a fresh app session (script closes then re-opens app) for reliability.

Arguments:

- required positional arg: `<device_id>`
- optional positional arg: `[operator_package]`
- direct script invocation also accepts `DEVICE_ID=<device_id>` from the environment, but the wrapper example below passes the device id explicitly and that is the preferred usage when multiple Android targets may be connected

Run through the wrapper:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.globird.energy.get-usage/scripts/get_globird_usage.sh <device_serial>
```

Optional operator package override:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.globird.energy.get-usage/scripts/get_globird_usage.sh <device_serial> com.clawperator.operator.dev
```

Direct local invocation:

```bash
node skills/com.globird.energy.get-usage/scripts/get_globird_usage.js <device_serial> [operator_package]
```

Expected output lines:

- `GloBird usage: cost_so_far=..., avg_cost_per_day=..., grid_usage=..., solar_feed_in=...`
- `Yesterday: cost=..., net_usage_kwh=...` (when present)

Notes:
- UI copy can vary by app version (e.g. right-side stat may be Avg Cost Per Day or Number Of Days).
- If Yesterday is not present in current view, return partial results and state that explicitly.
- Ensure `adb` is installed and available on `PATH`.
