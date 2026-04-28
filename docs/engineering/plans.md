# Plans

Plans are first-class repo artifacts. Agents should preserve the existing planning history and add new plans where future work needs durable context.

## Canonical Locations

|Path|Purpose|
|---|---|
|`.planning/PROJECT.md`|Product vision and constraints for the Team Orchestrator work.|
|`.planning/ROADMAP.md`|Phase roadmap and completion state.|
|`.planning/STATE.md`|Current state and handoff context.|
|`.planning/specs/`|Phase-level specs and decisions.|
|`.planning/phases/`|Execution plans, summaries, reviews, and context files.|
|`docs/superpowers/plans/`|Older superpowers execution plans.|
|`docs/superpowers/specs/`|Older superpowers specs.|

## Plan Rules

- Use lightweight inline plans for small changes.
- Check in execution plans for multi-file, architectural, or high-risk work.
- Keep plan files decision-complete: scope, approach, files or subsystems, tests, and assumptions.
- Update summaries and review notes after implementation.
- Link existing plans instead of duplicating them into new locations.

## Current Status

The `.planning/` corpus already contains a completed Team Orchestrator roadmap through Phase 10. Future agents should index it from this document rather than treating it as hidden context.
