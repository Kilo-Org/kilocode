# Team Orchestrator — Migration Guide (v1)

Devil Code v1 introduces the Team Orchestrator. The previous `/team init` flow
and the 5 hardcoded team presets have been replaced by the canonical 11-position
library and 5 bundled JSON quickstart templates.

## Quick migration paths

### No custom team config → use a quickstart

Run `/team init <quickstart>` in the TUI. The 5 quickstarts map to the old presets:

| Legacy preset | v1 quickstart |
|---|---|
| `Solo Enhanced` | `solo-enhanced` |
| `Code Review Pair` | `code-review-pair` |
| `Full Stack Team` | `full-stack-team` |
| `CI/CD Pipeline` | `ci-cd-pipeline` |
| `Research Team` | `research-team` |

### Custom `TeamConfig` in `kilo.json` → manual migration

v1 removes the legacy `TeamConfig` shape from `kilo.json`. Apply the migration tool
via a one-off Bun script:

```ts
// migrate.ts
import { migrateLegacyTeamConfigFile } from "@devilcode/opencode/devilcode/team/migration"
import { readFileSync, writeFileSync } from "node:fs"

const src = process.argv[2]  // e.g., ./legacy-kilo.json
const dst = process.argv[3]  // e.g., ./kilo.json

const legacyFull = JSON.parse(readFileSync(src, "utf8"))
writeFileSync("/tmp/team-legacy.json", JSON.stringify(legacyFull.team))

const result = migrateLegacyTeamConfigFile("/tmp/team-legacy.json")
if (!result.ok) {
  console.error("Migration failed:", result.errors)
  process.exit(1)
}
legacyFull.team = result.value
writeFileSync(dst, JSON.stringify(legacyFull, null, 2))
console.log("Migrated with warnings:", result.warnings)
```

Run: `bun run migrate.ts ./legacy-kilo.json ./kilo.json`

A CLI subcommand (`kilo team migrate`) is planned for a future release.

## Role-key → canonical-position mapping

| Legacy key | Canonical position |
|---|---|
| `lead` | `senior-dev` |
| `coder` | `developer` |
| `implementer` | `developer` |
| `frontend-dev` | `frontend-specialist` |
| `backend-dev` | `backend-specialist` |
| `release`, `ci-fixer` | `release-engineer` |
| `orchestrator` | `coordinator` |
| `deep-researcher`, `fast-scanner`, `research` | `researcher` |
| `reviewer` | `reviewer` |
| `architect` | `architect` |

## Capability-string → canonical mapping

| Legacy | Canonical |
|---|---|
| `coding` | `implementation` |
| `code-review`, `risk-analysis` | `review` |
| `ci`, `release` | `release` |
| `tests` | `testing` |
| `lookup`, `search`, `synthesis`, `analysis`, `long-form`, `triage` | `research` |
| `design`, `coordination` | `design` |
| `planning` | `planning` (unchanged) |

Unknown capabilities land in `supplementaryCapabilities` with a migration warning.

## Tier semantics changed

Canonical roles have library-fixed tiers:
- Tier 1: architect, coordinator, senior-dev
- Tier 2: developer, frontend-specialist, backend-specialist, reviewer, qa-tester, release-engineer, spec-writer
- Tier 3: researcher

A legacy role at `tier: 1` that maps to `developer` becomes tier 2 after migration.
If you want tier-1 behavior, set `positionId` to `senior-dev` instead.

## 7-stage coverage requirement

A canonical team must cover every workflow stage's required capability. If `/team init`
rejects your migrated team, add roles or capabilities until every stage is covered.
The error message enumerates every missing `stage(capability)` pair.

## VS Code extension

The extension's preset list will appear empty or log a Zod parse error in v1.0 because
the extension still consumes the legacy preset shape. Extension parity ships in v1.9 (Phase 9).
Use the CLI TUI in the interim.
