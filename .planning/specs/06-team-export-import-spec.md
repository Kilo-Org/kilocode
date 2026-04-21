# Phase 6 — Team Export/Import & Persistence Layer — Spec

**Status**: Draft · 2026-04-19
**Complexity**: Medium (justified in section 11; multiple pure modules + one new composite repository + command wiring + docs, all on a locked schema)
**Architecture**: Clean (selected by user; see `.planning/ROADMAP.md` Phase 6 + CLAUDE guidance)
**Estimated LOC**: Source ~940 · Tests ~780 · Docs ~220
**Plans**: 2 waves (per ROADMAP)

---

## 1. Goal & Scope

### In Scope
- `/team export <path>` slash command that writes a versioned + checksummed envelope JSON for the currently active team.
- `/team import <path>` slash command that reads an envelope JSON, validates schema + checksum, migrates older versions transparently, persists the config via existing `TeamRepository`, and reloads it into the active session (via `Config.update` read-then-merge).
- Schema version enum (`TeamConfigVersion`) + `CURRENT_TEAM_CONFIG_VERSION` constant + `migrateTeamConfig(raw)` pipeline handling any future schema bumps. v1 pipeline is identity for current-version inputs, and delegates to the existing Phase 2 `migrateLegacyTeamConfig` when the raw payload appears to be a legacy shape.
- Pure `computeTeamChecksum(config)` / `verifyTeamChecksum(config, expected)` over a stable-JSON canonicalization (recursive key sort) using `crypto.createHash("sha256")`.
- `TeamExportEnvelope` Zod schema = `{ version, checksum, config, exportedAt, exportedBy? }` with `.strict()` so unknown top-level keys are rejected explicitly.
- Pure `exportTeamToFile(path, config, options?)` and `importTeamFromFile(path)` in `team/io.ts` — Node-only module that isolates all filesystem + crypto concerns.
- Dedicated `TeamImportError`, `TeamVersionMismatchError`, `TeamChecksumError`, `TeamSchemaValidationError` error classes carrying structured diagnostic data.
- `createLayeredTeamRepository({ layers })` composite implementing existing `TeamRepository` interface. Precedence: project-local `.planning/team.json` > user-level `~/.local/share/kilo/teams/<id>.json` > bundled quickstart.
- `createProjectLocalTeamRepository({ cwd })` — single-file repository over `.planning/team.json`.
- `createQuickstartTeamRepository()` — read-only adapter over `loadQuickstartTemplates()`.
- `registerTeamIOCommands(register, handlers)` wiring `/team export` + `/team import` into the Phase 3 `useCommandRegistry` via the Phase 3/4 pattern used in `registerTeamBuilderCommands`.
- Call-site integration in `workflow-tui/index.tsx` (command registration) + `workflow-tui/command-input.tsx` (slash-command handler parity).
- Comprehensive test suite: unit coverage for every pure module + an integration round-trip fidelity test + malformed-input rejection matrix + precedence tests for the layered repository.
- Docs replacement at `packages/devil-docs/pages/collaborate/teams/team-management.md` (current content is an orphaned billing stub — replaced with full team orchestrator team-management guide covering export/import, storage layout, precedence, sharing, troubleshooting).

### Out of Scope
- Phase 8 registry protocol. `TeamExportEnvelope` is designed to remain compatible with a future signed-manifest wrapper (`TeamRegistryManifest`) that adds `{ signature, publisher, license, ... }` around the envelope, but no publish/subscribe or signature-verification code lands in Phase 6.
- Phase 7 DAG schema changes. Workflow-override additions will ship as a new envelope version; the `migrateTeamConfig` pipeline is the extensibility hook.
- Phase 9 VS Code webview integration. All pure logic modules (`versioning.ts`, `checksum.ts` algorithm note, `export-envelope.ts`, `errors.ts`) are browser-safe so the webview can import them later without refactor. `io.ts` is deliberately Node-only (uses `fs.promises` + `crypto`); the webview posts a message to the extension host, which calls `io.ts`.
- Live file-watching of `.planning/team.json`. Import is an explicit command, not auto-reload. A future enhancement can add `chokidar`-based reload if users ask.
- Encrypted exports. The checksum is integrity-only, not confidentiality. Users who need confidentiality encrypt the JSON file at rest via filesystem mechanisms.
- CLI-subcommand form (`kilo team export ...`) — Phase 6 ships only the TUI slash command. A CLI wrapper is a small future addition on top of the same pure modules.

### Non-Goals
- Migration tool UI flow — reuses the Phase 2 `migrateLegacyTeamConfig` path for legacy inputs, surfaced by `migrateTeamConfig` when it detects a legacy shape (absence of `enabled`-aware canonical refinements). No new UI is introduced; warnings surface via toast.
- Database-backed persistence — filesystem remains the single source of truth.
- Multi-user concurrent-edit safety — single-user filesystem is assumed. Last-write-wins is acceptable for v1.
- Remote HTTP import/fetch. `/team import <url>` is explicitly deferred to Phase 8.

---

## 2. Research Findings

Answered in-repo; no web search required.

### Q1. Checksum stability — JSON stringify strategy

**Finding**: No canonical-JSON library is installed (`package.json` has `jsonc-parser` for JSONC reads but nothing for stable JSON). `JSON.stringify` is non-deterministic for object key order in theory but V8/Node and Bun preserve insertion order, which is unsafe for cross-implementation or post-migration round-tripping.

**Decision**: Implement a minimal 30-LOC recursive `stableStringify(value)`:
- `null`, numbers, booleans → `JSON.stringify(value)`.
- strings → `JSON.stringify(value)` (handles escapes).
- arrays → `"[" + items.map(stableStringify).join(",") + "]"` (preserves order — arrays are ordered).
- objects → sort keys with `Array.prototype.sort()` (lexicographic), then `"{" + entries.map(([k,v]) => JSON.stringify(k) + ":" + stableStringify(v)).join(",") + "}"`.

Rejects `undefined` inside objects (matches `JSON.stringify` elision behavior). No floating-point normalization needed — team config has no floats.

### Q2. `.strict()` vs default Zod parse

**Finding**: `CanonicalTeamConfig` in `packages/opencode/src/devilcode/team/config.ts:49-97` uses default (passthrough) behavior — no `.strict()` on the outer `z.object({...})`. It does use `.refine` / `.superRefine` heavily. The `Config.Info` schema in `packages/opencode/src/config/config.ts:1511` uses `.strict()` on the top-level shape, which is why Phase 5's `workflow` field required an explicit schema extension.

**Decision**: `TeamExportEnvelope` MUST use `.strict()`. Rationale: the envelope is a narrow framing record; unknown top-level keys represent either forward-compatibility drift (handled via `version` bump + migration) or corruption / malicious tampering. Passing them through silently breaks checksum determinism and hides bugs. `config` field inside the envelope continues to use non-strict `CanonicalTeamConfig` so downstream additions (Phase 7 DAG override) parse cleanly.

### Q3. `Config.update` pattern

**Finding**: Phase 2 precedent is in `packages/opencode/src/devilcode/workflow-commands.tsx:54-56` (still present, not moved to command-input.tsx after Phase 5):
```ts
const current = await Config.get()
await Config.update({ ...current, team: template.team })
```
`Config.update(config: Info)` at `config/config.ts:1687` takes a full `Info` object, writes through `mergeConfig(existing, patch)`, and calls `Instance.dispose()` so the next `Config.get()` re-reads from disk.

**Decision**: Import handler uses the same read-then-merge-then-update pattern. Never call `Config.update({ team: cfg })` alone — that would blow away every other field on typecheck and risk future schema migrations silently dropping user data.

### Q4. `TeamRepository` consumers

**Finding**: Grep for `createFileSystemTeamRepository` returns 3 active production sites (plus tests and `team/index.ts` barrel):
1. `workflow-tui/index.tsx:35` — instantiated inside `WorkflowViewInner` component body (R3-13 from Phase 5; honors AsyncLocalStorage).
2. `workflow-tui/views/team-builder-context.tsx:66` — injectable via `props.repository`, default falls back to `createFileSystemTeamRepository()`.
3. `workflow-tui/runtime-cockpit.tsx` / `workflow-tui/tabs/helpers.ts` — grep-matched strings in comments/docs; no active runtime call.

**Migration path**: Replace direct `createFileSystemTeamRepository()` calls with `createLayeredTeamRepository({ layers: [project-local, user-level, quickstart] })`. The user-level layer IS a `createFileSystemTeamRepository()` instance — so the user-level repo continues to exist as the "writable" layer of the composite, unchanged. Saves always route to `userLevel.saveTeam(id, config)` unless the user explicitly targets the project-local layer via `/team export .planning/team.json` (which bypasses `saveTeam` and uses `exportTeamToFile` directly).

