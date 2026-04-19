# AGENTS

## Purpose

This repository stores reusable Clawperator skill packages consumed by the Clawperator runtime.

Canonical runtime, API, and public skills docs live in the main repo:

- [Overview](https://github.com/clawperator/clawperator/blob/main/docs/skills/overview.md)
- [Runtime](https://github.com/clawperator/clawperator/blob/main/docs/skills/runtime.md)
- [Authoring](https://github.com/clawperator/clawperator/blob/main/docs/skills/authoring.md)
- [Development workflow](https://github.com/clawperator/clawperator/blob/main/docs/skills/development.md)
- [API overview](https://github.com/clawperator/clawperator/blob/main/docs/api/overview.md)
- [API actions](https://github.com/clawperator/clawperator/blob/main/docs/api/actions.md)

Use those pages as source of truth when behavior, contracts, or terminology are in question.

## Required Mental Model

Skills are deterministic execution aids, not reasoning engines.

- Clawperator runtime + skill scripts handle execution and output capture.
- LLM/agent systems handle planning, interpretation, retries, and fallback decisions.

Do not put autonomous business logic into skill wrappers.

## Skill Categories

Current authoring work distinguishes two categories of skills:

- `-replay`:
  - replay-oriented or recording-derived skills
  - acceptable as deterministic baselines, especially for known stable UI paths
- `-orchestrated`:
  - agent-controlled skills intended to align more closely with the Clawperator brain/hand model
  - expected to grow stronger checkpoint, verification, and result-shaping behavior over time

Notes:

- this is currently a naming and documentation convention, not a registry-enforced type field
- legacy skills may still be unsuffixed
- do not infer that an unsuffixed legacy skill is already orchestrated

## Scope and Structure

- Metadata: `skills/**/skill.json`
- Instructions: `skills/**/SKILL.md`
- Wrappers/scripts: `skills/**/scripts/*`
- Optional artifacts: `skills/**/artifacts/*.recipe.json`
- Utility skills: `skills/utils/**`

## Current Author Route

The durable workflow and authoring docs for runtime skills live in the main
`clawperator` repo under `docs/skills/`. Use this route when authoring or
hardening a runtime skill in this repo:

1. Start with [Authoring](https://github.com/clawperator/clawperator/blob/main/docs/skills/authoring.md) for the durable workflow and runtime contract.
2. Use [Development workflow](https://github.com/clawperator/clawperator/blob/main/docs/skills/development.md) for the local scaffold-edit-validate-run loop.
3. Read this file for the local checklist seed, repo conventions, and recurring review failures.
4. Run `./scripts/test_all.sh` for off-device Node tests when the skill adds or changes pure JS logic.
5. Run `./scripts/generate_skill_indexes.sh` whenever registry-linked metadata changes.
6. Use `skill-migration.md` only as a migration and audit log, not as the primary contribution guide.

Structure and testing model:

- Keep `scripts/run.js` thin when possible.
- Extract testable off-device logic into importable modules under
  `skills/**/scripts/` or `skills/utils/`.
- Colocate `*.test.js` files where `./scripts/test_all.sh` can discover them.
- Live-device proof still applies to selector, navigation, recording,
  checkpoint, compare-baseline, and terminal-verification changes.

## Seed Authoring Guardrails

These rules are the highest-value findings migrated from the local drafting
findings and recent PR hardening work. They are mandatory even before the full
checklist lands.

### Verification

- Keep `contract.verification` truthful. Declare a verification kind only when
  the wrapper can actually prove it through the runtime's matcher path.
- If the proof path is indirect, screenshot-based, heuristic, or still
  uncertain, use `verification: null` instead of overstating certainty.
- Do not let a post-action verification miss rewrite a healthy app run into a
  misleading runtime failure.

### Generated Index Drift

- Any skill add, rename, remove, or metadata change that affects
  `skills/skills-registry.json` must regenerate the generated index outputs in
  the same change.
- Treat `./scripts/generate_skill_indexes.sh` as the only supported refresh
  path for `skills/generated/*`.

### Shared Helper Usage

- Prefer shared helpers from `skills/utils/common.js` instead of local ad hoc
  resolution logic.
- Use `resolveClawperatorBin` for CLI invocation and `resolveOperatorPackage`
  for operator-package resolution when those helpers fit the job.
- Do not duplicate shared precedence logic in a new skill unless there is a
  clear, documented reason.

### Diagnostic Truthfulness

- Success diagnostics must describe only files, directories, and runtime state
  that still exist when the message is emitted.
- Failure diagnostics must not inherit stale success state from an earlier
  branch.
- Cleanup should be best-effort across success and failure paths and must not
  corrupt the primary reported outcome.
- Do not unwrap raw stdout or stderr blobs directly into `error.message`.

### Parser And Image Robustness

- Prefer explicit named flags over positional fallbacks. Positional parsing must
  skip tokens that belong to named options.
- Keep parser logic narrow, testable, and defensive around malformed input.
- Validate screenshot or image dimensions and pixel data before classification.
- Guard crop and averaging math against empty regions and division by zero.
- Numeric, price, and entity decoders must cover the real domain range and the
  common HTML entity forms they claim to support.

### Privacy Hygiene

- Privacy rules apply equally to code, examples, validation notes, PR bodies,
  commit messages, and retained artifacts.
- Never commit personal names, device serials, local paths, or user-specific
  labels when placeholders are possible.
- Use placeholders such as `<person>`, `<device_serial>`, `<label>`, and
  `<local_user>`.

## Authoring and Maintenance Standards

1. Prefer robust selectors and explicit waits over timing assumptions.
2. Use fresh-session patterns where relevant (`close_app` then `open_app`).
3. Keep outputs machine-readable and stable for downstream agents.
4. Use placeholders for user-specific values and identifiers.
5. Keep scripts deterministic and narrowly scoped.
6. Document expected drift and fallback behavior in `SKILL.md`.
7. Prefer shared helpers and extracted testable modules over duplicated wrapper logic.
8. Never shorten `Clawperator` to `Claw` in code, docs, comments, or commit messages.

## Validation Checklist

1. Regenerate indexes:
   - `./scripts/generate_skill_indexes.sh`
2. Run off-device Node tests for pure JS helper, parser, normalizer, or output-shaping changes:
   - `./scripts/test_all.sh`
3. Validate shell script syntax:
   - `find skills -type f -path '*/scripts/*.sh' -print0 | xargs -0 -n1 bash -n`
4. Verify placeholders are used for personal and device-specific values.
5. Install blocked-terms hook if needed:
   - `./scripts/install_blocked_terms_hook.sh`
6. Scan staged content for blocked terms:
   - `./scripts/scan_blocked_terms.sh`

## Privacy and Safety

- Never commit personal names in scripts, docs, or examples.
- Never commit local adb serials.
- Never commit user-specific labels when placeholders are possible.
- Use placeholders such as `<person>`, `<device_serial>`, and `<label>`.
- Local blocked terms policy file: `~/.clawperator/blocked-terms.txt`
