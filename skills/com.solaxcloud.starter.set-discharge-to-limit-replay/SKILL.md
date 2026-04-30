---
name: com.solaxcloud.starter.set-discharge-to-limit-replay
clawperator-skill-type: replay
description: |-
  Replay baseline skill for setting the discharge-to-limit percentage in the SolaX Cloud app.
---

Replay baseline skill for setting the discharge-to-limit percentage in the SolaX Cloud Android app.

Compatibility:

- `com.solaxcloud.starter.set-discharge-to-limit-replay` is the canonical replay baseline id
- the old unsuffixed id `com.solaxcloud.starter.set-discharge-to-limit` has been retired
- callers should use the explicit `-replay` id

Arguments:

- canonical named wrapper arg: `--percent <percent>`
- legacy named alias still accepted: `--limit <percent>`
- the replay script also still accepts the legacy positional percent form after
  the device id for compatibility
- valid range: integer from `0` to `100`

Run through the wrapper:

```bash
clawperator skills run com.solaxcloud.starter.set-discharge-to-limit-replay --device <device_serial> --percent 40
```

The lone `--` separator is not required for the canonical `--percent` form.
The legacy `-- --limit <percent>` invocation is also still accepted by the
script for compatibility with callers that have not refreshed their wrapper
instructions yet.

Direct local invocation:

```bash
CLAWPERATOR_BIN="<node_binary> <clawperator_root>/apps/node/dist/cli/index.js" \
<node_binary> <skills_repo_root>/skills/com.solaxcloud.starter.set-discharge-to-limit-replay/scripts/run.js \
<device_serial> --percent 40
```

Current behavior:

- opens SolaX Cloud from a fresh app session
- switches to the `Intelligence` tab
- opens the `Peak Export` automation card
- opens the `Device Discharging (By percentage)` action card
- opens the `Discharge to ...` row
- enters the requested percentage
- clicks `Confirm`
- clicks the toolbar `Save`
- polls snapshot UI until the `Peak Export` screen is visible again after the toolbar `Save`
- clicks the remaining bottom-sheet `Save` action by label only after that post-toolbar check proves the UI advanced past the first `Save`
- confirms the intermittent `The save operation will cancel the currently executing scenario` prompt when it appears after the bottom-sheet `Save`
- first tries a post-save reread of the `Discharge to ...` row
- if that reread fails because the row is temporarily missing or the verification call times out, reopens the app and performs a fresh-session reread before declaring failure
- only reports success when one of those verification reads proves the requested value
- writes the raw verification `clawperator exec --json` output to `stdout` before a final structured result frame
- emits exactly one `[Clawperator-Skill-Result]` frame at end-of-stdout with `contractVersion: "1.0.0"`
- omits `source` from the emitted frame; `runSkill` injects `source: { "kind": "script" }`
- emits `goal: { "kind": "set_discharge_limit", "percent": <percent> }`
- emits `inputs: { "percent": <percent> }`
- relies on the script-emitted verified `SkillResult` as the source of truth
  for top-level success, rather than a separate registry matcher render step
- emits this stable replay checkpoint subset, in order:
  - `app_opened`
  - `discharge_to_row_focused`
  - `target_text_entered`
  - `save_completed`
  - `terminal_state_verified`
- keeps checkpoint evidence coarse and machine-readable; it does not embed full
  nested `clawperator exec --json` envelopes in `skillResult`
- uses `terminalVerification.status: "verified"` only when the final row text proves `Discharge to <percent>%`
- records `terminalVerification.method` as `post-save reread` or `fresh-session reread`
- preserves truthful failure: nested exec failures still exit non-zero, and verification mismatch still exits non-zero while surfacing a structured `skillResult`
- flushes the final framed result before exiting on failure paths so
  downstream consumers can reliably read structured failure

Known caveats:

- this first version is based on one Samsung recording with snapshot export set
  to omit, so the selectors are intentionally conservative
- the current UI dump shows `Peak Export` as the automation card on the
  `Intelligence` tab that leads to the discharge setting screen
- the current UI dump on the detail screen shows a clickable
  `Device Discharging (By percentage)` card first, and only then a
  `Discharge to 40%`-style row one level deeper
- the first two taps are implemented as device-specific coordinate clicks on
  this Samsung layout because the visible text nodes are not the actual
  clickable containers