### Q5. Quickstart loader API

**Finding**: `packages/opencode/src/devilcode/team/quickstarts/index.ts` exports:
- `QUICKSTART_IDS: readonly QuickstartId[]` (5 ids).
- `loadQuickstartTemplates(): Record<QuickstartId, QuickstartTemplate>` — memoized, validates via `QuickstartFile.parse` on first call.
- `getQuickstart(id: string): QuickstartTemplate | undefined`.
- JSON is statically imported with `with { type: "json" }` attributes — proven to work with Bun `--compile` embedding (Phase 2 Open Risks line).

**Decision**: `createQuickstartTeamRepository()` wraps `loadQuickstartTemplates()` directly. All mutating methods (`saveTeam`, `deleteTeam`) throw a `TeamImportError` with `kind: "readonly-layer"`. `listTeams()` returns `QUICKSTART_IDS.map(id => ({ id, name: templates[id].name, path: `<quickstart:${id}>`, updatedAt: "" }))`. No new file I/O is introduced; Bun `--compile` behavior is unchanged.

### Q6. Slash command registration

**Finding**: Phase 5 wires commands via `useCommandRegistry` from `@devilcode/kilo-ui/hooks/use-command-registry`. Registration pattern is in `workflow-tui/index.tsx:69` and `workflow-tui/views/team-builder-commands.ts`:
```ts
const cleanupTeamCmds = registerTeamBuilderCommands(registry.register.bind(registry), builder, { openBuilder })
onCleanup(cleanupTeamCmds)
```
`Command` interface (`packages/devil-keybind/src/schemas.ts:63`) = `CommandData & { enabled?, onSelect? }`. `CommandData` REQUIRES `id, title, scope, aliases, hideKeywords, hidden`. Uses `scope` of `"workflow" | "team-builder" | "global" | "review"`.

Additionally, the user-visible slash-command surface in the input box is `command-input.tsx` — a `handleCommand(raw)` switch that matches `cmd === "back"`, `cmd.startsWith("density")`, etc. Export/import commands must be added here too so that typing `export <path>` directly submits; command-registry registration alone only exposes them through Ctrl+K and `?` overlay, not through the primary `workflow>` prompt.

**Decision**: Dual registration:
1. `registerTeamIOCommands(register, handlers)` — follows `team-builder-commands.ts` shape; registers `workflow.team.export` and `workflow.team.import` with `scope: "workflow"`, aliases `["team export", "team import"]`. Wired in `workflow-tui/index.tsx` alongside `registerTeamBuilderCommands`.
2. `command-input.tsx` adds `cmd.startsWith("team export ")` and `cmd.startsWith("team import ")` branches that call the same handler functions. This keeps slash-prompt and palette-invocation behavior identical.

### Q7. Windows path handling

**Finding**: `createFileSystemTeamRepository` already uses `path.join(os.homedir(), ".local", "share", "kilo", "teams")` — `path.join` produces platform-native separators and works on Windows. Existing tests in `repository.test.ts` pass on Windows CI. The concern is user-typed paths to `/team export <path>` and `/team import <path>` — Windows users may paste `C:\Users\...` or `C:/Users/...`.

**Decision**: Normalize user input via `path.resolve(cwd, rawInput)`. `path.resolve` handles both separators and relative paths. For safety, reject path traversal outside of "reasonable" roots by documentation only (no sandboxing in v1) — `/team export ../../evil.json` is user-at-keyboard, not remote-input, so the attack surface is negligible. CLAUDE.md's "always use forward slashes or properly escape backslashes" applies to paths WE construct; user paths go through `path.resolve` which normalizes.

### Q8. Docs site structure

**Finding**: `packages/devil-docs/` uses Next.js + Markdoc (`.md` with `{% callout %}`, `{% image %}`, `{% $markdoc.frontmatter.title %}` tags). Pages live under `pages/collaborate/teams/`. Frontmatter uses YAML title + description. Index file (`pages/collaborate/index.md`) manually lists each teams page — a new page does NOT auto-index, but Phase 6 docs can update the index's "Team Management" link description.

**Decision**: Replace `team-management.md` content (currently a generic billing stub misnamed as team-management) with a focused export/import + persistence guide. Update `packages/devil-docs/pages/collaborate/index.md` link description to match new scope if needed (existing link already says "Manage members and roles" — replace with "Manage team configurations, export/import, and precedence").

### Q9. Knip dead-export risk

**Finding**: Phase 4 Open Risks documented this: "Wave 2 outputs consumed only by Wave 3 — knip runs after all plans complete; expected behavior, not blocking." Knip is only enforced in `devil-vscode`, not in `opencode` or `devil-ui`. All new Phase 6 code is in `packages/opencode/src/devilcode/team/` and `packages/opencode/src/devilcode/workflow-tui/` — neither enforces knip in CI.

**Decision**: No mitigation needed. Wave 1 exports are consumed by Wave 2. Barrel re-exports from `team/index.ts` will be added in Wave 2 alongside the consumers.

### Q10. Test harness

**Finding**: Bun native test runner. Team tests live at `packages/opencode/test/devilcode/team/*.test.ts`. Existing round-trip-adjacent test: `repository.test.ts` has a "save then load round-trips a quickstart template" case that checks `routing.defaultRole` and role-key equality — not a strict deep-equal. No `fixtures/` directory pattern currently.

**Decision**: Phase 6 tests follow the same layout:
- `test/devilcode/team/versioning.test.ts`, `checksum.test.ts`, `export-envelope.test.ts`, `errors.test.ts`, `io.test.ts`, `layered-repository.test.ts`, `project-local-repository.test.ts`, `quickstart-repository.test.ts`.
- Integration: `test/devilcode/team/io.round-trip.test.ts` — exports every quickstart, re-imports, asserts deep equality via `stableStringify`.
- Malformed-input fixtures co-located as inline strings (each `malformed.*.test.ts` case) — no shared `fixtures/` dir, matching repository convention.

### Q11. `TeamConfigVersion` enum — stringy vs numeric

**Finding**: Prior phases use `z.enum([...])` for string enums (`CanonicalPosition`, `CanonicalCapability`, `WorkflowStage`). `CanonicalTeamConfig` has no version field today.

**Decision**: Use semver-string enum. `TeamConfigVersion = z.enum(["1.0.0"])` for Phase 6; Phase 7 bumps to `["1.0.0", "1.1.0"]`. Rationale: semver reads naturally, sorts correctly lexicographically within the same major, and matches the external-facing `@devilcode/cli` package version. `CURRENT_TEAM_CONFIG_VERSION = "1.0.0" as const` is the single source of truth; migration pipeline registers functions keyed on source version.

### Q12. `exportedBy` field

**Finding**: No cohesive user-identity source is exposed to the TUI layer. `DEVIL_API_URL` auth is in `packages/devil-gateway`, not plumbed through the workflow-tui context. `git config user.email` can be read via `Process.run(["git", "config", "user.email"])` using `src/util/process.ts` but adds a subprocess on every export.

**Decision**: `exportedBy` is `z.string().optional()` in the envelope. Export accepts it via `options?.exportedBy`. No automatic git-config read in v1 (keeps export pure and fast). Users who want author tracking can pass `/team export <path> --by=me@example.com` in a future CLI wrapper or set it via a Config field; neither is required now. Field name is scoped to author-identity, NOT display-name, so renaming to `author` later is still a clean forward-compat path (new envelope version).

### Q13. `.planning/team.json` override semantics

**Finding**: `.gitignore` does NOT currently ignore `.planning/team.json`. `.planning/` is used for Legion planning artifacts (specs, phases, ROADMAP, STATE). It is assumed to be committed, since spec/plan files are committed.

**Decision**: `.planning/team.json` is committable by default. Documentation calls out that teams intending to keep per-user preferences should add `.planning/team.json` to `.gitignore` manually — this is a deliberate override (team sharing vs personal preference). No gitignore edits in Phase 6. Phase 6 docs include a "Should I commit .planning/team.json?" section with trade-offs.

### Q14. Integration with `WorkflowViewState`

**Finding**: `WorkflowViewState` at `workflow-tui/context.tsx:25-73` reads team config on every `startBuild(teamConfig)` and `dispatchStage(..., { teamConfig })` call; nothing caches it. `team()` in `command-input.tsx:48-52` re-reads `sync.data.config.team` every invocation. Density/firstRunComplete fields demonstrated the Phase 5 pattern: `Config.update` persists, `Config.get` re-reads, state reactively rebinds.

