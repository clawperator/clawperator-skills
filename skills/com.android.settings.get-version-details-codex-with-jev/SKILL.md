---
name: com.android.settings.get-version-details-codex-with-jev
description: Read Android OS release version and build number from live Settings UI with Codex and bounded Jev decisions.
clawperator-skill-type: orchestrated
version: 1.1.0
---

# Android version details

Follow [Host Agent Orientation](https://docs.clawperator.com/host-agents/) to select
a compatible CLI/device/Operator pair before running this skill. Set
`CLAWPERATOR_BIN` and `CLAWPERATOR_SKILLS_REGISTRY` to the intended CLI and local
registry. Configure `VERSION_CODEX_MODEL` explicitly for the selected, authenticated
Codex executable; `VERSION_CODEX_EFFORT` defaults to `high`. No separate OpenAI API
key is required when using Codex account authentication.

`VERSION_RUN_DIR`, if supplied, must be a fresh absolute evidence directory. Runs
reserve their device against other copies of these examples; also ensure no other
controller is using it. Raw evidence can contain private device data and stays
local. Use a new directory for every attempt, including after failure.

Invoke through the selected CLI (use `node <absolute_index.js>` for a branch-local
JavaScript entry point):

```bash
clawperator skills run com.android.settings.get-version-details-codex-with-jev --device <device_serial> --operator-package <operator_package> --timeout 300000 --output json
```

The wrapper resolves `codex` from `PATH`; select a compatible, authenticated
executable there before running. Check its version/help and model availability
separately from Android readiness. Inspect the outer CLI outcome and nested
`skillResult`: success requires both verified UI fields, while a failed result
retains its reason and may have no success receipt. Keep the run directory's
raw command responses, `events.json`, `metadata.json`, and agent transcript for
diagnosis. `run-summary.json` measures harness time, not outer CLI startup.

Provide `JEV_API_KEY` in the environment without printing it. See
[Jev integration](https://docs.clawperator.com/skills/jev/) for the reusable
agent/provider boundary; the concrete limits below belong to this skill.

## Task and evidence

Read the Android OS release version and Build number from live Settings UI. Preserve both exact strings. API level, security patch, kernel and manufacturer skin are different fields. Never use shell properties, historical answers, or direct About-screen intents. Do not change settings or tap Build number.

The helper offers fresh, visible, executable candidates with capture IDs. It preserves full compact hierarchy locally and verifies exact sibling label/value association against live `read-value` envelopes. It never chooses a route for Codex. Unknown structure, duplicate labels, truncation or read disagreement must return control to Codex or fail truthfully.

## Observed path and adaptation

On the proven emulator, Settings opens at its root after a close/Home reset. Scroll the visible list until About emulated device is visible; open it, then scroll the inner list until both requested fields have been collected. Android version can appear before Build number. On the previously observed Samsung route, scroll to About phone, then reveal and open Software information. Its titles have an extra title_frame wrapper; the shared parser verifies the nearest row rather than assuming direct siblings. Observe these labels on other OEM devices before acting. Route labels, hierarchy and current state take precedence over this hint. Opening Settings can resume a previous page.

Use `open` first. Inspect its current observation and collected fields. Use `act <candidate_id> <capture_id>` to execute one offered action; it automatically observes the resulting screen. `observe` refreshes stale evidence. Prefer a visible About or Software information row; otherwise scroll down when the needed fields are missing. Do not alternate scroll directions without evidence of overshooting. At most 18 actions per run. If the screen changes unexpectedly, inspect the retained observation and reacquire. Unsupported or unsafe screens require a truthful failed result. On command failure, inspect its retained JSON and distinguish readiness, dispatch, result-wait, and post-processing evidence. Observe current state before retrying an uncertain action; a not-dispatched command may still have earlier preflight effects.

If a capture returns `overlay_review_required`, use Codex's image viewing tool to inspect its screenshotPath. Only if Settings is clearly usable and the overlay is harmless (for example Samsung's thin edge-panel handle), invoke `approve-overlay <captureId>`. This grants a run-local allowance for that observed overlay package and reacquires evidence. A changed foreground or another overlay package requires a fresh review. Never approve an unknown dialog, obscured target, or confirmation. Do not approve from metadata alone. The known Samsung case reports its launcher as an overlay even though Settings is usable.

When complete, review the exact collected values and their evidence, call `finish`, then return its compact JSON receipt. `finish` reacquires a snapshot, retains a final screenshot and verifies both fields against this run's raw evidence. The launcher verifies the receipt hash and emits exactly one full SkillResult frame with the retained execution envelopes. Do not paraphrase or manually generate the result.

## Bounded Jev delegation

After `open`, invoke `jev` to delegate the subgoal of revealing missing version/build rows. Codex remains responsible for reviewing the returned state, recovering from escalation, and terminal verification. This loop asks Jev to choose only among current candidates, executes one choice and observes again. It returns after completion, uncertainty, no progress, 8 actions or a 30-second decision budget (an in-flight bounded operation may finish beyond that budget). On escalation, inspect the reason and current state; continue using the same `act` and `observe` operations yourself if justified. Do not repeatedly call Jev for the same blocked state. Missing API credentials fail before device navigation.

Jev is pinned to `jev-1.13.0`; confidence gate 0.6, per-request attempt 5 seconds, total 10 seconds, at most one retry for HTTP 429/529. Confidence is a routing gate, not a correctness guarantee. Only allowlisted navigation descriptions and field-completion booleans are sent to Jev. Values are copied locally from live UI evidence.
