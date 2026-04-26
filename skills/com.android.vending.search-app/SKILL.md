---
name: com.android.vending.search-app
clawperator-skill-type: replay
description: Search for Android apps in the Google Play Store and list the first visible search results.
---

Searches for a named app in the Google Play Store and returns the first visible
search results in UI order, similar to the Amazon search skill.

Current behavior:
- opens the Play Store search surface
- enters the query
- waits for the results surface to become readable
- parses the first 5 visible app rows
- emits a terminal `[Clawperator-Skill-Result]` frame with structured results

## Usage

```bash
./skills/com.android.vending.search-app/scripts/search_play_store.sh <device_id> <query> [operator_package]
```

Examples:
```bash
./skills/com.android.vending.search-app/scripts/search_play_store.sh <device_serial> "VLC"
```

## Output

On success, prints the first visible search results including:
- App name
- Developer
- Sponsored state when visible
- Install state when visible
- A terminal `✅` summary line
- A terminal `[Clawperator-Skill-Result]` frame with structured `results`

## Blocking states

- **Login prompt:** If the user is not signed in to Google Play, an account picker or
  sign-in screen will appear. Script exits with an error message.
- **App not found:** If no results are returned for the query, script exits with an error.

## Notes

- No resource-ids are present on Play Store UI elements. All selectors use text,
  content-desc, or role matchers.
- content-desc attributes in Play Store use HTML entity encoding (`&apos;` etc). Use
  `contentDescContains` for substring matching instead of exact matches.
- The search input field has no resource-id; use `role: "textfield"` to target it.
- This skill now reports search results rather than navigating into an app details page.
- The runtime uses `wait_for_node` and bounded snapshot polling instead of fixed sleeps
  so it can react to the Play Store becoming ready instead of guessing delays.
- The optional `package_id` arg is currently accepted for compatibility but ignored by the runtime script.
- If snapshot extraction fails (step returns `success: false` with
  `data.error: "SNAPSHOT_EXTRACTION_FAILED"`, or the skill exits with "No snapshot
  returned" despite the device being on the correct screen), the clawperator binary
  may be out of date with the Android Operator APK. Set `CLAWPERATOR_BIN` to the
  local build:
  `export CLAWPERATOR_BIN=/path/to/clawperator/apps/node/dist/cli/index.js`
  Then verify with: `clawperator snapshot --device <id>`
