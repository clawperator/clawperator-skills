---
name: com.android.settings.capture-overview
description: Open Android Settings, snapshot visible UI text, and capture a screenshot file path.
---

Runs a minimal OEM-agnostic baseline on `com.android.settings`:

1. `close_app`
2. `open_app`
3. settle delay
4. `snapshot_ui` (`ascii`)
5. `adb screencap`

Usage:

```bash
./skills/com.android.settings.capture-overview/scripts/capture_settings_overview.sh <device_id>
```

Optional args:

```bash
./skills/com.android.settings.capture-overview/scripts/capture_settings_overview.sh <device_id> <receiver_package>
```

Optional env:

- `ADB_BIN` (default: `adb`)
- `ADB_SERIAL` (device serial if multiple devices)
- `SCREENSHOT_DIR` (default: `/tmp/clawperator-settings-screenshots`)
- `SETTINGS_APP_ID` (default: `com.android.settings`)

Output format:

- `RESULT|app=com.android.settings|status=success|command_id=<...>|task_id=<...>`
- `TEXT_BEGIN`
- `<snapshot_ui text>`
- `TEXT_END`
- `SCREENSHOT|path=<absolute_file_path>`

On failure:

- `RESULT|app=com.android.settings|status=failure|command_id=<...>|task_id=<...>|reason=<...>`
