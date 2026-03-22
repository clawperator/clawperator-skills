---
name: com.google.android.apps.chromecast.app.set-aircon
description: Precheck and verify Google Home air conditioner ON/OFF state from ActionTask. Local debug wrapper does not perform state-changing action.
---

Use the skill-local script:

```bash
cd "$(git rev-parse --show-toplevel)"
DEVICE_ID=<device_id> AC_TILE_NAME="YOUR_AC_TILE_NAME" ./skills/com.google.android.apps.chromecast.app.set-aircon/scripts/set_aircon.sh on
```

Or set OFF:

```bash
DEVICE_ID=<device_id> AC_TILE_NAME="YOUR_AC_TILE_NAME" ./skills/com.google.android.apps.chromecast.app.set-aircon/scripts/set_aircon.sh off
```

The script also accepts forwarded args from `clawperator skills run`; use the
direct invocation above if your local CLI does not forward the state token in
the expected order.

If you are not given an aircon tile name, inspect the Google Home UI first,
take a snapshot, and infer the most likely visible tile label before calling
this skill. The agent should use the UI structure to make its best guess rather
than treating the missing name as a hard stop.

Current behavior:
- local debug broadcast path does not expose semantic `ac:on/ac:off` directly.
- this script reports current state and whether a change is required; apply actual state-changing commands through the production command pipeline, then verify with `com.google.android.apps.chromecast.app.get-aircon-status`.
- the child status check inherits `CLAWPERATOR_RECEIVER_PACKAGE`, so use `com.clawperator.operator.dev` for local debug APKs.

Terminal output:
- a single `✅` summary line with requested and observed state

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
