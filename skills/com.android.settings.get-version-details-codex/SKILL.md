---
name: com.android.settings.get-version-details-codex
description: Read Android OS release version and build number from live Settings UI with Codex.
clawperator-skill-type: orchestrated
---

# Android version details

Invoke through `clawperator skills run com.android.settings.get-version-details-codex --device <device_serial>`. Set `CLAWPERATOR_BIN` explicitly to the intended executable and `CLAWPERATOR_SKILLS_REGISTRY` to this repository's registry. The benchmark uses global 0.11.3; no sibling build is selected. Optional `VERSION_RUN_DIR` must be a fresh absolute evidence directory. `VERSION_CODEX_MODEL` and `VERSION_CODEX_EFFORT` default to gpt-6-astra and high.

## Task and evidence

Read the Android OS release version and Build number from live Settings UI. Preserve both exact strings. API level, security patch, kernel and manufacturer skin are different fields. Never use shell properties, historical answers, or direct About-screen intents. Do not change settings or tap Build number.

The helper offers fresh, visible, executable candidates with capture IDs. It preserves full compact hierarchy locally and verifies exact sibling label/value association against live `read-value` envelopes. It never chooses a route for Codex. Unknown structure, duplicate labels, truncation or read disagreement must return control to Codex or fail truthfully.

## Observed path and adaptation

On the proven emulator, Settings opens at its root after a close/Home reset. Scroll the visible list until About emulated device is visible; open it, then scroll the inner list until both requested fields have been collected. Android version can appear before Build number. On the proven Samsung, scroll to About phone, then reveal and open Software information. Its titles have an extra title_frame wrapper; the shared parser verifies the nearest row rather than assuming direct siblings. Observe these labels on other OEM devices before acting. Route labels, hierarchy and current state take precedence over this hint. Opening Settings can resume a previous page.

Use `open` first. Inspect its current observation and collected fields. Use `act <candidate_id> <capture_id>` to execute one offered action; it automatically observes the resulting screen. `observe` refreshes stale evidence. Prefer a visible About or Software information row; otherwise scroll down when the needed fields are missing. Do not alternate scroll directions without evidence of overshooting. At most 18 actions per run. If the screen changes unexpectedly, inspect the retained observation and reacquire. Unsupported or unsafe screens require a truthful failed result.

If a capture returns `overlay_review_required`, use Codex's image viewing tool to inspect its screenshotPath. Only if Settings is clearly usable and the overlay is harmless (for example Samsung's thin edge-panel handle), invoke `approve-overlay <captureId>`. This grants a run-local allowance for that observed overlay package and reacquires evidence. A changed foreground or another overlay package requires a fresh review. Never approve an unknown dialog, obscured target, or confirmation. Do not approve from metadata alone. The known Samsung case reports its launcher as an overlay even though Settings is usable.

When complete, review the exact collected values and their evidence, call `finish`, then return its compact JSON receipt. `finish` reacquires a snapshot, retains a final screenshot and verifies both fields against this run's raw evidence. The launcher verifies the receipt hash and emits exactly one full SkillResult frame with the retained execution envelopes. Do not paraphrase or manually generate the result.

## Codex decisions

Choose every navigation action yourself from the current observation. Do not invoke the Jev operation. The read/evidence helper is shared with the Jev arm and contains no route selection loop.
