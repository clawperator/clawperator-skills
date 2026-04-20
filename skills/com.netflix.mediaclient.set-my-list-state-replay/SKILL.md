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

- `action`: `add` or `remove` (default `add`)
- `title`: title to modify (default `House of Cards`)
- `profile`: Netflix profile name (default `Chris`)

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
  --input action='add' \
  --input title='House of Cards' \
  --input profile='Chris' \
  --json
```

Remove a title:

```bash
clawperator skills run com.netflix.mediaclient.set-my-list-state-replay \
  --device <device_id> \
  --input action='remove' \
  --input title='House of Cards' \
  --input profile='Chris' \
  --json
```

## Verification

Verification is based on the Netflix title-page ToggleButton:
- resource id: `com.netflix.mediaclient:id/2131428727`
- `checked="true"` means the title is in My List
- `checked="false"` means the title is not in My List

## Notes

- This first pass is personalized local scope, authored against the current Samsung Netflix UI.
- The retained reference export is in `references/compare-baseline.export.json`.
