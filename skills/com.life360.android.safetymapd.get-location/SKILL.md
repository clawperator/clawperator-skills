---
name: com.life360.android.safetymapd.get-location
description: Get a family member's current location details from the Life360 Android app.
---

Looks up a person's location in Life360 by name and returns all readable details from their profile/location screen.
If no name is passed, the script uses the generic placeholder `Person` (recommended usage is to always pass `<person_name>` explicitly).

Run:

```bash
cd "$(git rev-parse --show-toplevel)"
./skills/com.life360.android.safetymapd.get-location/scripts/get_life360_location.sh
```

Optional args:

```bash
./skills/com.life360.android.safetymapd.get-location/scripts/get_life360_location.sh \
  app.actiontask.operator.development "<person_name>"
```

Optional env vars:

- `ADB_SERIAL=<device_id>` when multiple devices are connected.
- `RETURN_SCREENSHOT=1` to capture and return a PNG of the final person/location view.
- `SCREENSHOT_DIR=/absolute/path` to control where the PNG is saved (default: `/tmp/life360-screenshots`).
- `OVERLAY_CLOSE_TAP_X=<x>` and `OVERLAY_CLOSE_TAP_Y=<y>` to override fallback tap coordinates for dismissing close-icon overlays (defaults: `1000`, `300`).

Notes:

- Detects the known Life360 permission warning and dismisses it with Hardware Back only when that dialog is present.
- If direct click-by-name fails, it iterates visible member cards and matches by detail-screen name.
- Attempts to clear blocking Life360 overlays (permissions/battery optimization prompts) before screenshot capture.

Output format:

- `SEARCH|app=com.life360.android.safetymapd|person=<name>|status=found`
- `DETAIL|title=<...>|name=<...>|place=<...>|battery=<...>|last_updated=<...>`
- `DETAIL_EXTRA|<additional observed detail line>`
- `SCREENSHOT|path=<absolute_file_path>` (only when `RETURN_SCREENSHOT=1`)
- `SCREENSHOT_NOTE|captured_on=map_overview_before_detail_to_avoid_permissions_overlay` (when detail view warning could not be cleared)

Security and privacy:

- Output may include sensitive location and presence data. Treat all output as confidential.
- Avoid storing or forwarding raw output to shared or long-retention systems unless required.
- If persistence is required, apply least-privilege access controls and redact identifying fields where feasible.
- Use this skill only in contexts where user consent and applicable privacy requirements are satisfied.
