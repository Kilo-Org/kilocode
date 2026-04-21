# Phase 6: Team Export/Import & Persistence Layer — Context

## Phase Goal
Ship JSON-file-based team portability. `/team export <path>` writes a `TeamExportEnvelope` JSON file with schema version + checksum. `/team import <path>` reads + validates + migrates older versions transparently. Persistence precedence chain: project-local `.planning/team.json` > user-level `~/.local/share/kilo/teams/<id>.json` > bundled quickstart. 100% round-trip fidelity across all 5 quickstart templates. Malformed input rejected with structured error classes. Docs published at `packages/devil-docs/pages/collaborate/teams/team-management.md`.

## Requirements Covered
- **P6-R1: Team export/import (JSON files)** — `/team export <path>` writes `TeamExportEnvelope` { version, checksum, config, exportedAt, exportedBy? }; `/team import <path>` reads, version-gates, migrates, envelope-parses, checksum-verifies, canonical-config-validates, and invokes `handlers.onImported(config)` to persist via `Config.update(read-then-merge)`. Round-trip test for every quickstart template. 8 malformed-input cases each asserting a specific error class + kind/field. Precedence chain via new `LayeredTeamRepository` composite replacing direct `createFileSystemTeamRepository()` at the composition site. Docs rewrite.

(REQUIREMENTS.md not present — descriptions sourced from ROADMAP.md Phase 6 success criteria + spec `.planning/specs/06-team-export-import-spec.md`.)

## What Already Exists (from prior phases)

### Phase 1 outputs (Foundation)
- `packages/opencode/src/devilcode/team/library.ts` — `POSITION_LIBRARY` + `CanonicalPosition` enum
- `packages/opencode/src/devilcode/team/capabilities.ts` — `STAGE_CAPABILITY_REQUIREMENTS` + `CanonicalCapability`
- `packages/opencode/src/devilcode/team/config.ts` — `CanonicalTeamConfig` Zod schema with `superRefine` stage-coverage validator (the primary validator Phase 6 wraps with envelope)

### Phase 2 outputs (Preset Migration)
- `packages/opencode/src/devilcode/team/migration.ts` — `migrateLegacyTeamConfig`, `fromLegacyTeamConfig`; Phase 6 extends with `isLegacyShape()` heuristic + `migrateTeamConfig(raw)` pipeline reusing the legacy detector
- `packages/opencode/src/devilcode/team/quickstarts/` — 5 bundled JSON templates + `loadQuickstartTemplates()` memoized loader (Phase 6 `createQuickstartTeamRepository()` wraps this read-only)
- `Config.update(config: Info)` read-then-merge pattern established for team persistence; Phase 6 import handler calls `Config.update({...current, team: imported})` identically

### Phase 3 outputs (TUI Scaffolding)
- `packages/devil-keybind/` — `createCommandRegistry` + `CommandData` Zod schema; Phase 6 registers `/team export` + `/team import` commands via same `register()` pattern Phase 4 team-builder uses
- Phase 3 command registration precedent: `workflow-tui/views/team-builder-commands.ts`

### Phase 4 outputs (Team Builder Views)
- `packages/opencode/src/devilcode/team/repository.ts` — `TeamRepository` interface + `createFileSystemTeamRepository()`. Phase 6 ADDS two new implementations (`createProjectLocalTeamRepository`, `createQuickstartTeamRepository`) + a composite (`createLayeredTeamRepository`) all honoring the SAME interface.
- `TeamBuilderProvider` pattern — DI-friendly repository prop; Phase 6 mirrors this with `TeamIOCommandHandlers` injection at command-module level

### Phase 5 outputs (Runtime Cockpit)
- `workflow-tui/index.tsx` mode router (onboarding | workflow | team-builder); instantiates `teamRepo = createFileSystemTeamRepository()` inside `WorkflowView` body. **Phase 6 Task 2 Wave 2 swaps this to `createLayeredTeamRepository(...)`**.
- `command-input.tsx` — slash-command dispatch via `cmd.startsWith(...)` branches. Phase 6 adds two branches: `"team export "` and `"team import "`.
- `Config.Info.workflow = { density, firstRunComplete, autoCompactFired }` schema; import does NOT touch workflow field — it touches the separate `team` field.
- 329 tests green (195 devil-ui + 134 opencode/devilcode); Phase 6 must keep all green.

## Key Design Decisions

