# AGENTS

## Purpose

This repository stores Clawperator skill packages that LLM/agent systems can run through the Clawperator runtime.

Runtime/API source of truth: [clawperator](https://github.com/clawperator/clawperator.git)

## Required Mental Model

Skills are execution aids, not reasoning engines.

- Clawperator + skill scripts: deterministic execution and output capture.
- LLM/agent: interpretation, planning, retries, fallback logic, and final decisions.

Do not put agentic/business logic in skill scripts.

## Scope and Structure

- Metadata: `skills/**/skill.json`
- Instructions: `skills/**/SKILL.md`
- Wrappers/scripts: `skills/**/scripts/*`
- Optional artifacts: `skills/**/artifacts/*.recipe.json`
- Utility skills: `skills/utils/**`

## Authoring Standards

1. Prefer robust selectors and explicit waits over brittle timing assumptions.
2. Use fresh-session pattern where relevant (`close_app` then `open_app`).
3. Keep outputs machine-readable and stable.
4. Use placeholders for user-specific values; never hardcode personal/device identifiers.
5. Keep scripts deterministic and narrowly scoped.
6. Expect UI drift and document fallback behavior in `SKILL.md`.

## Pre-commit Checklist

1. Regenerate indexes:
   - `./scripts/generate_skill_indexes.sh`
2. Validate shell syntax:
   - `find skills -type f -path '*/scripts/*.sh' -print0 | xargs -0 -n1 bash -n`
3. Confirm no PII-like literals are introduced:
   - no family/member names
   - no device serials
   - no personal/local identifiers
4. Ensure blocked-terms hook is installed:
   - `./scripts/install_blocked_terms_hook.sh`
5. Scan committed content for blocked terms:
   - `./scripts/scan_blocked_terms.sh`

## Privacy and Safety

- Never commit personal names in scripts/docs/examples.
- Never commit local adb serials.
- Never commit user-specific local labels when placeholders are possible.
- Use placeholders (`<person>`, `<device_serial>`, `<label>`) in examples.
- Blocked-terms policy and setup: `docs/blocked-terms-policy.md`

## Companion Docs

- `README.md`
- `docs/usage-model.md`
- `docs/skill-authoring-guidelines.md`
- `docs/device-prep-and-runtime-tips.md`
- `docs/skills-verification.md`