**Decision**: Import handler's last step is `Config.update({ ...current, team: importedConfig })`. `Instance.dispose()` inside `update` invalidates caches; next `sync.data.config.team` read returns the imported team. No new reactive wiring needed — existing state flow handles propagation. Export handler reads `team()` (the same source) and writes it to the requested path.

---

## 3. Architecture Decisions

### 3.1 Schema versioning
Semver-string enum (`"1.0.0"`). `TeamConfigVersion = z.enum(["1.0.0"])` starts as a 1-value enum and expands in later phases. `CURRENT_TEAM_CONFIG_VERSION` is the `"1.0.0" as const` literal exported alongside the enum. Migration pipeline is a `Record<TeamConfigVersion, (raw: unknown) => unknown>` — each entry promotes input to the next version. `migrateTeamConfig(raw)` walks the chain until it reaches `CURRENT_TEAM_CONFIG_VERSION`, then hands off to `CanonicalTeamConfig.parse(...)`.

### 3.2 Checksum
sha256 over the `stableStringify(config)` output (NOT over the envelope's full serialized form — checksum field itself must not participate). `computeTeamChecksum` is pure and synchronous. Returns a lowercase hex string (64 chars). `verifyTeamChecksum(config, expected)` re-computes and constant-time-compares via `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` — constant-time not strictly required for integrity checksums but cheap insurance against timing oracles if this is ever extended to signed manifests (Phase 8).

### 3.3 Envelope
`TeamExportEnvelope` is a separate Zod schema, NOT extending `CanonicalTeamConfig`. Rationale: envelope is framing metadata; config is content. Separation makes `migrateTeamConfig` simpler (it operates on `envelope.config`, not the whole document) and keeps Phase 7 DAG additions cleanly scoped to `CanonicalTeamConfig` without envelope-version churn.

```
TeamExportEnvelope = z.object({
  version: TeamConfigVersion,
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  config: CanonicalTeamConfig,           // non-strict; allows Phase 7 additions
  exportedAt: z.string().datetime(),     // ISO 8601
  exportedBy: z.string().optional(),
}).strict()
```

### 3.4 Precedence via LayeredTeamRepository
`createLayeredTeamRepository({ layers })` where `layers` is an ordered array `Array<{ name: string; repository: TeamRepository; writable?: boolean }>`. Read operations (`loadTeam`, `listTeams`) walk layers in array order. Write operations (`saveTeam`, `deleteTeam`) target the first layer with `writable: true`. Default composition in `workflow-tui/index.tsx`:
```
layers: [
  { name: "project-local", repository: createProjectLocalTeamRepository({ cwd }), writable: true },
  { name: "user-level",    repository: createFileSystemTeamRepository(),          writable: true },
  { name: "quickstart",    repository: createQuickstartTeamRepository(),          writable: false },
]
```
But `saveTeam` routes to user-level by default (project-local saves only happen via explicit `/team export .planning/team.json`). Implementation detail: layered repo's `saveTeam` respects an optional `preferLayer?: string` option; when unspecified, the user-level layer is targeted. See module design in section 5.6.

### 3.5 Error taxonomy
Four structured error classes. All extend the standard `Error` constructor; carry additional fields for structured diagnostics. No `NamedError.create` — `TeamRepository` didn't use it, so we stay consistent with the existing `team/` module convention of plain subclasses.

```
TeamImportError        { kind: "file-not-found" | "file-read-failed" | "json-parse-failed" | "readonly-layer", path?, cause? }
TeamVersionMismatchError { found: string, supported: string[], suggestion?: string }
TeamChecksumError      { expected: string, actual: string, path?: string }
TeamSchemaValidationError { zodError: z.ZodError, layer: "envelope" | "config", path?: string }
```

Import handler catches each and renders a specific toast message (not a generic "import failed"). Error classes are caught by callers using `instanceof`, NOT by string matching on `error.message`.

### 3.6 Commands
`registerTeamIOCommands(register, handlers)` registers two commands with `scope: "workflow"`. `aliases` include `"team export"` and `"team import"` so Ctrl+K fuzzy search finds them by space-delimited tokens. `onSelect` closes over handlers passed by the composition site (handlers have `cwd`, `sdk`, `toast`, `teamRepo`, `config` captured).

`command-input.tsx` additionally branches on `cmd.startsWith("team export ")` / `cmd.startsWith("team import ")` so raw prompt input works — the same handler body is invoked. This duplication is minimal (~8 LOC) and matches the `density` / `task` pattern already in the file.

### 3.7 Module placement summary

```
packages/opencode/src/devilcode/team/
  versioning.ts                    ← NEW pure
  checksum.ts                      ← NEW pure
  export-envelope.ts               ← NEW pure
  errors.ts                        ← NEW pure
  io.ts                            ← NEW Node-only (fs + crypto)
  layered-repository.ts            ← NEW pure (composes TeamRepository instances)
  repositories/
    project-local.ts               ← NEW Node-only
    quickstart.ts                  ← NEW pure (wraps loadQuickstartTemplates)
  index.ts                         ← EDIT (add barrel exports for all above)
  repository.ts                    ← UNCHANGED

packages/opencode/src/devilcode/workflow-tui/
  commands/
    team-io.ts                     ← NEW (registers /team export, /team import)
  command-input.tsx                ← EDIT (add export/import string matches)
  index.tsx                        ← EDIT (register team-io commands alongside team-builder commands; swap direct createFileSystemTeamRepository for createLayeredTeamRepository at teamRepo site)

packages/devil-docs/pages/collaborate/teams/
  team-management.md               ← REWRITE

packages/devil-docs/pages/collaborate/
  index.md                         ← EDIT (update link description)
```

---

## 4. File Touch List

| File | Type | Est. LOC | Purpose |
|---|---|---|---|
| `packages/opencode/src/devilcode/team/versioning.ts` | NEW | 60 | TeamConfigVersion enum + migrateTeamConfig pipeline |
| `packages/opencode/src/devilcode/team/checksum.ts` | NEW | 45 | stableStringify + computeTeamChecksum + verifyTeamChecksum |
| `packages/opencode/src/devilcode/team/export-envelope.ts` | NEW | 50 | TeamExportEnvelope Zod schema |
| `packages/opencode/src/devilcode/team/errors.ts` | NEW | 70 | 4 error classes with structured fields |
| `packages/opencode/src/devilcode/team/io.ts` | NEW | 140 | exportTeamToFile + importTeamFromFile |
| `packages/opencode/src/devilcode/team/layered-repository.ts` | NEW | 130 | createLayeredTeamRepository |
| `packages/opencode/src/devilcode/team/repositories/project-local.ts` | NEW | 110 | .planning/team.json single-file repo |
| `packages/opencode/src/devilcode/team/repositories/quickstart.ts` | NEW | 75 | read-only wrapper over quickstarts |
| `packages/opencode/src/devilcode/team/index.ts` | EDIT | +25 | barrel exports |
| `packages/opencode/src/devilcode/workflow-tui/commands/team-io.ts` | NEW | 120 | registerTeamIOCommands |
| `packages/opencode/src/devilcode/workflow-tui/command-input.tsx` | EDIT | +40 | startsWith("team export/import") branches |
| `packages/opencode/src/devilcode/workflow-tui/index.tsx` | EDIT | +25 | register IO commands; swap to LayeredTeamRepository |
| `packages/opencode/test/devilcode/team/versioning.test.ts` | NEW | 70 | migration pipeline unit tests |
| `packages/opencode/test/devilcode/team/checksum.test.ts` | NEW | 90 | stableStringify + sha256 determinism |
| `packages/opencode/test/devilcode/team/export-envelope.test.ts` | NEW | 70 | envelope Zod schema incl. strict reject |
| `packages/opencode/test/devilcode/team/errors.test.ts` | NEW | 50 | error class structured data |
| `packages/opencode/test/devilcode/team/io.test.ts` | NEW | 140 | file write/read + errors |
| `packages/opencode/test/devilcode/team/io.round-trip.test.ts` | NEW | 80 | export → import deep-equal for every quickstart |
| `packages/opencode/test/devilcode/team/layered-repository.test.ts` | NEW | 120 | precedence; writable layer routing |
| `packages/opencode/test/devilcode/team/project-local-repository.test.ts` | NEW | 80 | .planning/team.json semantics |
| `packages/opencode/test/devilcode/team/quickstart-repository.test.ts` | NEW | 60 | read-only quickstart wrapper |
| `packages/devil-docs/pages/collaborate/teams/team-management.md` | REWRITE | 220 | full guide (replaces billing stub) |
| `packages/devil-docs/pages/collaborate/index.md` | EDIT | ±2 | update link description |
| **Totals** | | **~1940** | Source ~940 · Tests ~780 · Docs ~220 |

---

## 5. Module Designs

### 5.1 `team/versioning.ts`

```ts
import z from "zod"
import type { CanonicalTeamConfig } from "./config"
import { migrateLegacyTeamConfig, type LegacyMigrationResult } from "./migration"

export const TeamConfigVersion = z.enum(["1.0.0"])
export type TeamConfigVersion = z.infer<typeof TeamConfigVersion>

export const CURRENT_TEAM_CONFIG_VERSION: TeamConfigVersion = "1.0.0"

/** Walk raw input through version bumps until it reaches CURRENT. */
export function migrateTeamConfig(raw: unknown): { config: unknown; source: TeamConfigVersion | "legacy" } {
  // If the input looks like a legacy (pre-canonical) shape, delegate to Phase 2.
  if (isLegacyShape(raw)) {
    const r = migrateLegacyTeamConfig(raw)
    if (!r.ok) {
      throw new Error(`Legacy migration failed: ${r.errors.map((e) => e.message ?? e.kind).join("; ")}`)
    }
    return { config: r.value, source: "legacy" }
  }
  // v1.0.0 is identity. Future versions register functions here.
  return { config: raw, source: CURRENT_TEAM_CONFIG_VERSION }
}

function isLegacyShape(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false
  const o = raw as Record<string, unknown>
  // Legacy shapes lack positionId/supplementaryCapabilities on each role.
  // If roles exist but first role has neither, treat as legacy.
  const roles = o.roles as Record<string, unknown> | undefined
  if (!roles) return false
  const first = Object.values(roles)[0] as Record<string, unknown> | undefined
  if (!first) return false
  return !("positionId" in first) && !("supplementaryCapabilities" in first)
}
```

Tests: v1 identity, legacy detection heuristic (true+false cases), failed legacy throw.

### 5.2 `team/checksum.ts`

```ts
import crypto from "crypto"
import type { CanonicalTeamConfig } from "./config"

/** Recursive-sorted-key JSON canonicalization. NOT part of public API — exported only for tests. */
export function stableStringify(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]"
  if (typeof value === "object") {
    const o = value as Record<string, unknown>
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort()
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}"
  }
  throw new Error(`Cannot stable-stringify value of type ${typeof value}`)
}

export function computeTeamChecksum(config: CanonicalTeamConfig): string {
  const canonical = stableStringify(config)
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex")
}

export function verifyTeamChecksum(config: CanonicalTeamConfig, expected: string): boolean {
  const actual = computeTeamChecksum(config)
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}
```

Tests: key-order independence (swap roles order → same checksum), content change (swap a single char → different checksum), undefined-elision, 64-char hex output.

### 5.3 `team/export-envelope.ts`

```ts
import z from "zod"
import { CanonicalTeamConfig } from "./config"
import { TeamConfigVersion } from "./versioning"

export const TeamExportEnvelope = z
  .object({
    version: TeamConfigVersion,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    config: CanonicalTeamConfig,
    exportedAt: z.string().datetime(),
    exportedBy: z.string().optional(),
  })
  .strict()
export type TeamExportEnvelope = z.infer<typeof TeamExportEnvelope>
```

Tests: strict rejection of unknown keys, datetime format, checksum regex, required vs optional field matrix.

### 5.4 `team/errors.ts`

```ts
import type { z } from "zod"

export class TeamImportError extends Error {
  readonly kind: "file-not-found" | "file-read-failed" | "json-parse-failed" | "readonly-layer"
  readonly path?: string
  override readonly cause?: unknown
  constructor(kind: TeamImportError["kind"], message: string, opts?: { path?: string; cause?: unknown }) {
    super(message)
    this.name = "TeamImportError"
    this.kind = kind
    this.path = opts?.path
    this.cause = opts?.cause
  }
}

export class TeamVersionMismatchError extends Error {
  readonly found: string
  readonly supported: readonly string[]
  readonly suggestion?: string
  constructor(found: string, supported: readonly string[], suggestion?: string) {
    super(`Unsupported team config version: ${found} (supported: ${supported.join(", ")})${suggestion ? ` — ${suggestion}` : ""}`)
    this.name = "TeamVersionMismatchError"
    this.found = found
    this.supported = supported
    this.suggestion = suggestion
  }
}

export class TeamChecksumError extends Error {
  readonly expected: string
  readonly actual: string
  readonly path?: string
  constructor(expected: string, actual: string, path?: string) {
    super(`Checksum mismatch${path ? ` for ${path}` : ""}: expected ${expected.slice(0, 8)}… got ${actual.slice(0, 8)}…`)
    this.name = "TeamChecksumError"
    this.expected = expected
    this.actual = actual
    this.path = path
  }
}

export class TeamSchemaValidationError extends Error {
  readonly zodError: z.ZodError
  readonly layer: "envelope" | "config"
  readonly path?: string
  constructor(zodError: z.ZodError, layer: "envelope" | "config", path?: string) {
    super(`Team ${layer} schema validation failed: ${zodError.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ")}`)
    this.name = "TeamSchemaValidationError"
    this.zodError = zodError
    this.layer = layer
    this.path = path
  }
}
```

Tests: name/kind/field propagation; `instanceof` narrowing works.

### 5.5 `team/io.ts`

```ts
import { promises as fs } from "fs"
import path from "path"
import z from "zod"
import type { CanonicalTeamConfig } from "./config"
import { TeamExportEnvelope } from "./export-envelope"
import { CURRENT_TEAM_CONFIG_VERSION, migrateTeamConfig } from "./versioning"
import { computeTeamChecksum, verifyTeamChecksum } from "./checksum"
import {
  TeamImportError,
  TeamChecksumError,
  TeamSchemaValidationError,
  TeamVersionMismatchError,
} from "./errors"
import { CanonicalTeamConfig as CanonicalTeamConfigSchema } from "./config"

