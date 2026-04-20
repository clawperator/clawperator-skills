---
name: com.android.vending.install-app
clawperator-skill-type: replay
description: Search for an Android app in Google Play and install it from the matching app details page.
---

Searches Google Play for a named app, opens the matching app details page, and
installs it if needed. The skill does not rely on Play suggestions; it submits
the query, inspects the results surface, opens the matched result, and then
verifies the install outcome from the details page.

Validation commonly targets `com.actionlauncher.playstore` as the sample app to install.

## Install state signals

| State | UI signal | Node attribute |
|-------|-----------|----------------|
| Ready to install | "Install" button | `content-desc="Install"` or `text="Install"` |
| Installation in progress | Progress indicator, "Cancel" button | `content-desc="Cancel"` present, no "Open" yet |
| Just installed (transition) | "Open" and "Cancel" both present, progress at 100% | `text="Open"` present |
| Installed (settled state) | "Open" and "Uninstall" both present | `text="Open"` and `text="Uninstall"` |
| Already installed | Same as settled: "Open" and "Uninstall" | No "Install" present |
| Update available | "Update" button present | `text="Update"` |
| Paid app / paywall | Price shown instead of "Install" | Text like "$4.99" in place of "Install" |
| Login required | Account picker or sign-in prompt | `text="Sign in"` or similar |
| Incompatible device | "Not available for your device" | Informational text, no Install button |

## Usage

```bash
./skills/com.android.vending.install-app/scripts/install_play_app.sh <device_id> <app_name> [operator_package]
```

Example:
```bash
./skills/com.android.vending.install-app/scripts/install_play_app.sh <device_serial> "Spotify"
```

## Output

On success, prints:
- Final install state (installed, already-installed, update-available)
- Any blocking state encountered
- A terminal `✅` summary line

## Notes

- The Install button has no resource-id. Matched via `contentDescEquals: "Install"`.
- The Install button node is `clickable=false` but its parent container is `clickable=true`.
  Clawperator clicks the center of the matched node's bounding box, which lands on the
  clickable parent. This works correctly.
- Search result matching prefers exact title match, then title prefix match, then
  title substring match.
- For apps that take time to download, `wait_for_node` polling for `text="Open"` is more
  robust than a fixed sleep. The default timeout in this skill is 120 seconds.
- Free apps with no in-app purchases install without prompts.
- Apps with in-app purchases show a small "In-app purchases" label on the details page
  but this does not block the install.
- If the preflight snapshot step returns `success: false` with
  `data.error: "SNAPSHOT_EXTRACTION_FAILED"`, or the skill exits with "Preflight snapshot
  returned empty" despite the device showing the app details page, the clawperator binary
  may be out of date with the Android Operator APK. Set `CLAWPERATOR_BIN` to the
  local build:
  `export CLAWPERATOR_BIN=/path/to/clawperator/apps/node/dist/cli/index.js`
  Then verify with: `clawperator snapshot --device <id>`
