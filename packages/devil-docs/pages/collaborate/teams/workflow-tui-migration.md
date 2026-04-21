---
title: "Workflow TUI Migration Guide"
description: "Guide for users migrating from the old workflow-tui to Team Orchestrator"
---

# Workflow TUI Migration Guide

This guide covers changes introduced in Phase 5–10 of the devil Code Team Orchestrator. If you were using an earlier version of the workflow TUI or legacy team config format, follow the steps below to migrate.

## What Changed

### Team config format

The legacy team config was a flat JSON object with five hard-coded presets. The new **Canonical Team Config** is a structured schema with named roles, routing strategy, and per-role settings.

| Old field | New location |
| --- | --- |
| `preset` | Replaced by `quickstart` templates (see below) |
| `roles` (flat array) | `teamConfig.roles` (keyed by position name) |
| `concurrency` (number) | `teamConfig.roles.<name>.maxConcurrent` |
| `provider` (global) | `teamConfig.roles.<name>.provider` |
| `model` (global) | `teamConfig.roles.<name>.model` |

### File locations

| Artifact | Old path | New path |
| --- | --- | --- |
| Workflow state | `.workflow/state.json` | `.planning/STATE.md` |
| Phase context | `.workflow/phases/` | `.planning/phases/<phase>/` |
| Plans | `.workflow/plans/` | `.planning/phases/<phase>/plans.json` |
| Event log | (none) | `.planning/events/` |
| Lessons | (none) | `.planning/lessons/` |

### Command changes

| Old command | New command | Notes |
| --- | --- | --- |
| `/run plan` | `plan` | Type directly in workflow prompt |
| `/run build` | `build` | |
| `/run review` | `review` | |
| `/next-stage` | `next` | Follows configured DAG |
| `/approve-plan` | `approve` | |
| `/revise-plan` | `revise` | |
| (none) | `team swap <pos> <provider> <model>` | Phase 10: live position swap |
| (none) | `team export <path>` | Phase 6: export team config |
| (none) | `team import <path>` | Phase 6: import team config |
| (none) | `team publish <path> --name=... --version=...` | Phase 8: publish signed manifest |
| (none) | `team install <url-or-path>` | Phase 8: install from registry |

## Preset Mapping

The old workflow TUI shipped five built-in presets. Each maps to a quickstart template:

| Old preset | New quickstart ID | Notes |
| --- | --- | --- |
| `solo` | `lean` | Single-model, minimal overhead |
| `duo` | `balanced` | Two positions: planner + builder |
| `trio` | `balanced` | Three positions: planner + builder + reviewer |
| `squad` | `specialist` | Specialist models per stage |
| `enterprise` | `enterprise` | Full pipeline with concurrency controls |

To initialize from a quickstart:

```
team init balanced
```

## Breaking Changes

1. **Legacy state files are not read** — `.workflow/state.json` is ignored. Run `status` after migrating; if the workflow has no state, it starts fresh.

2. **`preset` field removed from config** — any config that contains a top-level `preset` key will fail Zod validation. Use `fromLegacyTeamConfig()` from `@devilcode/team` to convert programmatically.

3. **`/density` command required before Phase 5 UI features** — if upgrading mid-workflow, run `density compact` or `density expanded` once to initialize the density preference.

4. **Team config now required for multi-agent builds** — `build` without a loaded team runs in single-agent fallback mode using your default model. Multi-position parallelism requires an explicit team config.

5. **`team swap` is Phase 10+** — Live position swapping is only available in devil Code 10.x and later. Older builds will show `WORKFLOW_NOT_ACTIVE` or reject unknown commands.

## Migration Steps

1. Export your existing team (if any) from the old format:

```bash
# If you have a legacy team JSON, convert it:
# Run from the opencode package
bun -e "
  const { fromLegacyTeamConfig } = await import('./src/devilcode/team/migration.ts')
  const legacy = JSON.parse(await Bun.file('./old-team.json').text())
  const result = fromLegacyTeamConfig(legacy)
  await Bun.write('./new-team.json', JSON.stringify(result.config, null, 2))
  console.log('warnings:', result.warnings)
"
```

2. Import the converted config:

```
team import ./new-team.json
```

3. Verify the team loaded:

```
status
```

4. (Optional) Publish the migrated config to your team registry:

```
team publish ./new-team.manifest.json \
  --name="My Team" \
  --author="you@example.com" \
  --version=1.0.0 \
  --sign=./signing.key
```

## FAQ

**Q: Do I lose my workflow history when migrating?**
A: The event log and lessons are additive — old `.workflow/` directories are ignored but not deleted. Your `.planning/` directory starts fresh unless you manually copy state files.

**Q: Can I run old and new workflow TUI side by side?**
A: No. Once `.planning/` exists, the new workflow TUI takes over. Remove `.planning/` to fall back to the old behavior (which will also lose new state).

**Q: Does `team swap` work with all providers?**
A: Any provider string accepted by `Config.update()` is valid. Provider/model validation is advisory at swap time — errors surface when the position's next task is dispatched.

**Q: What happens to in-flight tasks when I swap?**
A: Tasks already dispatched to the old provider/model run to completion with the original assignment. Only newly dispatched tasks use the new provider/model.

**Q: Can I undo a swap?**
A: Yes — swap again with the original provider and model, or re-import your team config from a saved file.
