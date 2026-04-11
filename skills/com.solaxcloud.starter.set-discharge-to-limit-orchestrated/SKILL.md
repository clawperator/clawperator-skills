---
name: com.solaxcloud.starter.set-discharge-to-limit-orchestrated
clawperator-skill-type: orchestrated
description: |-
  Agent-driven proving-case skeleton for setting the discharge-to-limit percentage in the SolaX Cloud app.
---

Runtime program for the agent-driven orchestrated sibling of the Solax discharge-limit skill.

This skill is intentionally a W2b skeleton:

- `SKILL.md` is the runtime program
- `scripts/run.js` is only a harness that spawns the configured agent CLI
- the runtime agent must use Clawperator as the hand
- the runtime agent must emit exactly one `[Clawperator-Skill-Result]` frame
- this file defines runtime shape only; it does not claim reliability validation is complete

Inputs:

- raw argv passed through by `clawperator skills run`
- current proving-case shape is `clawperator skills run com.solaxcloud.starter.set-discharge-to-limit-orchestrated --device <device_serial> --json -- 40`
- interpret the first positional skill arg as `percent`
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
4. Use the current UI state to reach the automation screen that contains:
   - `Peak Export`
   - `Device Discharging (By percentage)`
   - `Save`
5. Focus the `Device Discharging (By percentage)` row.
6. Enter or confirm the requested `percent`.
7. Tap `Save`.
8. Re-read the post-save UI state.
9. Verify whether the post-save UI contains exact text `Discharge to <percent>%`.
10. Emit the final framed `SkillResult` immediately and stop.

Recovery branch:

- if the expected automation screen is not visible after opening the app, close and reopen once
- if it is still not visible, emit a failed framed result and stop

Terminal verification:

- expected text: `Discharge to <percent>%`
- proof must come from the post-save UI state, not from the requested input alone

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
    { "id": "app_opened", "status": "ok" },
    { "id": "discharge_to_row_focused", "status": "ok" },
    { "id": "target_text_entered", "status": "ok" },
    { "id": "save_completed", "status": "ok" },
    { "id": "terminal_state_verified", "status": "ok" }
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
