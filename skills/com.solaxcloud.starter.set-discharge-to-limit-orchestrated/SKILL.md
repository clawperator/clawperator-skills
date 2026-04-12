---
name: com.solaxcloud.starter.set-discharge-to-limit-orchestrated
clawperator-skill-type: orchestrated
description: |-
  Agent-driven proving-case skeleton for setting the discharge-to-limit percentage in the SolaX Cloud app.
---

Runtime program for the agent-driven orchestrated sibling of the SolaX discharge-limit skill.

The currently supported runtime agent for this skill is `codex`. This skill
runs through codex with `danger-full-access` sandbox posture so the runtime
agent can reach the live adb target, and it does not claim runtime support for
other agent CLIs yet.

Immediate execution rules:

- Do not summarize the plan. Start with a real Clawperator CLI command.
- Stay inside `com.solaxcloud.starter`. Do not open launcher search, the Google
  app, voice search, Assistant, Chrome, Settings, or any unrelated app.
- Use the known-good Samsung route:
  - open SolaX
  - if the current UI already shows `Peak Export`, `Device Discharging`, or the
    `Discharge to` dialog, continue from that current state instead of trying to
    restart from the home tab
  - otherwise open `Intelligence`
  - tap `Peak Export` at `x=860 y=1399`
  - wait for `Device Discharging`
  - tap `Device Discharging (By percentage)` at `x=875 y=1548`
  - wait for `Discharge to`
  - read the `Discharge to ...` row before editing
  - open the dialog and focus `resourceId=van-field-1-input`
  - change the value
  - click `Confirm`
  - after `Confirm`, expect the proving-device UI to return to the `Peak Export`
    editor instead of immediately showing the `Discharge to` row again
  - click the toolbar `Save` only if it is still visible
  - click the lower `Save` from the visible bottom action on the `Peak Export`
    editor
  - if a prompt appears saying the save will cancel the currently executing
    scenario, click `Confirm` and treat that confirmation as part of save
    completion
  - reopen the same route and read `Discharge to ...` again for terminal verification
- If you have not produced Clawperator evidence yet, you have not made
  progress.

This skill intentionally keeps a thin-harness orchestrated shape:

- `SKILL.md` is the runtime program
- `scripts/run.js` is only a harness that spawns the configured agent CLI
- the runtime agent must use Clawperator as the hand
- the runtime agent must emit exactly one `[Clawperator-Skill-Result]` frame
- this file defines runtime shape only; it does not claim reliability validation is complete

Debugging support:

- the harness writes a per-run prompt file, Codex stdout log, Codex stderr log,
  and metadata file into a temporary run directory
- set `CLAWPERATOR_SKILL_RETAIN_LOGS=1` to keep those artifacts after a
  successful run
- set `CLAWPERATOR_SKILL_DEBUG=1` to also stream Codex stdout to stderr while
  retaining the run directory
- set `CLAWPERATOR_SKILL_LOG_DIR=<dir>` to place retained run directories under
  a predictable parent path during local debugging

Inputs:

- raw argv passed through by `clawperator skills run`
- current proving-case shape is `clawperator skills run com.solaxcloud.starter.set-discharge-to-limit-orchestrated --device <device_serial> --json -- 40`
- `clawperator skills run` provides the selected device as `CLAWPERATOR_DEVICE_ID`
- interpret the first forwarded positional skill arg as `percent`
- invoke this harness through `clawperator skills run`; direct local invocation is not part of the supported runtime contract
- valid range: integer `0` to `100`

Runtime contract:

- emit `goal: { "kind": "set_discharge_limit", "percent": <percent> }`
- emit `inputs: { "percent": <percent> }`
- preserve this checkpoint subset in this exact order:
  - `app_opened`
  - `discharge_to_row_focused`
  - `target_text_entered`
  - `save_completed`
  - `terminal_state_verified`
- each checkpoint must include both `id` and `status`
- checkpoint `status` must be one of `ok`, `failed`, `skipped`
- terminalVerification `status` must be one of `verified`, `failed`, `not_run`
- do not emit `source`; Clawperator injects it from `skill.json`
- emit exactly one terminal `[Clawperator-Skill-Result]` frame on stdout

Operational playbook:

1. Parse `percent`.
2. If parsing fails, emit one framed failed `SkillResult` immediately.
3. Open `com.solaxcloud.starter`.
4. From the current SolaX flow, use only the recorded route:
   - if needed, bottom tab `Intelligence`
   - automation card `Peak Export`
   - action card `Device Discharging (By percentage)`
   - detail row `Discharge to ...`
5. Do not explore unrelated bottom tabs or sections such as `Device` or `Service`.
6. If `Intelligence` is not visible, try one close-and-reopen recovery.
7. Once on the `Peak Export` screen, open `Device Discharging (By percentage)`.
8. Once on the detail screen, open the `Discharge to ...` row.
9. Enter or confirm the requested `percent`.
10. Tap `Confirm`.
11. If the current UI still exposes the toolbar `Save`, tap it.
12. Continue when the `Peak Export` editor is visible, even if `Discharge to`
    does not reappear between `Confirm` and the save actions.
