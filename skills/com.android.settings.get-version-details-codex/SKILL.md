---
name: com.android.settings.get-version-details-codex
description: Read Android OS release version and build number from live Settings UI with Codex.
clawperator-skill-type: orchestrated
version: 1.1.0
---

# Android version details

Use the [Settings orchestration example](https://docs.clawperator.com/skills/settings-version-details/)
for setup, invocations, result examples, and evidence interpretation. Select an
explicit compatible CLI/device/Operator pair before running this skill. Set
`CLAWPERATOR_BIN` and `CLAWPERATOR_SKILLS_REGISTRY` to the intended CLI and local
registry. Configure `VERSION_CODEX_MODEL` explicitly for the selected, authenticated
Codex executable; `VERSION_CODEX_EFFORT` defaults to `high`. No separate OpenAI API
key is required when using Codex account authentication.

`VERSION_RUN_DIR`, if supplied, must be a fresh absolute evidence directory. Runs
reserve their device against other copies of these examples; also ensure no other
controller is using it. Raw evidence can contain private device data and stays
local. Use a new directory for every attempt, including after failure.

## Task and evidence

Read the Android OS release version and Build number from live Settings UI. Preserve both exact strings. API level, security patch, kernel and manufacturer skin are different fields. Never use shell properties, historical answers, or direct About-screen intents. Do not change settings or tap Build number.

The helper offers fresh, visible, executable candidates with capture IDs. It preserves full compact hierarchy locally and verifies exact sibling label/value association against live `read-value` envelopes. It never chooses a route for Codex. Unknown structure, duplicate labels, truncation or read disagreement must return control to Codex or fail truthfully.

## Observed path and adaptation

On the proven emulator, Settings opens at its root after a close/Home reset. Scroll the visible list until About emulated device is visible; open it, then scroll the inner list until both requested fields have been collected. Android version can appear before Build number. On the previously observed Samsung route, scroll to About phone, then reveal and open Software information. Its titles have an extra title_frame wrapper; the shared parser verifies the nearest row rather than assuming direct siblings. Observe these labels on other OEM devices before acting. Route labels, hierarchy and current state take precedence over this hint. Opening Settings can resume a previous page.

Use `open` first. Inspect its current observation and collected fields. Use `act <candidate_id> <capture_id>` to execute one offered action; it automatically observes the resulting screen. `observe` refreshes stale evidence. Prefer a visible About or Software information row; otherwise scroll down when the needed fields are missing. Do not alternate scroll directions without evidence of overshooting. At most 18 actions per run. If the screen changes unexpectedly, inspect the retained observation and reacquire. Unsupported or unsafe screens require a truthful failed result. On command failure, inspect its retained JSON and distinguish readiness, dispatch, result-wait, and post-processing evidence. Observe current state before retrying an uncertain action; a not-dispatched command may still have earlier preflight effects.

If a capture returns `overlay_review_required`, use Codex's image viewing tool to inspect its screenshotPath. Only if Settings is clearly usable and the overlay is harmless (for example Samsung's thin edge-panel handle), invoke `approve-overlay <captureId>`. This grants a run-local allowance for that observed overlay package and reacquires evidence. A changed foreground or another overlay package requires a fresh review. Never approve an unknown dialog, obscured target, or confirmation. Do not approve from metadata alone. The known Samsung case reports its launcher as an overlay even though Settings is usable.

When complete, review the exact collected values and their evidence, call `finish`, then return its compact JSON receipt. `finish` reacquires a snapshot, retains a final screenshot and verifies both fields against this run's raw evidence. The launcher verifies the receipt hash and emits exactly one full SkillResult frame with the retained execution envelopes. Do not paraphrase or manually generate the result.

## Codex decisions

Choose every navigation action yourself from the current observation. Do not invoke the Jev operation. The read/evidence helper is shared with the Jev arm and contains no route selection loop.
