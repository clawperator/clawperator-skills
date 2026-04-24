---
name: com.netflix.mediaclient.set-my-list-state-replay
clawperator-skill-type: replay
description: |-
  Set the Netflix My List state for a title using live Clawperator UI navigation,
  with support for add/remove and profile selection.
---

# Netflix My List Setter

Sets a title's **My List** state in Netflix on Android.

## Inputs

- `action`: required, `add` or `remove`
- `title`: required Netflix title to modify
- `profile`: required Netflix profile name to select when the chooser appears

## Behavior

This skill:
1. opens Netflix from a fresh baseline
2. selects the requested profile if the chooser appears
3. opens Search
4. searches for the requested title
5. opens the title page
6. reads the Netflix `My List` toggle state from the live UI
7. toggles only if needed
8. verifies the final toggle state from the title page

## Usage

Add a title:

```bash
clawperator skills run com.netflix.mediaclient.set-my-list-state-replay \
  --device <device_id> \
  -- \
  --action add \
  --title 'House of Cards' \
  --profile '<profile_name>'
```

Remove a title:

```bash
clawperator skills run com.netflix.mediaclient.set-my-list-state-replay \
  --device <device_id> \
  -- \
  --action remove \
  --title 'House of Cards' \
  --profile '<profile_name>'
```

## Verification

Verification is based on the Netflix title-page ToggleButton:
- resource id: `com.netflix.mediaclient:id/2131428727`
- `checked="true"` means the title is in My List
- `checked="false"` means the title is not in My List

## Notes

- This first pass is authored against the current Samsung Netflix UI.
- The skill targets Netflix's `android:id/search_src_text` field for query entry and relies on `enter_text` replacement semantics with `clear=true`.
- Direct script usage also works:

```bash
node skills/com.netflix.mediaclient.set-my-list-state-replay/scripts/run.js \
  <device_id> \
  --action add \
  --title 'House of Cards' \
  --profile '<profile_name>'
```
