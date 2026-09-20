# Settings observation recovery validation

PR1 validation, 2026-09-20. Scope is the Settings examples in this repository.
Core extraction diagnostics and canonical documentation remain separate PR2 work.
The underlying malformed XML cause is still unknown.

## Revisions and environment

- Skills starting revision: `9204724` (clean `main` before the new branch).
- Core checkout: `7b8e3976bfb89141715feeaf5556d582981ea52b`.
- All device commands used that checkout's local `apps/node/dist/cli/index.js`,
  version `0.12.0`, with compatible installed Operator `0.12.0-d`.
- Runtime model: `gpt-6-astra`, high effort. Successful runs selected the already
  installed Codex `0.155.0-alpha.9.2` executable.
- Device aliases: emulator and physical Android phone. Serial numbers and local
  paths remain only in ignored evidence. No other controller was running on the
  selected devices; runs were serialized on each device.
- Fresh provider disclosure and use of connected devices were explicitly
  authorized for this validation. Historical approval was not reused.

Exact source hashes, selected executable, device identity, run identity, command
responses and timing are retained in each local run's metadata and event ledger.
Early runs preceded the final diagnostic-summary hardening; the final injected
run uses the final source hashes. Raw artifacts remain ignored under
`.tmp/pr1-validation/`; they are not public fixtures or portable documentation.

## Local checks

- Baseline: 120 tests passed.
- Final `./scripts/test_all.sh`: 133 tests passed.
- Both affected skill dry-run validators passed using the local core build and
  this checkout's registry.
- Generated indexes refreshed through `./scripts/generate_skill_indexes.sh`.
- All-skills dry-run validation: 25/27, unchanged from baseline. The only failures
  are missing skill-type frontmatter in `com.android.settings.capture-overview`
  and `utils.show-android-device`. These unrelated skills were not changed.
- No shell files changed, so shell syntax validation is not applicable.
- Whitespace and the standalone blocked-terms scan passed. The installed
  pre-commit entrypoint skipped its check because the shared hook executable was
  absent; the explicit post-commit scan checked the committed tree instead.

Regression coverage includes the exact nested failed-step error shape, explicit
outer-error precedence, safe optional diagnostics, absent/unparseable envelopes,
spawn/signal/timeout classification, capped child deadlines, child-local logs,
logging setup and later write failures, both stale candidate menus, provider
rejection before action, preserved collected fields, one read-only recovery,
repeated failure, excluded failure categories, persistent budgets and unchanged
independent final-evidence checks.

## Device evidence

| Scenario | Result |
| --- | --- |
| Codex-only, emulator | Passed; both values independently verified |
| Codex-only, physical phone | Passed; overlay visually reviewed; both values independently verified |
| Jev, physical phone resumed on completed page | Passed; no provider decision needed |
| Jev, physical phone after fresh Settings launch | Passed; eight provider decisions; both values independently verified |
| Jev, emulator after fresh Settings launch | Truthful failure after choosing System and reaching no progress; no terminal success claimed |
| Jev, emulator with injection after fresh launch | Recovery passed; later System navigation reached the same truthful task failure |
| Jev, emulator starting on observed About page, with injection | Passed recovery and independently verified final values |
| Final-source Jev, emulator starting on observed About page, with injection | Passed recovery and independently verified final values |

The injected cases replace one successful post-scroll live snapshot response with
an explicitly labeled synthetic `SNAPSHOT_EXTRACTION_FAILED` / `malformed_xml`
failure. The original successful response is retained separately. This proves
recovery behavior, not reproduction of malformed source or its cause. Between the
failed snapshot and the new capture, commands were only screenshot/snapshot
acquisition. No scroll was replayed by recovery. Original failed envelopes remain
in the final retained sequence. Recovery count is one per run.

All runs reaching device execution established writable logs in the actual
nested child sandbox. Their event records identify the effective child-local
logging destination, readiness check and existing diagnostic files. The inherited
parent log destination remained separate. Controlled off-device tests cover
unavailable setup and a later logger write failure without changing the primary
command result.

Independent verification was rerun outside the runtime agent against retained
snapshot/read-value envelopes, identities, value references, final screenshots
and result receipts. Final images were also visually reviewed. Exact values stay
in local evidence, not in this report. Recovery acquisition timing, provider
request timing and full-run timing are recorded separately; none is reported as
another measurement.

## Retained limitations and failures

Two initial attempts failed before any device command because the default PATH
selected Codex `0.147.0`, which the provider rejected for the requested model.
Those attempts remain retained. A first candidate emulator failed CLI/Operator
compatibility and was not used; no software or device permissions were changed.

The emulator's fresh-launch Jev route can choose System before About is visible.
The current candidate menu does not offer a return action there. That navigation
policy is outside this error/recovery change. The successful About-page scenario
is explicitly a different starting condition and does not prove the root route.

No genuine malformed XML failure occurred in this cohort. Optional PR2 diagnostics
are accepted through a bounded allowlist, but the absent PR2 implementation is not
claimed as validated. Cross-repository closeout remains PR2 follow-up work.