13. Tap the remaining lower `Save` action near the bottom of the screen.
14. If a confirmation prompt appears after the lower `Save`, click `Confirm`
    and wait for the app shell to resume.
15. Re-read the post-save UI state.
16. Verify whether the post-save UI read contains `Discharge to <percent>%`.
    A decorative trailing glyph such as `` on the same row does not invalidate
    a successful verification.
17. Emit the final framed `SkillResult` immediately and stop.

Navigation policy:

- the only allowed bottom-tab navigation is to `Intelligence`
- do not browse `Device`, `Service`, profile, settings, or any unrelated tabs while searching
- do not open launcher search, voice search, the Google app, Assistant, Chrome, Settings, or any app outside `com.solaxcloud.starter`
- if `Peak Export` is not reachable from `Intelligence` after the one allowed reopen recovery, emit a failed result instead of exploring elsewhere
- if the screen flow differs materially from the recorded route, emit a failed or indeterminate result truthfully instead of improvising a different in-app journey

Known-good Samsung route on the proving device:

- if `resourceId=com.solaxcloud.starter:id/tab_intelligent` is visible, click it
- if the current surface is already the `Peak Export` editor or `Discharge to`
  dialog inside `com.solaxcloud.starter`, continue from there instead of
  waiting for `tab_intelligent`
- open `Peak Export` with coordinate tap `x=860 y=1399`
- wait for text containing `Device Discharging`
- open `Device Discharging (By percentage)` with coordinate tap `x=875 y=1548`
- wait for text containing `Discharge to`
- read the `Discharge to ...` row before editing
- click the `Discharge to ...` row
- wait for `resourceId=van-field-1-input`
- click `resourceId=van-field-1-input`
- after dialog input, click `Confirm`
- expect the proving-device UI to return to the `Peak Export` editor
- click the toolbar `Save` only if it is still visible
- click the remaining lower `Save` from the visible bottom action
- if the scenario-cancel prompt appears, click `Confirm` before leaving save
- reopen the same `Peak Export -> Device Discharging -> Discharge to ...` route and read the row again for terminal verification

Do not invent alternative selectors or alternative app routes when this route is available.

Recovery branch:

- if the expected automation screen is not visible after opening the app, close and reopen once
- if it is still not visible, emit a failed framed result and stop

Terminal verification:

- expected text: `Discharge to <percent>%`
- proof must come from the post-save UI state, not from the requested input alone
- treat `Discharge to <percent>% ` as a valid verified read for this screen

Emission rules:

- no extra prose after the final frame
- the final non-empty stdout suffix must be:
  1. `[Clawperator-Skill-Result]`
  2. one JSON object line containing the emitted `SkillResult`

Reference success shape:

```json
{
  "contractVersion": "1.0.0",
  "skillId": "com.solaxcloud.starter.set-discharge-to-limit-orchestrated",
  "goal": { "kind": "set_discharge_limit", "percent": 40 },
  "inputs": { "percent": 40 },
  "status": "success",
  "checkpoints": [
    { "id": "app_opened", "status": "ok", "note": "Opened or resumed SolaX on the selected device and confirmed the run stayed inside com.solaxcloud.starter." },
    { "id": "discharge_to_row_focused", "status": "ok", "note": "Reached the Discharge to row through the recorded Peak Export route and observed the expected editor state." },
    { "id": "target_text_entered", "status": "ok", "note": "Entered the requested percent into van-field-1-input and observed the UI accept the requested value." },
    { "id": "save_completed", "status": "ok", "note": "Completed the Save flow, including the second Save and the final Confirm prompt when it appeared." },
    { "id": "terminal_state_verified", "status": "ok", "note": "Read the final Discharge to row and confirmed it exactly matched the requested percent." }
  ],
  "terminalVerification": {
    "status": "verified",
    "expected": { "kind": "text", "text": "Discharge to 40%" },
    "observed": { "kind": "text", "text": "Discharge to 40%" }
  }
}
```

Recording note:

- the retained replay recording export is reference evidence only
- do not treat recording export data as a runtime input

Strict-agentic discipline rules:

1. Planning in prose is not progress. Never emit a final SkillResult frame unless you have actually called the Clawperator CLI to produce evidence for every checkpoint you mark `status: ok`.
2. Never emit `status: "success"` unless the post-save UI was read through a Clawperator `read` call and the observed text contained `Discharge to <percent>%`. A decorative trailing glyph on the same row is acceptable. A success frame without that evidence is a lazy-mode failure and must be reported as `failed`, not as success.
3. If you find yourself describing what you would do instead of doing it, stop the run, mark the current checkpoint `status: skipped`, and emit a `failed` SkillResult with a truthful note.
4. Indeterminate is not an escape hatch for laziness. Use `indeterminate` only when the run reached a real ambiguity in the observed UI state, not when the agent chose to stop acting.
5. Every checkpoint marked `status: ok` must include a `note` that references the concrete Clawperator command and the observed evidence (for example the tapped selector or the read text).
6. Your first response must contain a real Clawperator CLI command for the selected device. If the run has not issued a Clawperator command yet, you are still at zero progress.
