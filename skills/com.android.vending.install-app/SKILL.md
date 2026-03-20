---
name: com.android.vending.install-app
description: Install an Android app from the Google Play Store app details page.
---

Installs an app from its Google Play Store details page and confirms the result.
Assumes the device is already on the app details page (as left by
`com.android.vending.search-app`).

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
./skills/com.android.vending.install-app/scripts/install_play_app.sh <device_id> [receiver_package]
```

Example:
```bash
./skills/com.android.vending.install-app/scripts/install_play_app.sh <device_serial>
```

## Output

On success, prints:
- Final install state (installed, already-installed, update-available)
- Any blocking state encountered

## Notes

- The Install button has no resource-id. Matched via `contentDescEquals: "Install"`.
- The Install button node is `clickable=false` but its parent container is `clickable=true`.
  Clawperator clicks the center of the matched node's bounding box, which lands on the
  clickable parent. This works correctly.
- For apps that take time to download, `wait_for_node` polling for `text="Open"` is more
  robust than a fixed sleep. The default timeout in this skill is 120 seconds.
- Free apps with no in-app purchases install without prompts.
- Apps with in-app purchases show a small "In-app purchases" label on the details page
  but this does not block the install.
- If the preflight snapshot step returns `success: false` with
  `data.error: "SNAPSHOT_EXTRACTION_FAILED"`, or the skill exits with "Preflight snapshot
  returned empty" despite the device showing the app details page, the globally installed
  `clawperator` binary may be out of date. Reinstall with `npm install -g clawperator`
  or set `CLAWPERATOR_BIN` to a local or updated build:
  `export CLAWPERATOR_BIN=/path/to/clawperator/apps/node/dist/cli/index.js`
  Then run `clawperator version --check-compat` to confirm compatibility.