### Architecture: Clean (selected from 3 proposals)
- **Why Clean over Minimal/Pragmatic**: Phase 8 (Registry & Marketplace) reuses envelope + checksum + versioning verbatim as the on-wire manifest payload; Phase 9 (VS Code webview) imports pure Zod/TS modules (`versioning.ts`, `export-envelope.ts`, `errors.ts`) directly and proxies Node-only modules (`io.ts`, `checksum.ts`) via the existing `KiloConnectionService` message bridge. Minimal (inline everything in one io.ts) forces Phase 8 to re-extract envelope/checksum and Phase 9 to duplicate error taxonomy. Pragmatic (half-extracted) leaves precedence as an ad-hoc function and layered-repo as undocumented behavior. Clean matches Phase 3/4/5 user-selected precedent (Phase 9 zero-rework prioritized).
- **Trade-off accepted**: 8 NEW source files + 8 NEW test files + 3 EDITs + 2 integration tests + 2 docs EDIT/NEW. Estimated ~940 LOC source + ~780 LOC tests + ~220 LOC docs = ~1,940 total. Auto-refine critique will surface cycle-1 fixes; budget 2 cycles per Phase 3-5 pattern.

### Wave structure
- **Wave 1 (Plan 06-01)**: Pure modules — `versioning.ts`, `checksum.ts`, `errors.ts`, `export-envelope.ts`, `io.ts`, `layered-repository.ts`, `repositories/project-local.ts`, `repositories/quickstart.ts`. Zero integration with TUI. Unit tests + round-trip integration test (all 5 quickstarts). No composition-site edits. Wave 1 exits with a usable `io.ts` + layered repo; nothing wired yet.
- **Wave 2 (Plan 06-02)**: Commands + integration + docs — `workflow-tui/commands/team-io.ts` (command registration + handler-injection pattern); `workflow-tui/index.tsx` swap to `createLayeredTeamRepository(...)`; `command-input.tsx` adds two startsWith branches; docs rewrite; `collaborate/index.md` link update. Full Phase 5 regression gate.

### Schema versioning contract
- `CURRENT_TEAM_CONFIG_VERSION = "1.0.0"` (string literal; enables future `"2.0.0"` for Phase 7 DAG; semver for clarity).
- `TeamConfigVersion` exported as `z.enum(["1.0.0"])` for envelope schema.
- `migrateTeamConfig(raw: unknown): Promise<CanonicalTeamConfig>` pipeline:
  1. Detect legacy shape via existing `isLegacyShape(raw)` heuristic (Phase 2 migration.ts) → if legacy, `migrateLegacyTeamConfig(raw)` → return.
  2. Otherwise treat as current canonical shape; `CanonicalTeamConfig.parse(raw)` → return.
- Version field lives in ENVELOPE, not `CanonicalTeamConfig`. Keeps config Zod schema unchanged. Envelope wraps.
- Forward-version handling: `TeamVersionMismatchError` surfaced BEFORE envelope `.strict()` parse so user gets a clean upgrade-prompt message instead of cryptic Zod strict rejection.

