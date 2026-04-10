# AGENTS

## Purpose

This repository stores reusable Clawperator skill packages consumed by the Clawperator runtime.

Canonical runtime, API, and public skills docs live in the main repo:

- https://github.com/clawperator/clawperator/docs/skills/overview.md
- https://github.com/clawperator/clawperator/docs/skills/runtime.md
- https://github.com/clawperator/clawperator/docs/skills/authoring.md
- https://github.com/clawperator/clawperator/docs/skills/development.md
- https://github.com/clawperator/clawperator/docs/api/overview.md
- https://github.com/clawperator/clawperator/docs/api/actions.md

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

## Authoring and Maintenance Standards

1. Prefer robust selectors and explicit waits over timing assumptions.
2. Use fresh-session patterns where relevant (`close_app` then `open_app`).
3. Keep outputs machine-readable and stable for downstream agents.
4. Use placeholders for user-specific values and identifiers.
5. Keep scripts deterministic and narrowly scoped.
6. Document expected drift and fallback behavior in `SKILL.md`.
7. Never shorten `Clawperator` to `Claw` in code, docs, comments, or commit messages.

## Validation Checklist

1. Regenerate indexes:
   - `./scripts/generate_skill_indexes.sh`
2. Validate shell script syntax:
   - `find skills -type f -path '*/scripts/*.sh' -print0 | xargs -0 -n1 bash -n`
3. Verify placeholders are used for personal and device-specific values.
4. Install blocked-terms hook if needed:
   - `./scripts/install_blocked_terms_hook.sh`
5. Scan staged content for blocked terms:
   - `./scripts/scan_blocked_terms.sh`

## Privacy and Safety

- Never commit personal names in scripts, docs, or examples.
- Never commit local adb serials.
- Never commit user-specific labels when placeholders are possible.
- Use placeholders such as `<person>`, `<device_serial>`, and `<label>`.
- Local blocked terms policy: `docs/blocked-terms-policy.md`