- the current Samsung coordinates used by the script are the recorded container
  taps for `Peak Export` and `Device Discharging (By percentage)`, not generic
  text-node clicks
- the final bottom-sheet `Save` tap is matched by label only after a
  post-toolbar snapshot poll proves the UI has returned to the `Peak Export`
  screen, so the replay no longer races the same `Save` surface twice
- the app can show an intermittent prompt after the final bottom-sheet `Save`
  warning that saving will cancel the currently executing scenario; the replay
  confirms that prompt when it appears before terminal verification
- the `Discharge to` dialog input is persisted reliably only when the script
  uses real key events (`DEL`, `DEL`, text entry, then `Enter`) before
  `Confirm`; plain text-set behavior was not sufficient for this app flow
- this replay version verifies final state itself by re-reading the row text
  after save, and falls back to a fresh-session reread when the post-save
  verification path fails with transient selector or timeout issues; if neither
  read proves the requested percentage, the skill exits non-zero
- the script reads the row once before editing and again after save; if the row
  already showed the requested percentage before the change, the skill still
  proves final state but cannot prove that the value changed from a different
  starting value, so it logs that residual risk to `stderr` and records it in
  `skillResult.diagnostics.warnings`
- the script assumes the account is already signed in and the app opens to the
  expected home flow
- if the Solax UI text or dialog structure changes, capture a new recording and
  refresh the selectors before broadening the skill
- no replay checkpoint identities were dropped or renamed in this retrofit;
  W2b should mirror the same coarse subset and ordering before adding any
  orchestrated-only finer-grained checkpoints
- pre-save failures after the discharge row is focused but before any save
  action are reported against `target_text_entered`, not `save_completed`

## Validation

Success path:

```bash
CLAWPERATOR_SKILLS_REGISTRY=<skills_repo_root>/skills/skills-registry.json \
CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev \
<node_binary> <clawperator_root>/apps/node/dist/cli/index.js skills run com.solaxcloud.starter.set-discharge-to-limit-replay --device <device_serial> --percent 40
```

Forced-failure repro:

```bash
CLAWPERATOR_SKILLS_REGISTRY=<skills_repo_root>/skills/skills-registry.json \
CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev \
CLAWPERATOR_SOLAX_REPLAY_FORCE_FAILURE=1 \
<node_binary> <clawperator_root>/apps/node/dist/cli/index.js skills run com.solaxcloud.starter.set-discharge-to-limit-replay --device <device_serial> --percent 40
```

Expected forced-failure shape:

- `ok: false`
- `code: "SKILL_EXECUTION_FAILED"`
- non-zero `exitCode`
- preserved nested `clawperator exec --json` failure output on `stdout`
- `skillResult` is present with:
  - `status: "failed"`
  - `source.kind: "script"` injected by runtime, not emitted by the script
  - `save_completed.status: "failed"`
  - `terminalVerification.status: "not_run"`

Expected terminal-verification failure shape:

- the skill exits non-zero
- `skills run` surfaces `ok: false` with `code: "SKILL_EXECUTION_FAILED"`
- `stderr` includes `Terminal verification failed: expected discharge-to-limit ...`
- `skillResult` is present with:
  - `status: "failed"`
  - `terminal_state_verified.status: "failed"`
  - `terminalVerification.status: "failed"`
  - `terminalVerification.expected.text` set to `Discharge to <percent>%`
  - `terminalVerification.observed.text` set to the final row text actually read

Expected fallback-verification success shape:

- the first post-save verification path may fail with `No UI node found...`,
  `Timeout waiting for node matching...`, or a daemon proxy/result-envelope
  timeout
- the skill then reopens SolaX Cloud and re-reads the discharge row from a
  fresh session
- `skillResult.status` is `success`
- `terminalVerification.status` is `verified`
- `terminalVerification.method` is `fresh-session reread`
- `diagnostics.warnings` notes that the primary verification path failed and
  the fresh-session reread proved the final value

## Recording Context

This skill was scaffolded with recording context at `recording-context.json`.
Read that file to inspect the recorded interaction timeline and raw events.
The recording context is reference evidence, not an executable skill recipe.
An external agent or human author must write the reusable skill logic.

Usage:

```bash
node skills/com.solaxcloud.starter.set-discharge-to-limit-replay/scripts/run.js <device_id> [--percent <percent>|--limit <percent>|<percent>]
```
