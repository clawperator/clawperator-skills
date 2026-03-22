---
name: com.google.android.apps.chromecast.app.get-aircon-status
description: Read Google Home air conditioner status (power/mode/indoor temp) on Android using ActionTask generic agent actions. Use when asked for current aircon status.
---

Use the skill-local script:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.google.android.apps.chromecast.app.get-aircon-status/scripts/get_aircon_status.sh <device_id> "YOUR_AC_TILE_NAME"
```

Optional receiver package:

```bash
./skills/com.google.android.apps.chromecast.app.get-aircon-status/scripts/get_aircon_status.sh <device_id> "YOUR_AC_TILE_NAME" com.clawperator.operator.dev
```

Expected output:

`AC status (...): power=<...>, mode=<...>, indoor_temp=<...>`

The script also respects `CLAWPERATOR_RECEIVER_PACKAGE` when called through
`clawperator skills run`.

If you are not given an aircon tile name, inspect the Google Home UI first,
take a snapshot, and infer the most likely visible tile label before calling
this skill. The skill is meant to report structured UI state, so an agent can
use the snapshot to discover the name rather than failing immediately.

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
