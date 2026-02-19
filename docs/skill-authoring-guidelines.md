# Skill Authoring Guidelines

Related runtime/API repository: [clawperator](https://github.com/clawcave/clawperator.git)

## Skill Package Shape

Required:

- `skills/<applicationId>.<intent>/skill.json`
- `skills/<applicationId>.<intent>/SKILL.md`
- `skills/<applicationId>.<intent>/scripts/*.sh`

Optional:

- `skills/<applicationId>.<intent>/artifacts/*.recipe.json`

Utilities:

- `skills/utils/<utility>/...`

## Authoring Rules

1. Keep scripts deterministic.
2. Keep scripts narrow in scope (one clear job).
3. Prefer stable selectors first (`resourceId` > generic text matching).
4. Add settle delays around transitions where UI is known to lag.
5. Document required env vars and defaults in `SKILL.md`.
6. Emit machine-readable output lines where practical.
7. Use absolute caution with shell quoting and payload construction.

## Reliability Practices

- Use fresh-app baseline when needed (`close_app` -> `open_app`).
- Add explicit waits before critical reads/clicks.
- Include fallback paths for common UI variants.
- Expect overlays/permission/update dialogs and handle or report them.

## Data and Privacy

- Never hardcode personal names.
- Never hardcode device serials.
- Never hardcode user-specific labels unless explicitly placeholder-driven.
- Use placeholders in artifacts/examples (`{{PERSON_NAME}}`, `<device_serial>`).

## Validation Checklist Before Commit

1. `./scripts/generate_skill_indexes.sh`
2. `find skills -type f -path '*/scripts/*.sh' -print0 | xargs -0 -n1 bash -n`
3. Run at least one realistic execution path (or clearly document blocker).
4. Confirm no blocked terms are present in staged changes.
5. Update docs if command/output contract changed.
