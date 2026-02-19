---
name: com.google.android.apps.chromecast.app.set-aircon
description: Precheck and verify Google Home air conditioner ON/OFF state from ActionTask. Local debug wrapper does not perform state-changing action.
---

Use the skill-local script:

```bash
cd "$(git rev-parse --show-toplevel)"
AC_TILE_NAME="YOUR_AC_TILE_NAME" ./skills/com.google.android.apps.chromecast.app.set-aircon/scripts/set_aircon.sh on
```

Or set OFF:

```bash
./skills/com.google.android.apps.chromecast.app.set-aircon/scripts/set_aircon.sh off
```

Current behavior:
- local debug broadcast path does not expose semantic `ac:on/ac:off` directly.
- this script reports current state and whether a change is required; apply actual state-changing commands through the production command pipeline, then verify with `com.google.android.apps.chromecast.app.get-aircon-status`.

Return both:
1. requested state
2. observed state

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