export type ExportTeamOptions = {
  exportedBy?: string
  now?: () => Date  // override for tests
}

export async function exportTeamToFile(
  targetPath: string,
  config: CanonicalTeamConfig,
  options: ExportTeamOptions = {},
): Promise<TeamExportEnvelope> {
  const envelope: TeamExportEnvelope = {
    version: CURRENT_TEAM_CONFIG_VERSION,
    checksum: computeTeamChecksum(config),
    config,
    exportedAt: (options.now?.() ?? new Date()).toISOString(),
    exportedBy: options.exportedBy,
  }
  // Validate before writing — catches local drift (e.g., caller passes an invalid config).
  TeamExportEnvelope.parse(envelope)
  const dir = path.dirname(targetPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(targetPath, JSON.stringify(envelope, null, 2) + "\n", "utf-8")
  return envelope
}

export type ImportTeamResult = {
  config: CanonicalTeamConfig
  envelope: TeamExportEnvelope
  migrationSource: "1.0.0" | "legacy"
  warnings: string[]
}

export async function importTeamFromFile(sourcePath: string): Promise<ImportTeamResult> {
  let raw: string
  try {
    raw = await fs.readFile(sourcePath, "utf-8")
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      throw new TeamImportError("file-not-found", `Team file not found: ${sourcePath}`, { path: sourcePath, cause: err })
    }
    throw new TeamImportError("file-read-failed", `Could not read team file: ${sourcePath}`, { path: sourcePath, cause: err })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new TeamImportError("json-parse-failed", `Invalid JSON in ${sourcePath}`, { path: sourcePath, cause: err })
  }

  // Envelope vs bare-config detection: an envelope has .version + .checksum + .config.
  const looksLikeEnvelope =
    parsed !== null && typeof parsed === "object" && "version" in parsed && "config" in parsed && "checksum" in parsed
  if (!looksLikeEnvelope) {
    // Treat as bare config (legacy case or raw CanonicalTeamConfig). Migrate then wrap.
    const migrated = migrateTeamConfig(parsed)
    const cfg = CanonicalTeamConfigSchema.safeParse(migrated.config)
    if (!cfg.success) throw new TeamSchemaValidationError(cfg.error, "config", sourcePath)
    const envelope: TeamExportEnvelope = {
      version: CURRENT_TEAM_CONFIG_VERSION,
      checksum: computeTeamChecksum(cfg.data),
      config: cfg.data,
      exportedAt: new Date().toISOString(),
    }
    return { config: cfg.data, envelope, migrationSource: migrated.source, warnings: ["Bare config imported — no envelope checksum verified."] }
  }

  // Envelope path — extract version FIRST so a malformed envelope surfaces a
  // targeted version error rather than a generic schema error.
  const envVersion = (parsed as { version?: unknown }).version
  if (typeof envVersion === "string") {
    const versionCheck = z.enum(["1.0.0"]).safeParse(envVersion)
    if (!versionCheck.success) {
      throw new TeamVersionMismatchError(envVersion, ["1.0.0"])
    }
  }

  // Apply migrations to envelope.config before Zod-parsing the envelope.
  const mutableEnvelope = { ...(parsed as Record<string, unknown>) }
  const migrated = migrateTeamConfig(mutableEnvelope.config)
  mutableEnvelope.config = migrated.config

  const envParsed = TeamExportEnvelope.safeParse(mutableEnvelope)
  if (!envParsed.success) throw new TeamSchemaValidationError(envParsed.error, "envelope", sourcePath)

  if (!verifyTeamChecksum(envParsed.data.config, envParsed.data.checksum)) {
    throw new TeamChecksumError(envParsed.data.checksum, computeTeamChecksum(envParsed.data.config), sourcePath)
  }

  return {
    config: envParsed.data.config,
    envelope: envParsed.data,
    migrationSource: migrated.source,
    warnings: [],
  }
}
```

Tests: happy path; ENOENT; malformed JSON; envelope-vs-bare detection; checksum mismatch; version mismatch; schema-invalid envelope; schema-invalid config inside envelope; atomic write (mkdir -p behavior). Round-trip (separate file).

### 5.6 `team/layered-repository.ts`

```ts
import type { CanonicalTeamConfig } from "./config"
import type { TeamHandle, TeamRepository } from "./repository"
import { TeamImportError } from "./errors"

