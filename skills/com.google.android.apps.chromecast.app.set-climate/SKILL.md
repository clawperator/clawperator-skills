---
name: com.google.android.apps.chromecast.app.set-climate
description: Precheck and verify Google Home HVAC unit ON/OFF state from ActionTask. Local debug wrapper does not perform state-changing action.
---

Use the skill-local script:

```bash
cd "$(git rev-parse --show-toplevel)"
DEVICE_ID=<device_id> CLIMATE_TILE_NAME="YOUR_TILE_NAME" ./skills/com.google.android.apps.chromecast.app.set-climate/scripts/set_climate.sh on
```

Or set OFF:

```bash
DEVICE_ID=<device_id> CLIMATE_TILE_NAME="YOUR_TILE_NAME" ./skills/com.google.android.apps.chromecast.app.set-climate/scripts/set_climate.sh off
```

The script also accepts forwarded args from `clawperator skills run`; use the
direct invocation above if your local CLI does not forward the state token in
the expected order.

If you are not given a tile name, inspect the Google Home UI first, take a
snapshot, and infer the most likely visible tile label before calling this
skill. The agent should use the UI structure to make its best guess rather than
treating the missing name as a hard stop.

Current behavior:
- local debug broadcast path does not expose semantic `ac:on/ac:off` directly.
- this script reports current state and whether a change is required; apply actual state-changing commands through the production command pipeline, then verify with the companion status skill.
- the child status check inherits `CLAWPERATOR_OPERATOR_PACKAGE`, so use `com.clawperator.operator.dev` for local debug APKs.

Terminal output:
- a single `✅` summary line with requested and observed state

Prerequisite:
- Ensure `adb` is installed and available on `PATH`.
