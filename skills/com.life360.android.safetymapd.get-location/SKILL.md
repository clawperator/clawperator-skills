---
name: com.life360.android.safetymapd.get-location
clawperator-skill-type: replay
description: Get a family member's current location details from the Life360 Android app.
---

Looks up a person's location in Life360 by name and returns all readable details from their profile/location screen.
If no name is passed, the script uses the generic placeholder `Person` (recommended usage is to always pass `<person_name>` explicitly).

**Prerequisites:** Life360 must be signed in, the target member must be visible on the current map (or reachable within the first scrolls), and `<person_name>` should match a visible on-screen label. With `clawperator skills run`, pass the name as a trailing script argument. Framed `status: "failed"` and `result: null` is expected if no member label matches (not a contract bug).

Run:

```bash
cd "$(git rev-parse --show-toplevel)"
DEVICE_ID=<device_id> PERSON_NAME="<person_name>" ./skills/com.life360.android.safetymapd.get-location/scripts/get_life360_location.sh
```

Optional env vars:

- `DEVICE_ID=<device_id>` when invoking the script directly.
- `ADB_SERIAL=<device_id>` when multiple devices are connected.
- `CLAWPERATOR_OPERATOR_PACKAGE=<package>` to override the operator package.

Notes:

- Detects the known Life360 permission warning and dismisses it with Hardware Back only when that dialog is present.
- If direct click-by-name fails, it scans visible member cards case-insensitively and clicks the exact visible label without rewriting the caller's casing.
- Attempts to clear blocking Life360 overlays (permissions/battery optimization prompts) before screenshot capture.

Output format:

- `✅ Life360 location for <name>: place=<...>, battery=<...>`

Security and privacy:

- Output may include sensitive location and presence data. Treat all output as confidential.
- Avoid storing or forwarding raw output to shared or long-retention systems unless required.
- If persistence is required, apply least-privilege access controls and redact identifying fields where feasible.
- Use this skill only in contexts where user consent and applicable privacy requirements are satisfied.
