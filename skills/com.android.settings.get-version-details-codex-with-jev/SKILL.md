---
name: com.android.settings.get-version-details-codex-with-jev
description: Read Android OS release version and build number from live Settings UI with Codex and bounded Jev decisions.
clawperator-skill-type: orchestrated
---

# Android version details

Invoke through `clawperator skills run com.android.settings.get-version-details-codex-with-jev --device <device_serial>`. Set `CLAWPERATOR_BIN` explicitly to the intended executable and `CLAWPERATOR_SKILLS_REGISTRY` to this repository's registry. The benchmark uses global 0.11.3; no sibling build is selected. Optional `VERSION_RUN_DIR` must be a fresh absolute evidence directory. `VERSION_CODEX_MODEL` and `VERSION_CODEX_EFFORT` default to gpt-6-astra and high. Provide JEV_API_KEY in the environment; never include it in arguments or logs.

## Task and evidence

Read the Android OS release version and Build number from live Settings UI. Preserve both exact strings. API level, security patch, kernel and manufacturer skin are different fields. Never use shell properties, historical answers, or direct About-screen intents. Do not change settings or tap Build number.

The helper offers fresh, visible, executable candidates with capture IDs. It preserves full compact hierarchy locally and verifies exact sibling label/value association against live `read-value` envelopes. It never chooses a route for Codex. Unknown structure, duplicate labels, truncation or read disagreement must return control to Codex or fail truthfully.

## Observed path and adaptation

On the proven emulator, Settings opens at its root after a close/Home reset. Scroll the visible list until About emulated device is visible; open it, then scroll the inner list until both requested fields have been collected. Android version can appear before Build number. On OEM devices, look for About phone then Software information when actually observed. Route labels, hierarchy and current state take precedence over this hint. Opening Settings can resume a previous page.

Use `open` first. Inspect its current observation and collected fields. Use `act <candidate_id> <capture_id>` to execute one offered action; it automatically observes the resulting screen. `observe` refreshes stale evidence. Prefer a visible About or Software information row; otherwise scroll down when the needed fields are missing. Do not alternate scroll directions without evidence of overshooting. At most 18 actions per run. If the screen changes unexpectedly, inspect the retained observation and reacquire. Unsupported or unsafe screens require a truthful failed result.

When complete, review the exact collected values and their evidence, call `finish`, then return its compact JSON receipt. `finish` reacquires a snapshot, retains a final screenshot and verifies both fields against this run's raw evidence. The launcher verifies the receipt hash and emits exactly one full SkillResult frame with the retained execution envelopes. Do not paraphrase or manually generate the result.

## Bounded Jev delegation

After `open`, invoke `jev` to delegate the subgoal of revealing missing version/build rows. Codex remains responsible for reviewing the returned state, recovering from escalation, and terminal verification. This loop asks Jev to choose only among current candidates, executes one choice and observes again. It returns after completion, uncertainty, no progress, 8 actions or a 30-second decision budget (an in-flight bounded operation may finish beyond that budget). On escalation, inspect the reason and current state; continue using the same `act` and `observe` operations yourself if justified. Do not repeatedly call Jev for the same blocked state. Missing API credentials fail before device navigation.

Jev is pinned to `jev-1.13.0`; confidence gate 0.6, per-request attempt 5 seconds, total 10 seconds, at most one retry for HTTP 429/529. Confidence is a routing gate, not a correctness guarantee. Only allowlisted navigation descriptions and field-completion booleans are sent to Jev. Values are copied locally from live UI evidence.
