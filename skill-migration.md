# Skill Migration Log

Scope: PRD-3.5 skills audit and device verification for `clawperator-skills`.

Device used: `<device_serial>`

Dry-run validation:
- Installed registry snapshot: `valid=true`, `totalSkills=17`
- Current checkout registry: `valid=true`, `totalSkills=12`

Registry notes:
- The working-tree registry generated from this checkout currently contains 12 skills.
- The following skill IDs from the installed registry are not present in this checkout and therefore could not be fixed here:
  - `com.android.settings.check-software-update`
  - `com.android.settings.get-android-version`
  - `com.android.settings.set-theme`
  - `com.google.android.youtube.play-me-at-the-zoo`
  - `com.solaxcloud.starter.get-device-discharging`

## Skill-by-Skill Log

### `com.globird.energy.get-usage`
- Status: pass
- Finding: no runtime issue on this device.
- Notes: artifact-backed skill already runs cleanly on-device.

### `com.google.android.apps.chromecast.app.get-climate`
- Status: fixed, then pass
- Finding: the skill needed to handle both the Google Home overview and the restored device detail view.
- Fix: added a preflight snapshot and dual-path fallback so it can choose between direct reads and navigation to the tile.

### `com.google.android.apps.chromecast.app.set-climate`
- Status: fixed, then pass
- Finding: positional parsing did not match `clawperator skills run` argument forwarding.
- Fix: made the script accept both direct invocation and `skills run` argument shapes.

### `com.solaxcloud.starter.get-battery`
- Status: pass
- Finding: no runtime issue on this device.

### `com.theswitchbot.switchbot.get-bedroom-temperature`
- Status: pass
- Finding: no runtime issue on this device.

### `com.android.settings.capture-overview`
- Status: pass
- Finding: no runtime issue on this device.

### `com.android.vending.install-app`
- Status: blocked
- Finding: the Play Store did not present an install button on the current device state.
- Reason: not on an app details page when the skill ran.
- Follow-up attempt: searching for the target app did not load a details page, so there was no safe install target to hand off to this skill.

### `com.android.vending.search-app`
- Status: pass
- Finding: no runtime issue after passing the query as a single forwarded arg.
- Follow-up attempt for the install flow: the target app query did not return a usable details page on this device.

### `com.coles.search-products`
- Status: fixed, then pass
- Finding: the skill still sent `snapshot_ui` with `format: "ascii"`, which the executor rejects.
- Fix: removed the unsupported `format` field from the snapshot action.

### `com.woolworths.search-products`
- Status: fixed, then pass
- Finding 1: the skill still sent `snapshot_ui` with `format: "ascii"`, which the executor rejects.
- Finding 2: the Woolworths UI uses `Search products, search field` and `role: textfield`, not the old `search_view_blocker` / `search_src_text` selectors.
- Fix: removed the unsupported `format` field and updated the search selectors to the current UI.

### `com.life360.android.safetymapd.get-location`
- Status: fixed, then pass
- Finding: the visible person card label did not match the lowercase input exactly.
- Fix: normalized the requested name before matching.

### `com.android.settings.check-software-update`
- Status: blocked outside this checkout
- Finding: skill is not present in this repository checkout.
- On-device result from installed registry: timed out after 120 seconds while opening Settings and scrolling to Software update.

### `com.android.settings.get-android-version`
- Status: blocked outside this checkout
- Finding: skill is not present in this repository checkout.
- On-device result from installed registry: failed during phase 1 open + scroll with a `SKILL_EXECUTION_FAILED` exit code 2.

### `com.android.settings.set-theme`
- Status: blocked outside this checkout
- Finding: skill is not present in this repository checkout.
- On-device result from installed registry: failed with `RESULT_ENVELOPE_TIMEOUT` after 95 seconds while replaying the dark-theme flow.

### `com.google.android.youtube.play-me-at-the-zoo`
- Status: blocked outside this checkout
- Finding: skill is not present in this repository checkout.
- On-device result from installed registry: failed with `RESULT_ENVELOPE_TIMEOUT` after 95 seconds while replaying the YouTube search flow for "Me at the zoo".

### `com.solaxcloud.starter.get-device-discharging`
- Status: blocked outside this checkout
- Finding: skill is not present in this repository checkout.
- On-device result from installed registry: timed out after 120 seconds with only the initial start message emitted.

## Summary of Repo Changes

- Removed unsupported `snapshot_ui` `format: "ascii"` parameters from:
  - `skills/com.coles.search-products/scripts/search_coles_products.js`
  - `skills/com.woolworths.search-products/scripts/search_woolworths_products.js`
  - `skills/com.life360.android.safetymapd.get-location/scripts/get_life360_location.js`
- Hardened `skills/com.google.android.apps.chromecast.app.get-climate/scripts/get_climate_status.js` for both Google Home landing states.
- Fixed `skills/com.google.android.apps.chromecast.app.set-climate/scripts/set_climate.js` argument parsing.
- Updated `skills/com.life360.android.safetymapd.get-location/scripts/get_life360_location.js` to title-case the person name.
- Regenerated the local skill registry/indexes.
