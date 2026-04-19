# clawperator-skills

Skills repository for the Clawperator ecosystem.

Related runtime/API repository: [clawperator](https://github.com/clawperator/clawperator)

Canonical skills docs in the main repo:

- https://github.com/clawperator/clawperator/docs/skills/overview.md
- https://github.com/clawperator/clawperator/docs/skills/runtime.md
- https://github.com/clawperator/clawperator/docs/skills/authoring.md
- https://github.com/clawperator/clawperator/docs/skills/development.md

## What This Repo Is

This repository contains reusable skill packages for Android app workflows:

- skill metadata (`skill.json`)
- human-readable instructions (`SKILL.md`)
- deterministic wrappers/scripts (`scripts/*.sh`)
- optional deterministic artifacts (`artifacts/*.recipe.json`)

These skills are designed to be used by an LLM/agent through Clawperator, not by humans manually clicking through UI.

## Skill Categories

This repo now recognizes two categories of skills:

- `-replay`
  - replay-oriented or recording-derived skills
  - useful as deterministic baselines on known flows
- `-orchestrated`
  - agent-controlled skills intended to better reflect the Clawperator brain/hand model
  - these are the longer-term destination for richer checkpoints and verification behavior

Important current caveats:

- this split is a naming and authoring convention, not yet a machine-enforced runtime field
- some older skills predate the convention and still have unsuffixed ids
- an unsuffixed legacy skill should not be assumed to already be orchestrated

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
- `scripts/test_all.sh` canonical off-device `node --test` entrypoint.
- `scripts/install_blocked_terms_hook.sh` install local PII/device-term pre-commit hook.

## Local Authoring Entry Points

This pack keeps durable workflow and authoring docs in the main
`clawperator` repo under `docs/skills/`. While the final top-level routing is
still landing, use these truthful surfaces in this checkout:

- `AGENTS.md` - current local checklist seed and guardrails for runtime-skill authors.
- `scripts/test_all.sh` - canonical off-device test entrypoint for Node-based skill logic.
- `scripts/generate_skill_indexes.sh` - required registry and generated index refresh path.
- main-repo docs - canonical runtime and public contract references.

## Main Repo Docs Cross-Reference

- API overview: https://github.com/clawperator/clawperator/docs/api/overview.md
- API actions: https://github.com/clawperator/clawperator/docs/api/actions.md
- API devices: https://github.com/clawperator/clawperator/docs/api/devices.md
- API snapshot: https://github.com/clawperator/clawperator/docs/api/snapshot.md
- Setup guide: https://github.com/clawperator/clawperator/docs/setup.md
- Troubleshooting: https://github.com/clawperator/clawperator/docs/troubleshooting/operator.md

## Common Commands

```bash
# Regenerate registry and indexes
./scripts/generate_skill_indexes.sh

# Run colocated Node tests for off-device logic
./scripts/test_all.sh

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

Use `AGENTS.md` as the local hygiene checklist while the final durable routing
to main-repo docs is being finished.

## Privacy and Safety Rules

- Do not commit personal names.
- Do not commit device serials.
- Do not commit user-specific local identifiers.
- Use placeholders in docs/examples: `<person>`, `<device_serial>`, `<home_label>`.

## License

Apache 2.0

Copyright (c) 2026 Action Launcher Pty Ltd
