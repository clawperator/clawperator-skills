---
name: com.android.settings.capture-overview
description: Open Android Settings, snapshot visible UI text, and capture a screenshot file path.
---

Runs a minimal OEM-agnostic baseline on `com.android.settings`:

1. `close_app`
2. `open_app`
3. settle delay (increased from 2s to 3s for reliability)
4. `snapshot`
5. snapshot text written to file

Usage:

```bash
./skills/com.android.settings.capture-overview/scripts/capture_settings_overview.sh <device_id>
```

Optional args:

```bash
./skills/com.android.settings.capture-overview/scripts/capture_settings_overview.sh <device_id> <operator_package>
```

Optional env:

- `SCREENSHOT_DIR` (default: `/tmp/clawperator-settings-screenshots`)
- `SETTINGS_APP_ID` (default: `com.android.settings`)
- `CLAWPERATOR_OPERATOR_PACKAGE` (default: `com.clawperator.operator`)

Output format:

- `TEXT_BEGIN`
- `<snapshot text>`
- `TEXT_END`
- `SCREENSHOT|path=<absolute_file_path>`
- `SNAPSHOT|path=<absolute_file_path>`
- `✅ Settings overview captured for com.android.settings`

On failure:

- `⚠️` error lines on stderr and a non-zero exit code
