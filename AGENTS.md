# AGENTS

## Purpose

This repository stores reusable Clawperator skill packages consumed by the
Clawperator runtime.

Canonical runtime, API, and durable public skills docs live in the main repo:

- [Overview](https://github.com/clawperator/clawperator/blob/main/docs/skills/overview.md)
- [Runtime](https://github.com/clawperator/clawperator/blob/main/docs/skills/runtime.md)
- [Authoring](https://github.com/clawperator/clawperator/blob/main/docs/skills/authoring.md)
- [Development workflow](https://github.com/clawperator/clawperator/blob/main/docs/skills/development.md)
- [API overview](https://github.com/clawperator/clawperator/blob/main/docs/api/overview.md)
- [API actions](https://github.com/clawperator/clawperator/blob/main/docs/api/actions.md)

Use those pages as the source of truth for runtime contracts, CLI behavior, and
terminology. Use this file as the local author checklist and PR-hardening bar
for runtime skills in `clawperator-skills`.

## Required Mental Model

Skills are deterministic execution aids, not reasoning engines.

- Clawperator runtime plus skill scripts handle execution, checkpoints, and
  output capture.
- LLM or agent systems handle planning, interpretation, retries, and fallback
  decisions.

Do not put autonomous business logic into skill wrappers.

## Skill Categories

Current authoring work distinguishes two active skill categories:

- `replay`
  - replay-oriented or recording-derived skills
  - acceptable as deterministic baselines, especially for known stable UI paths
- `orchestrated`
  - agent-controlled skills intended to align more closely with the Clawperator
    brain/hand model
  - expected to carry stronger checkpointing, verification discipline, and
    result-shaping behavior over time

These names are `clawperator-skill-type` frontmatter values. They do not rename
skill IDs or folders, and the existing `*-replay` / `*-orchestrated` suffix
convention still describes the common skill-id shape where authors use it.

Current local rules:

- declare `clawperator-skill-type` in `SKILL.md` frontmatter
- use `replay` or `orchestrated` for new and updated work
- one legacy compatibility exception still exists for
  `au.com.polyaire.airtouch5.set-zone-state` with `script`
- do not copy the legacy `script` type into new work

## Scope and Structure

- Metadata: `skills/**/skill.json`
- Instructions: `skills/**/SKILL.md`
- Wrappers and scripts: `skills/**/scripts/*`
- Optional artifacts: `skills/**/artifacts/*.recipe.json`
- Utility helpers and tests: `skills/utils/**`

## Current Author Route

Use this route when authoring or hardening a runtime skill in this repo:

1. Start with [Authoring](https://github.com/clawperator/clawperator/blob/main/docs/skills/authoring.md) for the durable workflow, validator boundary, and host-visible discovery surface.
2. Use [Development workflow](https://github.com/clawperator/clawperator/blob/main/docs/skills/development.md) for the local scaffold-edit-validate-run loop.
3. Use this file for the local checklist, testing matrix, and recurring PR failure patterns.
4. Use `clawperator authoring-skills list --json` when you need to inspect installed guided authoring workflows on the current host.
5. If runtime-skill discovery found no clear match, start with `skill-author-by-agent-discovery` as the zero-results front door.
6. Use `skill-author-by-recording` only after discovery returns `proceed_to_recording`, or when the route is already well understood.
7. Use `clawperator skills new <skill_id>` only when you explicitly want the low-level manual scaffold.
8. Run `clawperator skills validate <skill_id> --dry-run`.
9. Run `./scripts/test_all.sh` for off-device `node --test` coverage when the change touches pure JS logic.
10. Run shell syntax checks for skill wrapper scripts under
   `skills/**/scripts/*.sh`, and also for top-level `scripts/*.sh` when those
   repo tooling scripts change.
11. Run `./scripts/generate_skill_indexes.sh` whenever registry-linked metadata changes.
12. Prove UI behavior with live-device proof on a real target device or emulator when the change affects selectors, navigation, recording, checkpoints, compare-baseline, or terminal verification.
13. Use `skill-migration.md` only as a migration and audit log, not as the primary contribution guide.

## Testing Matrix

Use this matrix before opening a PR.

| Change shape | Add or update colocated `*.test.js` | Run `./scripts/test_all.sh` | Run shell syntax checks | Run `clawperator skills validate <skill_id> --dry-run` | Run `./scripts/generate_skill_indexes.sh` | Live-device proof |
| --- | --- | --- | --- | --- | --- | --- |
| Pure JS parser, normalizer, helper, decoder, or output-shaping logic under `skills/**/scripts/*.js` or `skills/utils/*.js` | Yes | Yes | No | Yes | Only if registry-linked metadata changed | Only if the behavior also affects a real UI path |
| `scripts/run.js` orchestration changes that only rewire existing helpers | Usually, if any off-device behavior changed | Yes | No | Yes | Only if registry-linked metadata changed | Yes when the orchestration changes selector, navigation, checkpoint, compare-baseline, or terminal-verification behavior |
| `skills/**/scripts/*.sh` wrapper changes | When the shell wrapper also changes JS-callable logic | When any JS module changed | Yes | Yes | Only if registry-linked metadata changed | Yes when the wrapper changes runtime behavior on device |
| `skill.json`, `SKILL.md`, or registry-linked metadata changes | Only when the metadata change also changes JS behavior | Only when JS behavior changed | Only when shell wrappers changed | Yes | Yes when `skills/skills-registry.json` or generated outputs are affected | Only when the metadata change alters user-visible runtime behavior |
| Selector, navigation, recording, checkpoint, compare-baseline, or terminal-verification changes | Yes when any off-device helper logic changed | Yes when any JS logic changed | Yes when shell wrappers changed | Yes | Only if registry-linked metadata changed | Yes, always |

Interpretation rules:

- `./scripts/test_all.sh` is the canonical off-device entrypoint. Do not invent
  ad hoc one-off `node --test` commands in PR notes when a colocated
  `*.test.js` can run through the repo entrypoint.
- Shell syntax checks do not replace JS tests.
- `clawperator skills validate <skill_id> --dry-run` is the static gate, not
  the full proof story.
- Live-device proof is still mandatory for UI behavior, even when the static
  gate and off-device tests pass.

## Mechanical Guardrails Versus Author Checklist

These categories are intentionally different.

Mechanically enforced by `clawperator skills validate` in the main repo:

- required file presence and registry parity
- `clawperator-skill-type` frontmatter presence and allowed values
- generated-index freshness when the validated repo includes
  `scripts/generate_skill_indexes.sh`
- artifact payload validation under `--dry-run`

Still checklist-only and must be reviewed by the author:

- truthful declared verification
- correct use of shared helpers instead of duplicated local resolution logic
- diagnostic truthfulness across success, failure, and cleanup paths
- parser ambiguity and parser robustness concerns
- privacy hygiene in code, examples, retained artifacts, validation notes, PR
  bodies, and commit messages
- whether `scripts/run.js` stayed thin enough or needs extracted modules

If a rule is checklist-only, passing `clawperator skills validate` does not prove it.

## Structure Rule: Keep `run.js` Thin

Use `scripts/run.js` as thin orchestration whenever practical.

Preferred structure:

- `scripts/run.js` gathers inputs, calls shared helpers, invokes the runtime,
  and shapes the final result
- parser, normalizer, decoder, and image or numeric helper logic live in
  importable modules under `skills/**/scripts/` or `skills/utils/`
- colocated `*.test.js` files sit next to those modules so `node --test`
  discovery works through `./scripts/test_all.sh`

Use these in-repo examples as the pattern:

- `skills/utils/common.test.js`
- `skills/com.amazon.mShop.android.shopping.search-products/scripts/amazon_parser.test.js`

Negative example:

- Bad: a large `scripts/run.js` that inlines CLI resolution, HTML decoding,
  argument parsing, image math, and result shaping in one file with no
  importable tests.
- Better: `scripts/run.js` orchestrates small helpers, and each helper that can
  run off-device has a colocated `*.test.js`.

## Recurring Failure Patterns And Negative Examples

These are the durable local rules extracted from repeated PR review comments.

### Verification drift

Rules:

- Declared `contract.verification` must match the actual proof path.
- Use `verification: null` when the real proof is screenshot-based, heuristic,
  indirect, or still uncertain.
- Do not rewrite a healthy app run into a misleading runtime failure just
  because a later proof step missed.

Negative example:

- Bad: declare `node_text_matches` even though the wrapper really proves the
  outcome from a screenshot color heuristic and a human-readable summary line.
- Better: either add a real matcher-backed proof path or keep
  `verification: null`.

### Generated index drift

Rules:

- Any add, rename, remove, or metadata change that affects
  `skills/skills-registry.json` must regenerate `skills/generated/*` in the
  same change.
- Treat `./scripts/generate_skill_indexes.sh` as the only supported refresh
  path.

Negative example:

- Bad: edit `skills/skills-registry.json`, adjust a skill folder, and open the
  PR without refreshing generated shards.
- Better: run `./scripts/generate_skill_indexes.sh` before the PR and commit
  the resulting generated outputs in the same change.

### Shared helper bypass

Rules:

- Prefer shared helpers from `skills/utils/common.js` over copied local
  precedence logic.
- Use `resolveClawperatorBin` for CLI invocation and
  `resolveOperatorPackage` for operator-package resolution when those helpers
  fit the job.

Negative example:

- Bad: hardcode `"clawperator"` or re-implement operator-package precedence in
  a new wrapper.
- Better: import the shared helper and keep local glue code focused on the
  skill's app-specific behavior.

### Public example namespace drift

Rules:

- Public `SKILL.md` invocation examples should prefer the default release
  operator-package path.
- Do not add `com.clawperator.operator.dev` or other debug or dev package names
  to normal user-facing examples unless the document is explicitly debug-only.
- If an override must be mentioned for completeness, describe it generically as
  `[operator_package]` or `<operator_package>` instead of naming a dev package.

Negative example:

- Bad: add `com.clawperator.operator.dev` to a normal `SKILL.md` wrapper or env
  example for routine usage.
- Better: keep the public example on the default path, and if needed document
  the override shape with a placeholder only.

### Diagnostics Truthfulness

Rules:

- Success diagnostics must only describe files, directories, and runtime state
  that still exist when the message is emitted.
- Failure diagnostics must not inherit stale success state.
- Distinguish runtime failure from post-action verification failure.
- Cleanup should be best-effort across success and failure paths and must not
  corrupt the primary reported outcome.
- Bound stderr and stdout context instead of dumping raw blobs into
  `error.message`.

Negative examples:

- Bad: emit a success note that names a temp file after deleting that file.
- Bad: keep a stale "skill completed successfully" message in a branch that now
  returns a failure after verification misses.
- Bad: assign raw child-process stderr directly to `error.message`.
- Better: report only state that is still true, keep cleanup secondary, and
  summarize subprocess failure output without flooding the primary error field.

### Parser ambiguity and robustness

Rules:

- Explicit named flags win over positional fallbacks.
- Positional parsers must skip tokens that belong to named flags.
- Validate image dimensions and pixel data before classification.
- Guard crop and averaging math against empty regions and division by zero.
- Numeric and price parsers must cover the full digit range the real domain
  requires.
- HTML entity decoders must cover the common forms they claim to support, such
  as `&apos;`, `&#39;`, `&#x27;`, and `&amp;`.

Negative examples:

- Bad: treat `--device` or another named flag value as a positional input.
- Bad: accept a PNG header with zero width or zero height.
- Bad: average an empty crop region and divide by zero.
- Bad: parse only three digits from a four-digit price or ignore `&#39;`.
- Better: keep parsing narrow, explicit, defensive, and covered by colocated
  tests.

### Privacy Hygiene

Rules:

- Privacy scrubbing applies to code, examples, retained artifacts, validation
  notes, PR bodies, and commit messages equally.
- Never commit personal names, local paths, device serials, or user-specific
  labels when placeholders are possible.
- Use placeholders such as `<person>`, `<device_serial>`, `<label>`, and
  `<local_user>`.

Negative examples:

- Bad: paste a real bedroom label, adb serial, or home-directory path into a
  code comment, screenshot note, PR body, or commit message.
- Better: replace every user-specific identifier with a placeholder before the
  change leaves your machine.

## PR-Hardening Lessons

These numbered lessons are the short checklist form of the recurring patterns
above. They are all active rules in this repo.

1. Declared `contract.verification` kind must match the actual proof path; use
   `null` when unsure.
2. Regenerate `skills/generated/*` whenever `skills/skills-registry.json`
   changes, in the same commit.
3. Use shared helpers (`resolveOperatorPackage`, `resolveClawperatorBin`)
   instead of duplicating resolution logic.
4. Success diagnostics must not reference files, directories, or runtime states
   that are no longer true at emit time.
5. Failure diagnostics must not inherit stale success state; distinguish
   runtime failure from post-action verification failure.
6. Explicit named flags win over positional fallbacks; positional parsers skip
   tokens that belong to named flags.
7. Cleanup behavior must be best-effort across both success and failure paths,
   and must not corrupt the primary reported outcome.
8. Image decoders must validate dimensions and pixel data before classification;
   reject zero width or height.
9. Crop and averaging math must guard against empty regions and division by
   zero.
10. Numeric and price parsers must cover the full digit range the domain
    requires; do not truncate.
11. HTML entity decoders must cover the common set they claim to support.
12. Error messages must not unwrap raw stdout or stderr into `error.message`;
    bound the payload.
13. Privacy scrubbing applies to code, examples, validation notes, PR bodies,
    and commit messages equally.

## Validation Checklist

Run the checks that match the change:

1. Static gate:
   - `clawperator skills validate <skill_id> --dry-run`
2. Off-device Node tests for pure JS helper, parser, normalizer, decoder, or
   output-shaping changes:
   - `./scripts/test_all.sh`
3. Shell syntax checks for wrappers and repo tooling scripts:
   - `find skills -type f -path '*/scripts/*.sh' -print0 | xargs -0 -n1 bash -n`
   - `find scripts -maxdepth 1 -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n`
4. Registry and generated-index refresh when registry-linked metadata changes:
   - `./scripts/generate_skill_indexes.sh`
5. Blocked-terms hook and scan when privacy-sensitive edits are in play:
   - `./scripts/install_blocked_terms_hook.sh`
   - `./scripts/scan_blocked_terms.sh`
6. Live-device proof on the real target surface when UI behavior changed:
   - run the skill on a physical device or emulator and verify the claimed
     selector, navigation, checkpoint, compare-baseline, or terminal behavior

## Privacy and Safety

- Never commit personal names in scripts, docs, validation notes, PR bodies, or
  examples.
- Never commit local adb serials.
- Never commit user-specific labels when placeholders are possible.
- Never shorten `Clawperator` to `Claw` in code, docs, comments, or commit
  messages.
- Local blocked-terms policy file: `~/.clawperator/blocked-terms.txt`
