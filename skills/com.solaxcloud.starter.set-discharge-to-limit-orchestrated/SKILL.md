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
- this file defines the runtime shape only; it does not claim reliability validation is complete

Inputs:

- raw argv passed through by `clawperator skills run`
- current proving-case shape is `clawperator skills run com.solaxcloud.starter.set-discharge-to-limit-orchestrated --device <device_serial> --json -- 40`
- the runtime agent must interpret the first positional skill arg as `percent`
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
- do not emit `source` in the framed result; Clawperator injects it from `skill.json`
- emit exactly one terminal `[Clawperator-Skill-Result]` frame on stdout

Allowed Clawperator primitives:

- `clawperator snapshot`
- `clawperator exec`

Program:

1. Read the forwarded skill inputs from argv and `CLAWPERATOR_SKILL_INPUTS`.
2. Parse `percent` as an integer in the range `0` to `100`. If parsing fails, emit one framed `SkillResult` with `status: "failed"` and a checkpoint trail that truthfully reflects how far the run got.
3. Open SolaX Cloud and navigate toward the discharge-limit row using Clawperator as the hand.
4. Record checkpoints only from the declared set above. Do not invent checkpoint ids.
5. Enter the requested percent and save the change.
6. Re-read the terminal UI state and verify the row text is exactly `Discharge to <percent>%`.
7. Emit a final `SkillResult`:
   - `status: "success"` only when terminal verification is proved
   - `status: "failed"` when the run encountered a concrete failure
   - `status: "indeterminate"` when the run completed without proof of terminal verification

Recovery branch:

- if the app opens but the expected `Intelligence` entrypoint is not visible, close and reopen the app once
- if it is still not visible after one retry, emit a final framed `SkillResult` with `status: "failed"`, mark unreached checkpoints as `skipped`, and explain the failure in checkpoint or terminal-verification notes

Terminal verification:

- expected text: `Discharge to <percent>%`
- verification must come from the post-save UI state, not from the requested input value alone

Emission rules:

- stdout may include ordinary progress text before the final frame
- stderr may include agent reasoning or diagnostic notes
- the final non-empty stdout suffix must be:
  1. `[Clawperator-Skill-Result]`
  2. one JSON object line containing the emitted `SkillResult`

Recording note:

- the retained replay recording export is reference evidence only
- do not treat recording export data as a runtime input
- this runtime agent should rely only on this `SKILL.md`, current UI state, and forwarded skill inputs
