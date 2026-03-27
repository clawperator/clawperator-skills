# clawperator-skills

Skills repository for the Clawperator ecosystem.

Related runtime/API repository: [clawperator](https://github.com/clawperator/clawperator)

Canonical skills docs in the main repo:

- https://github.com/clawperator/clawperator/blob/main/docs/skills/overview.md
- https://github.com/clawperator/clawperator/blob/main/docs/skills/runtime.md
- https://github.com/clawperator/clawperator/blob/main/docs/skills/authoring.md
- https://github.com/clawperator/clawperator/blob/main/docs/skills/development.md

## What This Repo Is

This repository contains reusable skill packages for Android app workflows:

- skill metadata (`skill.json`)
- human-readable instructions (`SKILL.md`)
- deterministic wrappers/scripts (`scripts/*.sh`)
- optional deterministic artifacts (`artifacts/*.recipe.json`)

These skills are designed to be used by an LLM/agent through Clawperator, not by humans manually clicking through UI.

## Brain and Hand Model

Clawperator workflows are intentionally split into two roles:

1. Clawperator runtime + skills (execution hand):
   - Executes commands as reliably as possible.
   - Uses Android accessibility APIs.
   - Captures/logs output and returns machine-readable results.
   - Does **not** do business reasoning.

2. LLM/agent (reasoning hand):
   - Chooses what to run next.
   - Interprets results/screenshots.
   - Handles drift (feature flags, experiments, popups, permission dialogs, update prompts).
   - Decides when to retry, fallback, or escalate.

Skills are guides and accelerators. They are not guaranteed truth forever because app UIs evolve.

## Intended vs Not Intended

Intended:

- Deterministic, reusable app interactions with clear outputs.
- Skill packaging that helps agents run known workflows quickly.
- Fast iteration when selectors/parsing need updates.

Not intended:

- Autonomous planning inside scripts.
- Encoding product/business decisions into skills.
- Assuming UI is static across devices/builds/accounts.
- Treating a skill result as correct without agent-side verification.

## Repository Layout

- `skills/<applicationId>.<intent>/...` app-specific skills.
- `skills/utils/<utility>/...` utility skills.
- `skills/skills-registry.json` generated canonical registry.
- `skills/generated/` generated indexes (selected summary files committed).
- `scripts/generate_skill_indexes.sh` regenerate registry/index artifacts.
- `scripts/install_blocked_terms_hook.sh` install local PII/device-term pre-commit hook.
- `docs/` supporting guidance for agent operators and skill authors.

## Docs in This Repo

- `docs/usage-model.md` - how agents should use skills with Clawperator.
- `docs/skill-development-workflow.md` - shortest path from exploration to a reusable skill.
- `docs/skill-authoring-guidelines.md` - conventions and quality bar for new skills.
- `docs/device-prep-and-runtime-tips.md` - practical device/app prep and runtime reliability tips.
- `docs/blocked-terms-policy.md` - shared blocked-terms hook and scan policy.

## Main Repo Docs Cross-Reference

- API overview: https://github.com/clawperator/clawperator/blob/main/docs/api/overview.md
- API actions: https://github.com/clawperator/clawperator/blob/main/docs/api/actions.md
- API devices: https://github.com/clawperator/clawperator/blob/main/docs/api/devices.md
- API snapshot: https://github.com/clawperator/clawperator/blob/main/docs/api/snapshot.md
- Setup guide: https://github.com/clawperator/clawperator/blob/main/docs/setup.md
- Troubleshooting: https://github.com/clawperator/clawperator/blob/main/docs/troubleshooting/operator.md

## Common Commands

```bash
# Regenerate registry and indexes
./scripts/generate_skill_indexes.sh

# Validate shell script syntax quickly
find skills -type f -path '*/scripts/*.sh' -print0 | xargs -0 -n1 bash -n
```

## Local Privacy Pre-Commit Hook

This repo shares a user-scoped blocked-terms file with `clawperator`.

1. Optional: populate `~/.clawperator/blocked-terms.txt` with one forbidden term per line.
2. Install hook:

```bash
mkdir -p ~/.clawperator
cp ./blocked-terms.txt.example ~/.clawperator/blocked-terms.txt
./scripts/install_blocked_terms_hook.sh
./scripts/scan_blocked_terms.sh
```

Details: `docs/blocked-terms-policy.md`

## Privacy and Safety Rules

- Do not commit personal names.
- Do not commit device serials.
- Do not commit user-specific local identifiers.
- Use placeholders in docs/examples: `<person>`, `<device_serial>`, `<home_label>`.

## License

Apache 2.0

Copyright (c) 2026 Action Launcher Pty Ltd