export type TeamRepositoryLayer = {
  name: string
  repository: TeamRepository
  writable?: boolean
}

export type CreateLayeredTeamRepositoryOptions = {
  layers: TeamRepositoryLayer[]
  /** Layer name to prefer when saveTeam/deleteTeam is called without explicit targeting. Defaults to first writable layer. */
  defaultWriteLayer?: string
}

export interface LayeredTeamRepository extends TeamRepository {
  /** List with the `layer` attribution — useful for UI debug / precedence surfacing. */
  listTeamsWithLayer(): Promise<Array<TeamHandle & { layer: string }>>
  /** Explicit-layer save (used by /team export targeting project-local). */
  saveTeamToLayer(layerName: string, id: string, config: CanonicalTeamConfig): Promise<TeamHandle>
}

export function createLayeredTeamRepository(options: CreateLayeredTeamRepositoryOptions): LayeredTeamRepository {
  if (options.layers.length === 0) throw new Error("Layered repository requires at least one layer")
  const defaultWriteLayerName =
    options.defaultWriteLayer ?? options.layers.find((l) => l.writable)?.name
  if (!defaultWriteLayerName) throw new Error("No writable layer configured")

  const byName = new Map(options.layers.map((l) => [l.name, l]))

  async function loadTeam(id: string): Promise<CanonicalTeamConfig> {
    const errors: string[] = []
    for (const layer of options.layers) {
      try {
        return await layer.repository.loadTeam(id)
      } catch (err: unknown) {
        errors.push(`${layer.name}: ${(err as Error).message ?? String(err)}`)
      }
    }
    throw new Error(`Team "${id}" not found in any layer:\n  ${errors.join("\n  ")}`)
  }

  async function listTeams(): Promise<TeamHandle[]> {
    const seen = new Map<string, TeamHandle>()
    for (const layer of options.layers) {
      const handles = await layer.repository.listTeams()
      for (const h of handles) if (!seen.has(h.id)) seen.set(h.id, h)
    }
    return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  async function listTeamsWithLayer() {
    const out: Array<TeamHandle & { layer: string }> = []
    const seen = new Set<string>()
    for (const layer of options.layers) {
      const handles = await layer.repository.listTeams()
      for (const h of handles) if (!seen.has(h.id)) { seen.add(h.id); out.push({ ...h, layer: layer.name }) }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  async function saveTeamToLayer(layerName: string, id: string, config: CanonicalTeamConfig) {
    const layer = byName.get(layerName)
    if (!layer) throw new Error(`Unknown layer "${layerName}"`)
    if (!layer.writable) {
      throw new TeamImportError("readonly-layer", `Layer "${layerName}" is read-only`)
    }
    return layer.repository.saveTeam(id, config)
  }

  async function saveTeam(id: string, config: CanonicalTeamConfig) {
    return saveTeamToLayer(defaultWriteLayerName, id, config)
  }

  async function deleteTeam(id: string) {
    const layer = byName.get(defaultWriteLayerName)!
    return layer.repository.deleteTeam(id)
  }

  return { loadTeam, listTeams, saveTeam, deleteTeam, listTeamsWithLayer, saveTeamToLayer }
}
```

Tests: layer precedence on load; listTeams dedup; saveTeam routes to first-writable; saveTeamToLayer targeted; readonly rejection; unknown-layer rejection.

### 5.7 `team/repositories/project-local.ts`

Single-file repository over `<cwd>/.planning/team.json`. The single file holds a bare `CanonicalTeamConfig` (NOT an envelope) — envelope is for inter-user sharing, project-local file is for in-project persistence. `listTeams` returns a single handle with `id: "project"` when the file exists, `[]` otherwise. `loadTeam("project")` reads and validates. `saveTeam("project", ...)` writes. Any other `id` throws a `TeamImportError` with `kind: "file-not-found"` — this layer only supports the `"project"` id.

```ts
import { promises as fs } from "fs"
import path from "path"
import type { CanonicalTeamConfig } from "../config"
import { CanonicalTeamConfig as CanonicalTeamConfigSchema } from "../config"
import type { TeamHandle, TeamRepository } from "../repository"
import { TeamImportError, TeamSchemaValidationError } from "../errors"

export const PROJECT_LOCAL_TEAM_ID = "project"

export type CreateProjectLocalTeamRepositoryOptions = {
  cwd: string
  fileName?: string  // default ".planning/team.json"
}

export function createProjectLocalTeamRepository(
  options: CreateProjectLocalTeamRepositoryOptions,
): TeamRepository {
  const filePath = path.join(options.cwd, options.fileName ?? path.join(".planning", "team.json"))
  // ...listTeams/loadTeam/saveTeam/deleteTeam
}
```

Tests: exists-reads; missing-returns-empty; write creates `.planning/` dir; id rejection; schema validation on load.

### 5.8 `team/repositories/quickstart.ts`

Read-only wrapper over `loadQuickstartTemplates()`. `listTeams` enumerates `QUICKSTART_IDS`. `loadTeam(id)` calls `getQuickstart(id)`, returns `template.team`. `saveTeam` / `deleteTeam` throw `TeamImportError("readonly-layer")`.

```ts
import type { TeamHandle, TeamRepository } from "../repository"
import type { CanonicalTeamConfig } from "../config"
import { getQuickstart, loadQuickstartTemplates, QUICKSTART_IDS } from "../quickstarts"
import { TeamImportError } from "../errors"

export function createQuickstartTeamRepository(): TeamRepository {
  return {
    async listTeams(): Promise<TeamHandle[]> {
      const templates = loadQuickstartTemplates()
      return QUICKSTART_IDS.map((id) => ({
        id, name: templates[id].name, path: `<quickstart:${id}>`, updatedAt: "",
      }))
    },
    async loadTeam(id: string): Promise<CanonicalTeamConfig> {
      const t = getQuickstart(id)
      if (!t) throw new TeamImportError("file-not-found", `Quickstart "${id}" not found`)
      return t.team
    },
    async saveTeam(): Promise<TeamHandle> {
      throw new TeamImportError("readonly-layer", "Quickstart repository is read-only")
    },
    async deleteTeam(): Promise<void> {
      throw new TeamImportError("readonly-layer", "Quickstart repository is read-only")
    },
  }
}
```

Tests: enumeration count; loadTeam resolves; unknown id throws; write methods throw correct error class.

### 5.9 `workflow-tui/commands/team-io.ts`

```ts
import type { Command } from "@devilcode/keybind"
import type { CanonicalTeamConfig } from "../../team/config"
import { exportTeamToFile, importTeamFromFile } from "../../team/io"
import {
  TeamChecksumError,
  TeamImportError,
  TeamSchemaValidationError,
  TeamVersionMismatchError,
} from "../../team/errors"

export type RegisterFn = (cmd: Command) => () => void

export type TeamIOCommandHandlers = {
  getActiveTeam(): CanonicalTeamConfig | undefined
  onImported(config: CanonicalTeamConfig): Promise<void>
  resolvePath(raw: string): string
  toast(message: string, variant: "info" | "success" | "warning" | "error"): void
  /** For prompt-driven invocation; palette-driven uses a dialog (future enhancement). */
  prompt(message: string): Promise<string | undefined>
}

export function registerTeamIOCommands(register: RegisterFn, handlers: TeamIOCommandHandlers): () => void {
  const unregs: Array<() => void> = []
  unregs.push(
    register({
      id: "workflow.team.export", title: "Team: Export to File", scope: "workflow",
      aliases: ["team export"], hideKeywords: [], hidden: false,
      onSelect: async () => {
        const raw = await handlers.prompt("Export path (e.g., ./my-team.json):")
        if (!raw) return
        await exportCommand(raw, handlers)
      },
    }),
  )
  unregs.push(
    register({
      id: "workflow.team.import", title: "Team: Import from File", scope: "workflow",
      aliases: ["team import"], hideKeywords: [], hidden: false,
      onSelect: async () => {
        const raw = await handlers.prompt("Import path:")
        if (!raw) return
        await importCommand(raw, handlers)
      },
    }),
  )
  return () => { for (const u of unregs) u() }
}

export async function exportCommand(rawPath: string, handlers: TeamIOCommandHandlers): Promise<void> {
  const cfg = handlers.getActiveTeam()
  if (!cfg) {
    handlers.toast("No active team to export. Run /team init <quickstart> first.", "warning")
    return
  }
  const target = handlers.resolvePath(rawPath)
  try {
    const env = await exportTeamToFile(target, cfg)
    handlers.toast(`Exported team (v${env.version}) to ${target}`, "success")
  } catch (err) {
    handlers.toast(`Export failed: ${(err as Error).message}`, "error")
  }
}

export async function importCommand(rawPath: string, handlers: TeamIOCommandHandlers): Promise<void> {
  const source = handlers.resolvePath(rawPath)
  try {
    const result = await importTeamFromFile(source)
    await handlers.onImported(result.config)
    const warn = result.warnings.length > 0 ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"})` : ""
    handlers.toast(`Imported team from ${source}${warn}`, "success")
  } catch (err) {
    if (err instanceof TeamChecksumError) handlers.toast(`Checksum mismatch — file may be tampered or corrupt`, "error")
    else if (err instanceof TeamVersionMismatchError) handlers.toast(`Unsupported version: ${err.found} (supported ${err.supported.join(", ")})`, "error")
    else if (err instanceof TeamSchemaValidationError) handlers.toast(`Invalid ${err.layer}: ${err.zodError.issues[0]?.message ?? "schema error"}`, "error")
    else if (err instanceof TeamImportError) handlers.toast(`Import failed (${err.kind}): ${err.message}`, "error")
    else handlers.toast(`Import failed: ${(err as Error).message}`, "error")
  }
}
```

Tests: mock handlers; each error class renders a distinct toast; happy path; no-team export.

### 5.10 Handler wiring

`workflow-tui/index.tsx` changes (inside `WorkflowViewInner`):

```ts
// Replace:
//   const teamRepo = createFileSystemTeamRepository()
// with:
const cwd = sdk.directory!
const teamRepo = createLayeredTeamRepository({
  layers: [
    { name: "project-local", repository: createProjectLocalTeamRepository({ cwd }), writable: true },
    { name: "user-level",    repository: createFileSystemTeamRepository(),          writable: true },
    { name: "quickstart",    repository: createQuickstartTeamRepository(),          writable: false },
  ],
  defaultWriteLayer: "user-level",
})

// Register IO commands alongside team-builder commands:
const cleanupIOCmds = registerTeamIOCommands(registry.register.bind(registry), {
  getActiveTeam: () => {
    const result = CanonicalTeamConfig.safeParse((sync.data.config as { team?: unknown }).team)
    return result.success ? result.data : undefined
  },
  onImported: async (config) => {
    const current = await Config.get()
    await Config.update({ ...current, team: config })
  },
  resolvePath: (raw) => path.resolve(cwd, raw),
  toast: (message, variant) => toast.show({ message, variant, duration: 3500 }),
  prompt: async (message) => { /* minimal inline prompt — future: modal */ return undefined },
})
onCleanup(cleanupIOCmds)
```

`workflow-tui/command-input.tsx` adds (after `cmd.startsWith("density")`):

```ts
if (cmd.startsWith("team export ")) {
  const argPath = text.slice("team export ".length).trim()
  if (!argPath) { toast.show({ message: "Usage: team export <path>", variant: "warning", duration: 3000 }); return }
  await exportCommand(argPath, makeHandlers({ toast, sdk, sync, cwd: sdk.directory! }))
  return
}
if (cmd.startsWith("team import ")) {
  const argPath = text.slice("team import ".length).trim()
  if (!argPath) { toast.show({ message: "Usage: team import <path>", variant: "warning", duration: 3000 }); return }
  await importCommand(argPath, makeHandlers({ toast, sdk, sync, cwd: sdk.directory! }))
  return
}
```

`makeHandlers(...)` is a small factory co-located inside `command-input.tsx` that builds the same `TeamIOCommandHandlers` shape registered on the palette side. Duplication is intentional: the palette side has its own captured context (registry/cleanup lifecycle); the prompt side lives in the input component's render scope. Sharing would require lifting state to the provider which is out of scope.

### 5.11 Docs replacement

`team-management.md` is rewritten from scratch. ~220 LOC. Sections:
- Frontmatter (title: "Team Management", description: "Export, import, share, and persist team configurations")
- Introduction — what a team config is, where it lives
- Storage layout and precedence diagram (bundled quickstart < user-level < project-local)
- `/team export <path>` — full command doc with envelope schema table
- `/team import <path>` — full command doc with error modes table
- Sharing workflows (send JSON to a teammate; commit `.planning/team.json`)
- Migration from older versions — pointer to `migrate-legacy.md` content
- Troubleshooting — "checksum mismatch", "unsupported version", "no active team"
- FAQ — "should I commit `.planning/team.json`?", "how do I reset to a quickstart?"
- Cross-links to `getting-started.md`, `migration-v1.md`, `about-plans.md`

---

## 6. Wave & Plan Breakdown

### Plan 06-01 (Wave 1): Pure Modules
Deps: Phase 5 complete. 3 tasks (per `task_count_cap`):

- **Task 1 — Checksum + Versioning + Errors + Envelope**:
  - NEW: `team/checksum.ts`, `team/versioning.ts`, `team/errors.ts`, `team/export-envelope.ts`.
  - NEW tests: `checksum.test.ts`, `versioning.test.ts`, `errors.test.ts`, `export-envelope.test.ts`.
  - No barrel changes yet.
  - Verification: `bun test test/devilcode/team/checksum.test.ts test/devilcode/team/versioning.test.ts test/devilcode/team/errors.test.ts test/devilcode/team/export-envelope.test.ts` (all pass).

- **Task 2 — I/O module + round-trip**:
  - NEW: `team/io.ts`.
  - NEW tests: `io.test.ts`, `io.round-trip.test.ts` (exports every quickstart to tmpdir, re-imports, deep-equals via `stableStringify`).
  - Verification: `bun test test/devilcode/team/io.test.ts test/devilcode/team/io.round-trip.test.ts` (all pass); `bun turbo typecheck` (clean).

- **Task 3 — Repositories (project-local + quickstart) + layered composite**:
  - NEW: `team/repositories/project-local.ts`, `team/repositories/quickstart.ts`, `team/layered-repository.ts`.
  - NEW tests: `project-local-repository.test.ts`, `quickstart-repository.test.ts`, `layered-repository.test.ts`.
  - EDIT: `team/index.ts` — add barrel exports for all Wave 1 public symbols.
  - Verification: all team tests pass; `bun turbo typecheck` clean; `rg "createLayeredTeamRepository" packages/opencode/src/devilcode/team/index.ts` matches.

Wave 1 exits when: 10 test files pass; typecheck clean; zero knip breakage (opencode isn't knip-enforced anyway).

### Plan 06-02 (Wave 2): Commands, Integration, Docs
Deps: Plan 06-01 complete. 3 tasks:

- **Task 1 — Command registration module + prompt-side hooks**:
  - NEW: `workflow-tui/commands/team-io.ts` (including `registerTeamIOCommands` + exported `exportCommand` + `importCommand` handler functions).
  - NEW test: `test/devilcode/workflow-tui/team-io.commands.test.ts` — mocks `TeamIOCommandHandlers`, asserts each error class produces its specific toast variant.
  - Verification: test pass; `bun turbo typecheck` clean.

- **Task 2 — WorkflowView wiring + command-input integration**:
  - EDIT: `workflow-tui/index.tsx` — swap `createFileSystemTeamRepository()` for `createLayeredTeamRepository(...)`; register `registerTeamIOCommands` cleanup.
  - EDIT: `workflow-tui/command-input.tsx` — add `cmd.startsWith("team export ")` and `cmd.startsWith("team import ")` branches calling `exportCommand` / `importCommand`.
  - Update/extend existing `onboarding.integration.test.ts` assertions to verify the layered-repo pattern.
  - NEW test: `test/devilcode/workflow-tui/team-io.prompt.test.ts` — structural assertion that command-input.tsx contains both startsWith branches and imports from `commands/team-io`.
  - Verification: all Phase 5 tests still pass (329 green); new test passes; `bun turbo typecheck` clean.

- **Task 3 — Docs rewrite + index update**:
  - REWRITE: `packages/devil-docs/pages/collaborate/teams/team-management.md` (~220 LOC).
  - EDIT: `packages/devil-docs/pages/collaborate/index.md` — update link description for team-management.
  - Verification: `bun run check-kilocode-change` clean; docs render locally (`bun run dev:docs`) if available; manually skim for Markdoc `{% ... %}` syntax correctness. Source-link check (if any URL changed in devil-vscode webview copies) — N/A for Phase 6 since we don't touch webview URLs.

Wave 2 exits when: all tests pass cumulatively; `bun turbo typecheck` clean; no `devilcode_change` marker drift.

---

## 7. Testing Strategy

### Unit tests (per module, Wave 1)

| Module | Test file | Cases |
|---|---|---|
| versioning.ts | versioning.test.ts | identity-v1; legacy-detected-and-migrated; legacy-migration-failure-throws; non-legacy-non-version-identity |
| checksum.ts | checksum.test.ts | key-order-independent; content-change; undefined-elided; 64-char-hex; timingSafeEqual-false-on-mismatch |
| errors.ts | errors.test.ts | name/kind/field propagation; `instanceof` narrowing; cause-chain preserved |
| export-envelope.ts | export-envelope.test.ts | happy-parse; missing-version rejected; extra-key rejected (strict); datetime-rejects-bad-format; checksum-regex-rejects-non-hex |
| io.ts | io.test.ts | export writes file + returns envelope; export fails pre-write if config invalid; import-ENOENT → TeamImportError; malformed JSON; bare-config detection path; envelope path validated; tampered-checksum; wrong-version; schema-invalid-config inside envelope |
| layered-repository.ts | layered-repository.test.ts | precedence; dedup across layers; saveTeam-to-first-writable; saveTeamToLayer targeting; readonly-rejection |
| project-local.ts | project-local-repository.test.ts | file-missing-returns-empty; load-when-present; save-creates-.planning-dir; save-then-load; non-"project"-id rejected |
| quickstart.ts | quickstart-repository.test.ts | enumerate-5; load-known; load-unknown-throws; saveTeam-throws; deleteTeam-throws |

### Integration tests

- `io.round-trip.test.ts` — for each of 5 quickstarts: export to tmpdir → re-import → assert `stableStringify(imported.config) === stableStringify(original)`. Also assert envelope.checksum matches and envelope.version === "1.0.0".
- `team-io.commands.test.ts` — mock handlers; assert exportCommand happy path + no-team warning; each import error class produces its own toast variant.
- `team-io.prompt.test.ts` — structural grep assertions that `command-input.tsx` contains the two new startsWith branches and imports from `commands/team-io`.

### Malformed-input fixtures (inline in io.test.ts)

| Case | Expected error |
|---|---|
| File does not exist | TeamImportError { kind: "file-not-found" } |
| Binary/non-UTF-8 file | TeamImportError { kind: "json-parse-failed" } (fs.readFile with utf-8 flag returns garbage → JSON.parse fails) |
| `{ not: "an envelope" }` | TeamSchemaValidationError { layer: "config" } (falls to bare-config path → CanonicalTeamConfig rejects) |
| Envelope with version `"9.9.9"` | TeamVersionMismatchError |
| Envelope with checksum `"deadbeef"` | TeamChecksumError |
| Envelope with unknown top-level key `"foo": 1` | TeamSchemaValidationError { layer: "envelope" } (strict) |
| Envelope with `checksum: "not-hex"` | TeamSchemaValidationError { layer: "envelope" } (regex) |
| Envelope with config lacking required canonical fields | TeamSchemaValidationError { layer: "envelope" } (Zod catches inside envelope parse) |

### Performance/boundary cases
- Empty team config — quickstart "solo-enhanced" has only 1 role; acceptable.
- Large team — construct a synthetic 11-role team, export, import; assert round-trip latency < 100ms (Bun filesystem write is ~1ms, sha256 over ~5KB config is sub-ms).
- Concurrent export — NOT tested in v1; single-user assumption.

### Test commands
```bash
cd packages/opencode && bun test test/devilcode/team/     # Wave 1 exit gate (10 files)
cd packages/opencode && bun test test/devilcode/          # Wave 2 exit gate (all team + workflow-tui)
bun turbo typecheck                                       # Phase 6 exit gate
bun run check-kilocode-change                             # Phase 6 exit gate
bun run format:check                                      # Phase 6 exit gate (devil-vscode)
```

---

## 8. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `stableStringify` has a subtle ordering bug that breaks round-trip across Node versions | HIGH | Test explicitly reorders keys and asserts checksum stability. Keep implementation < 30 LOC so it's reviewable in one screen. Include property-like test: shuffle key order in tree 10 times, all produce same checksum. |
| Envelope `.strict()` rejects forward-compat additions from Phase 7 users who bumped the version field | MEDIUM | Version gate fires BEFORE envelope parse — forward-version inputs get a `TeamVersionMismatchError` with a useful message, not a strict-rejection cryptic one. `migrateTeamConfig` pipeline is the approved extension path. |
| LayeredTeamRepository silently changes behavior for callers expecting filesystem-only `createFileSystemTeamRepository` | MEDIUM | Default write layer is "user-level" (still the filesystem repo), preserving existing semantics. `team-builder-context.tsx` keeps `repository` prop override for tests. Integration test verifies the onboarding wizard still saves to the user-level layer. |
| `.planning/team.json` conflicts with existing Legion planning content (unlikely but user-reserved dir) | LOW | `.planning/team.json` is a new filename; no collision with existing Legion files (`ROADMAP.md`, `STATE.md`, `PROJECT.md`, `specs/`, `phases/`). Docs call out that `.planning/team.json` is Phase-6-owned. |
| Importing a team with `enabled: true` but failing canonical stage coverage crashes the workflow | MEDIUM | `CanonicalTeamConfig.safeParse` surfaces as `TeamSchemaValidationError`; handler shows stage-coverage error to user before `Config.update` is called. Config is never persisted if validation fails. |
| Windows path with spaces or mixed separators breaks resolvePath | LOW | `path.resolve(cwd, raw)` on Windows handles both; existing `Config.update` write sites operate through `Filesystem.writeJson` which also uses `path` — same behavior. Existing `repository.test.ts` runs on Windows CI. |
| Phase 9 webview cannot import `io.ts` | EXPECTED | Documented in section 3.7 + Out of Scope. Webview uses a message-passing bridge to the extension host; extension calls `io.ts`. `checksum.ts` uses Node `crypto`, also extension-side. `versioning.ts`, `export-envelope.ts`, `errors.ts` are browser-safe (pure Zod + TS) and can be imported by webview unchanged. |
| Existing `repository.test.ts` "loadTeam throws on malformed JSON schema" test might conflict with new error classes | LOW | That test uses a raw `await expect(...).rejects.toThrow()` without inspecting the error class, so it passes regardless of which error is thrown. |
| Bun `--compile` static-JSON-import works for quickstart repo | LOW | Phase 2 Open Risks documented and probed this. `createQuickstartTeamRepository` doesn't add new static imports; it wraps the existing `loadQuickstartTemplates` memoized loader. |
| A team config exported in Phase 6 is imported in Phase 7+ after DAG changes land, and the checksum fails because the new field was added non-destructively | MEDIUM | `migrateTeamConfig` is called BEFORE checksum verification. The migration function is responsible for bumping the config shape AND recomputing the checksum internally. Verification only checks the final migrated config against the envelope's stored checksum for the envelope's own version. Phase 7 spec will specify whether DAG changes bump the minor or patch. |
| User exports a team WHILE workflow-tui still has stale team in `sync.data.config.team` | LOW | `getActiveTeam()` reads the same `sync.data.config.team` the rest of the TUI reads. Staleness is a pre-existing concern, not introduced by Phase 6. |

---

## 9. Open Questions

All major questions resolved in Stage 2. Remaining items are deferred-by-design:

- **OQ-1** — Should import prompt use a terminal modal instead of inline input? Current design registers palette commands with an `await handlers.prompt(...)` placeholder that returns `undefined` (non-functional from palette). Prompt-driven invocation via `command-input.tsx` IS functional (user types `team export <path>` with the path inline). Deferred to Phase 10 polish unless user needs palette-click flow in v1. Spec acknowledges this gap — palette selection of export/import shows a toast "Type `team export <path>` in the prompt" as a graceful fallback.
- **OQ-2** — Should `/team export` default path be relative to cwd or `.planning/team.json` when no path given? Current design rejects empty path with usage message. Future enhancement could default to `.planning/team.json` for discoverability.

---

## 10. Acceptance Criteria

- [ ] `/team export <path>` writes team JSON envelope with schema version + checksum. Re-importing produces a byte-identical `stableStringify(config)` output. (ROADMAP criterion 1)
- [ ] `/team import <path>` reads team JSON, validates schema, migrates older versions transparently. Legacy shapes detected via `isLegacyShape()` heuristic flow through `migrateLegacyTeamConfig`. (ROADMAP criterion 2)
- [ ] Override precedence implemented: project-local `.planning/team.json` > user-level `~/.local/share/kilo/teams/<id>.json` > bundled quickstart. Verified in `layered-repository.test.ts`. (ROADMAP criterion 3)
- [ ] 100% round-trip fidelity test (`io.round-trip.test.ts`) passes for all 5 quickstart templates. (ROADMAP criterion 4)
- [ ] Malformed input rejected with clear error messages. 8 malformed-input cases in `io.test.ts`, each asserting a specific error class and `kind`/field. (ROADMAP criterion 5)
- [ ] Docs added to `packages/devil-docs/pages/collaborate/teams/team-management.md`. Rewritten from scratch; ~220 LOC; includes envelope schema, precedence diagram, error-mode table, sharing workflows, troubleshooting, FAQ. `collaborate/index.md` link updated. (ROADMAP criterion 6)
- [ ] `bun turbo typecheck` clean across the monorepo.
- [ ] `bun run knip` clean in devil-vscode (Phase 6 doesn't touch devil-vscode; knip unaffected).
- [ ] `bun run format:check` clean.
- [ ] `bun run check-kilocode-change` clean — new files are inside `src/devilcode/` so no markers required.
- [ ] All Phase 5 tests still pass (329 green); 10 new team test files + 1 round-trip test + 2 workflow-tui tests pass.
- [ ] `workflow-tui/index.tsx` swaps `createFileSystemTeamRepository()` for `createLayeredTeamRepository(...)` with project-local, user-level, quickstart layers. Verified via integration test / grep.
- [ ] Onboarding wizard, team-builder, and runtime cockpit continue to work unchanged (regression gate).

---

## 11. Assessment

### Critique Findings (applied before finalization)

Reviewed against the architectural-lock-in rubric and the critique dimensions in the task:

**CRITICAL — fixed before writing final spec**:
1. **Phase 9 browser compatibility**: Original design had `checksum.ts` use Node `crypto` AND be imported by pure-logic modules. Fixed: `checksum.ts` is flagged as extension-side only; `versioning.ts`, `export-envelope.ts`, `errors.ts` are pure Zod/TS. Webview imports go through message bridge. Documented in section 3.7 + risk row. (No code duplication needed; Phase 9 already plans message-passing to the extension.)
2. **LayeredTeamRepository `saveTeam` routing**: Original draft had `saveTeam` route to the first-writable layer in `layers[]` order, which would default writes to project-local rather than user-level. Fixed: added explicit `defaultWriteLayer: "user-level"` in the workflow-tui composition; `saveTeamToLayer` handles explicit targeting. Existing `/team save` behavior unchanged.
3. **`.strict()` envelope vs future-version input**: Strict envelope would reject a v1.1.0 envelope pre-Zod-parse. Fixed: version is checked BEFORE envelope parse; mismatches throw `TeamVersionMismatchError` with a clean message, not a cryptic Zod strict rejection. Migration pipeline runs on envelope.config BEFORE envelope Zod parse, so new config fields don't fail strict.

**HIGH — addressed**:
4. **Error taxonomy `instanceof` vs `NamedError.create`**: Codebase has both conventions. `team/` module uses plain `class extends Error` (see `TeamDelegationError` / `TeamConcurrencyError` in `router.ts` via `team/index.ts:13`). We stay consistent with plain subclasses.
5. **Integration seam for `onImported`**: Import handler must call `Config.update({ ...current, team: imported })`. Originally spec buried this deep in command module. Promoted to explicit `handlers.onImported(config)` dependency-injected pattern so command module stays pure and testable.
6. **Test harness — round-trip for every quickstart, not just one**: Original draft tested one round-trip. Extended to all 5 quickstarts to satisfy "100% round-trip fidelity test" ROADMAP criterion.

**MEDIUM — noted, non-blocking**:
7. **`exportedBy` default**: `undefined` is correct; git-config fallback deferred.
8. **Palette-click prompt flow**: OQ-1 — palette shows a toast hint instead of blocking modal for v1. Acceptable scope trade-off.
9. **`.planning/team.json` gitignore policy**: Documented as user-discretion; no automatic gitignore edit. Prevents surprising users who want to commit it.

### Verdict: PASS
**Complexity**: Medium.
  - 8 NEW source files + 3 EDIT; 8 NEW test files + 2 integration.
  - Pure modules dominate — low risk per module.
  - One composite pattern (LayeredTeamRepository) adds indirection but is well-scoped.
  - Zero new dependencies; all primitives come from Node stdlib (`fs`, `path`, `crypto`, `os`) + existing Zod.
  - Docs rewrite is straightforward content work.
  - Not "Simple" because the error taxonomy + 8-case malformed-input matrix + envelope/config separation requires careful design.
  - Not "Complex" because there's no new external surface (HTTP, subprocess, cross-package dep edge) and the architecture lines up with 5 prior phases of precedent.

**Plan count**: 2, matching ROADMAP. Wave 1 produces only pure modules with their own tests (no integration seams touched); Wave 2 wires integration + docs. Clean dependency edge.

**Recommended agent mix** (pointers — orchestrator selects):
- Wave 1: Backend Architect (schema + versioning + envelope design) + Senior Developer (pure-module implementation + tests). Reviewer: QA Verification Specialist (round-trip + malformed matrix).
- Wave 2: Senior Developer (integration wiring in command-input + index.tsx) + Frontend Developer (command-input.tsx is SolidJS/JSX, and handler-injection pattern benefits from component expertise) + Technical Writer (docs rewrite). Reviewer: QA Verification Specialist (regression gate + docs accuracy) + optionally Backend Architect (verify precedence semantics hold across layers).

**Confidence**: HIGH.
  - Every design decision has a concrete precedent in existing phases (Config.update → Phase 2; command registration → Phase 4; repository seam → Phase 4; DOM+terminal-safe placement → Phase 3+5; `.strict()` rejection → Config.Info; Zod-as-single-source → `CanonicalTeamConfig.superRefine`).
  - No new technology, package, or architectural pattern introduced.
  - All edge cases (versioning, strict envelope, LayeredRepository precedence, Phase 9 compatibility) were surfaced during Stage 2 research and resolved in the design.
  - Round-trip test is the strongest acceptance signal; it either passes or fails unambiguously.

**Carry-forward open risks**:
- OQ-1 (palette-click prompt flow) — non-blocking; prompt-driven invocation works.
- Phase 7 DAG addition interacts with envelope version bump — resolved by migration pipeline design; Phase 7 spec references this phase.
- Future `kilo team export` CLI subcommand (non-TUI) is a small addition on top of `io.ts`. No Phase 6 commitment.
- Phase 8 signed-manifest wrapper will add around envelope, not inside it. No envelope schema churn needed.

---

*End of Spec — Phase 6 Team Export/Import & Persistence Layer*