### Checksum contract
- Algorithm: sha256.
- Input: `stableStringify(config)` — recursive sorted-key JSON stringify. ~25 LOC pure function in `checksum.ts`. Undefined values elided; arrays preserve order (not sorted); nested objects recursed.
- Verification: `timingSafeEqual(expectedBuf, computedBuf)` to prevent timing leaks (defensive; low real-world risk).
- **Critical invariant**: checksum computed over `config` object AFTER `migrateTeamConfig()` has normalized it. Pre-migration input and post-migration canonical produce different checksums — expected and documented.
- Envelope's `checksum` field is the checksum of the ORIGINAL `config` as embedded in the envelope (not the post-migration form). Importer verifies against envelope checksum first, THEN runs migration.
- Actually reversed: per spec — migration runs first, THEN checksum verifies against migrated config. (See Risk #11 in spec §8 for the forward-compat rationale — migration bumps config shape AND envelope internally tracks the expected checksum for its OWN version.)

### Envelope schema
```ts
export const TeamExportEnvelope = z.object({
  version: TeamConfigVersion,              // z.enum(["1.0.0"])
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  config: CanonicalTeamConfig,
  exportedAt: z.string().datetime(),
  exportedBy: z.string().optional(),       // nullable; no git-config auto-fill in v1
}).strict()
```
`.strict()` rejects unknown top-level keys (forward-compat additions must bump version). Version-gate pre-check protects from strict-rejection cryptic messages.

### Error taxonomy — plain subclasses (not `NamedError.create`)
Precedent: `TeamDelegationError` + `TeamConcurrencyError` in `team/router.ts` use plain `class ... extends Error`. Phase 6 follows same convention:
- `TeamImportError` (base; has `kind: "file-not-found" | "json-parse-failed" | "envelope-invalid" | "version-mismatch" | "checksum-failed" | "config-invalid"`)
- `TeamVersionMismatchError extends TeamImportError` (has `found: string`, `required: string`)
- `TeamChecksumError extends TeamImportError`
- `TeamSchemaValidationError extends TeamImportError` (has `issues: ZodIssue[]`, `layer: "envelope" | "config"`)

### LayeredTeamRepository composition
- Constructor: `createLayeredTeamRepository({ layers: Array<{name, repository, writable?}>, defaultWriteLayer?: string })`.
- Read (loadTeam/listTeams): walks `layers[]` in declared order; returns first hit; listTeams dedups by `id` favoring earlier layer.
- Write (saveTeam): targets `defaultWriteLayer` (by name) if provided; else first `writable !== false` layer. Writing to a specific layer: `saveTeamToLayer(layerName, id, config)` extension method (non-interface).
- Default composition in `workflow-tui/index.tsx`:
  ```ts
  createLayeredTeamRepository({
    layers: [
      { name: "project-local",  repository: createProjectLocalTeamRepository({ cwd: Instance.directory }), writable: true },
      { name: "user-level",     repository: createFileSystemTeamRepository(), writable: true },
      { name: "quickstart",     repository: createQuickstartTeamRepository(), writable: false },
    ],
    defaultWriteLayer: "user-level",  // preserves Phase 5 onboarding-wizard save destination
  })
  ```
- `defaultWriteLayer: "user-level"` invariant preserves existing Phase 5 `teamRepo.saveTeam("default", config)` semantics. OnboardingWizard saves unchanged.

### Project-local repo contract
- Path: `{cwd}/.planning/team.json` (single file, not a dir).
- Reserved id: `"project"`. loadTeam/saveTeam/deleteTeam for any other id throws.
- `listTeams()`: returns single-entry array if file exists, empty otherwise.
- File missing → empty list / `TeamImportError{kind:"file-not-found"}` on loadTeam.
- saveTeam auto-creates `.planning/` dir.
- NOT auto-gitignored. User decides whether to commit (docs call this out explicitly).

### Quickstart repo contract
- Wraps existing `loadQuickstartTemplates()` memoized loader.
- Read-only: saveTeam/deleteTeam throw.
- listTeams: returns all 5 quickstart templates with stable ids matching JSON file basenames (`solo-enhanced`, `code-review-pair`, `full-stack-team`, `ci-cd-pipeline`, `research-team`).
- No new static imports — reuses the Phase 2 static-import chain (Bun `--compile` safe).

### Pure IO module (`io.ts`)
- `exportTeamToFile(filePath, config, { exportedBy? })`: Promise<TeamExportEnvelope>. Validates config via `CanonicalTeamConfig.parse` pre-write (fail fast). Computes checksum. Writes envelope as pretty JSON + trailing newline (`JSON.stringify(envelope, null, 2) + "\n"`). Returns envelope.
- `importTeamFromFile(filePath)`: Promise<CanonicalTeamConfig>. Pipeline:
  1. Read file → `TeamImportError{kind:"file-not-found"}` on ENOENT
  2. `JSON.parse` → `TeamImportError{kind:"json-parse-failed"}` on SyntaxError
  3. Detect envelope vs bare-config: presence of `{version, checksum, config}` triple → envelope path; else bare-config path (for legacy v1 users who had raw CanonicalTeamConfig JSON).
  4. Bare-config path: `migrateTeamConfig(raw) → CanonicalTeamConfig.parse(migrated)` → return. Wraps Zod error in `TeamSchemaValidationError{layer:"config"}`.
  5. Envelope path: version-gate (version === CURRENT_TEAM_CONFIG_VERSION else throw `TeamVersionMismatchError`) → `TeamExportEnvelope.parse(raw)` wrapping Zod error in `TeamSchemaValidationError{layer:"envelope"}` → migrate envelope.config → verify checksum against migrated config → throw `TeamChecksumError` if mismatch → return migrated config.
- No TUI dependencies; importable by Phase 8 registry logic unchanged.

### Command module + handler injection pattern
- `workflow-tui/commands/team-io.ts` exports:
  ```ts
  export type TeamIOCommandHandlers = {
    getActiveTeam: () => CanonicalTeamConfig | undefined
    onImported: (config: CanonicalTeamConfig) => Promise<void>   // caller persists via Config.update
    prompt: (placeholder: string) => Promise<string | undefined>  // palette-click fallback (v1: returns undefined + toast hint)
    toast: { success; error; warning }
  }
  export function exportCommand(args: { path: string }, handlers: TeamIOCommandHandlers): Promise<void>
  export function importCommand(args: { path: string }, handlers: TeamIOCommandHandlers): Promise<void>
  export function registerTeamIOCommands(register: RegisterFn, handlers: TeamIOCommandHandlers): () => void
  ```
- `exportCommand` / `importCommand` are the pure handler functions; registered commands delegate. `command-input.tsx` branches directly call `exportCommand({path: args}, handlers)` / `importCommand({path: args}, handlers)`.
- Handler-injection keeps command module pure (testable without real Config/toast).

### Integration seam — `Config.update` read-then-merge
- Import success: `handlers.onImported(config)` invoked → caller (command-input.tsx) runs `Config.update(config => ({...config, team: imported}))` following Phase 2 pattern.
- No direct `Config.update` or toast side effect inside command module.

### Palette-click fallback (OQ-1, deferred)
- CommandPalette entries for "Team: Export" / "Team: Import" show a toast hint: `"Type 'team export <path>' or 'team import <path>' in the prompt to execute"`. Blocking modal for path input deferred to Phase 10 polish.

### Tests
- Unit: 8 `.test.ts` files (versioning / checksum / errors / export-envelope / io / layered-repository / project-local / quickstart).
- Integration: `io.round-trip.test.ts` — for EACH of 5 quickstarts: export → re-import → assert `stableStringify(imported) === stableStringify(original)` + `envelope.version === "1.0.0"` + checksum valid.
- Commands: `team-io.commands.test.ts` (mocks `TeamIOCommandHandlers`, asserts each error class → correct toast variant) + `team-io.prompt.test.ts` (structural grep of command-input.tsx for both startsWith branches + import statement).
- Regression gate: all Phase 5 tests still pass (329 green target).

### Docs
- `team-management.md` rewritten (~220 LOC Markdoc):
  Sections: Overview · Quickstart · `/team export` · `/team import` · File Format (envelope schema + examples) · Precedence Diagram · Schema Evolution · Error Modes (table mapping error class → user action) · Sharing Workflows (email / Git / `.planning/team.json` committed) · Troubleshooting · FAQ.
- `collaborate/index.md` link description updated.

### Agent assignments rationale
- **Plan 06-01 (Wave 1)**: engineering-backend-architect (envelope + versioning + checksum schema design; error taxonomy; LayeredTeamRepository protocol) + engineering-senior-developer (pure-module implementation + unit tests + round-trip test). Reviewer: testing-qa-verification-specialist (malformed-input matrix + round-trip for all 5 quickstarts).
- **Plan 06-02 (Wave 2)**: engineering-senior-developer (integration wiring in `workflow-tui/index.tsx` + `command-input.tsx` branches + `Config.update` bridge) + engineering-frontend-developer (command module in SolidJS + handler-injection DI pattern per Phase 4 precedent) + technical-writer (docs rewrite in Markdoc). Reviewer: testing-qa-verification-specialist (Phase 5 regression gate + docs accuracy) + engineering-backend-architect (verify LayeredTeamRepository precedence semantics + `defaultWriteLayer: "user-level"` invariant holds in live composition).
- ROADMAP-recommended UX Researcher / Security Engineer roles folded out: Phase 6 scope has no user-flow redesign (commands are prompt-driven) and security review is deferred to Phase 8 (signed manifests).

## Open Items Carried From Spec
- **OQ-1**: Palette-click prompt flow — palette shows toast hint; blocking modal deferred to Phase 10 polish.
- **OQ-2**: `/team export` empty-path default — rejected with usage message in v1; future default `.planning/team.json` deferred.
- **`.planning/team.json` gitignore policy**: User-discretion; no automatic gitignore edit. Docs call this out.
- **`exportedBy` default**: `undefined`; git-config fallback deferred.
- **Phase 7 DAG interaction**: Migration pipeline is the extension hook; Phase 7 spec will chain v1→v2 migration.
- **Phase 8 registry reuse**: Envelope + checksum + versioning imported unchanged; signed-manifest wraps AROUND envelope.
- **Phase 9 webview compatibility**: Pure modules (versioning/envelope/errors) browser-safe; Node-only modules (io/checksum) proxied via KiloConnectionService message bridge. No code duplication.

## Plan Structure
- **Plan 06-01 (Wave 1)**: Pure Modules — 8 NEW source files (versioning, checksum, errors, export-envelope, io, layered-repository, repositories/project-local, repositories/quickstart) + 8 NEW unit tests + 1 round-trip integration test + barrel export update in `team/index.ts`.
- **Plan 06-02 (Wave 2)**: Commands + Integration + Docs — `workflow-tui/commands/team-io.ts` registration module; `workflow-tui/index.tsx` swap to LayeredTeamRepository; `command-input.tsx` adds `team export|import` branches; `team-management.md` rewrite; `collaborate/index.md` link; 2 integration tests.
