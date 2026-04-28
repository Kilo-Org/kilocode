# Technical Debt

Technical debt should be visible, scoped, and retired continuously. Use this file for repo-level cleanup signals that do not yet have their own issue or plan.

## Active Cleanup Items

|Item|Status|Notes|
|---|---|---|
|Mixed `kilocode_change` and `devilcode_change` terminology|Baseline fixed|Canonical marker is `devilcode_change`; compatibility path names may keep `kilocode`.|
|Workflows guarded on `Kilo-Org/kilocode`|Baseline fixed|Active workflows should target `Devil-Org/devilcode` or `9thLevelSoftware/devilcode` while repo migration completes.|
|Disabled standards and management workflows|Open|Decide which jobs should remain disabled, be deleted, or be restored in warn mode.|
|Placeholder package scripts and random fields|Baseline fixed|Remove scripts/fields that teach agents false affordances.|
|Large root `AGENTS.md`|Fixed|Details moved to `docs/engineering/`; root file is now a map.|

## Cleanup Loop

- `bun run standards:check` reports drift without blocking.
- Add allowlist entries only for compatibility or intentionally historical artifacts.
- Convert repeated cleanup findings into specific follow-up tasks.
- Prefer small, reviewable cleanup PRs.
