---
name: com.globird.energy.get-usage
clawperator-skill-type: replay
description: Read GloBird energy usage summary from Android app (com.globird.energy), including Cost So Far, right-side summary value (Avg Cost Per Day where available), and Yesterday usage details when present.
---

Use a fresh app session (script closes then re-opens app) for reliability.

Arguments:

- required positional arg: `<device_id>`
- optional positional arg: `[operator_package]`
- the public examples below pass the device id explicitly and stay on the default release operator package path

Run through the wrapper:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.globird.energy.get-usage/scripts/get_globird_usage.sh <device_id>
```

Direct local invocation:

```bash
node skills/com.globird.energy.get-usage/scripts/get_globird_usage.js <device_id> [operator_package]
```

Expected output lines:

- `GloBird usage: cost_so_far=..., avg_cost_per_day=..., grid_usage=..., solar_feed_in=...`
- `Yesterday: cost=..., net_usage_kwh=...` (when present)

Notes:
- UI copy can vary by app version (e.g. right-side stat may be Avg Cost Per Day or Number Of Days).
- If Yesterday is not present in current view, return partial results and state that explicitly.
- Ensure `adb` is installed and available on `PATH`.
