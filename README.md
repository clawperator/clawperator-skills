# clawperator-skills

Skills repository for the Clawperator ecosystem.

Related runtime/API repository: [clawperator](https://github.com/clawcave/clawperator.git)

## What This Repo Is

This repository contains reusable skill packages for Android app workflows:

- skill metadata (`skill.json`)
- human-readable instructions (`SKILL.md`)
- deterministic wrappers/scripts (`scripts/*.sh`)
- optional deterministic artifacts (`artifacts/*.recipe.json`)

These skills are designed to be used by an LLM/agent through Clawperator, not by humans manually clicking through UI.

## The Two-Handed Model (Critical)

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

## Authoring and Operations Docs

- `docs/usage-model.md` - how agents should use skills with Clawperator.
- `docs/skill-authoring-guidelines.md` - conventions and quality bar for new skills.
- `docs/device-prep-and-runtime-tips.md` - practical device/app prep and runtime reliability tips.
- `docs/skills-verification.md` - latest verification run summary.
- `docs/blocked-terms-policy.md` - shared blocked-terms hook and scan policy.

## First-Time Agent Quickstart (Settings App)

This demo is intentionally bare-bones and OEM-agnostic. It does not depend on any specific app UI beyond Android Settings (`com.android.settings`).

From this repo (direct skill run):

```bash
./skills/com.android.settings.capture-overview/scripts/capture_settings_overview.sh com.clawperator.operator.dev
```

Or from the `clawperator` repo (manual JSON execution + screenshot):

```bash
cd <clawperator_repo>
npm --prefix apps/node run build

DEVICE_ID="$(adb devices | awk 'NR>1 && $2==\"device\" {print $1; exit}')"
cat > /tmp/clawperator-settings-snapshot.json <<'JSON'
{
  "commandId": "settings-snapshot-001",
  "taskId": "settings-snapshot-001",
  "source": "quickstart",
  "timeoutMs": 90000,
  "actions": [
    { "id": "close", "type": "close_app", "params": { "applicationId": "com.android.settings" } },
    { "id": "open", "type": "open_app", "params": { "applicationId": "com.android.settings" } },
    { "id": "settle", "type": "sleep", "params": { "durationMs": 1800 } },
    { "id": "snap", "type": "snapshot_ui", "params": { "format": "ascii" } }
  ]
}
JSON

node apps/node/dist/cli/index.js execute \
  --device-id "$DEVICE_ID" \
  --receiver-package com.clawperator.operator.dev \
  --execution /tmp/clawperator-settings-snapshot.json \
  --output pretty

SCREENSHOT_PATH="/tmp/clawperator-settings-${DEVICE_ID}-$(date +%Y%m%d-%H%M%S).png"
adb -s "$DEVICE_ID" exec-out screencap -p > "$SCREENSHOT_PATH"
echo "SCREENSHOT_PATH=$SCREENSHOT_PATH"
```

What to expect:

- Command succeeds with canonical terminal source (`clawperator_result`).
- Output includes Settings UI text/headings as seen on that device.
- ADB screenshot is captured and returned as an absolute path for multimodal interpretation.
- The LLM/agent should interpret this output and decide next command(s).

## Extra LLM Training Signals (Recommended)

- Correlate `commandId`/`taskId` with outputs so retries stay deterministic.
- Treat non-zero exits and warning lines as first-class signals.
- Prefer bounded retries with observation between attempts over blind repetition.
- Return both extracted text and screenshot path in user-facing responses when confidence is low.

## Common Commands

```bash
# Regenerate registry and indexes
./scripts/generate_skill_indexes.sh

# Validate shell script syntax quickly
find skills -type f -path '*/scripts/*.sh' -print0 | xargs -0 -n1 bash -n
```

## Local Privacy Pre-Commit Hook

This repo shares a blocked-terms file with `clawperator`:

1. Optional: populate `../.clawcave/blocked-terms.txt` (sibling to this repo) with one forbidden term per line.
2. Install hook:

```bash
mkdir -p ../.clawcave
cp ./blocked-terms.txt.example ../.clawcave/blocked-terms.txt
./scripts/install_blocked_terms_hook.sh
./scripts/scan_blocked_terms.sh
```

Details: `docs/blocked-terms-policy.md`

## Privacy and Safety Rules

- Do not commit personal names.
- Do not commit device serials.
- Do not commit user-specific local identifiers.
- Use placeholders in docs/examples: `<person>`, `<device_serial>`, `<home_label>`.
