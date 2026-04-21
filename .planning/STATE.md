# Project State

## Current Position
- **Phase**: 9 of 10 (executed, pending review)
- **Status**: Phase 9 under review — cycle 1/3 complete, 0 blockers remaining
- **Last Activity**: Phase 9 review cycle 1 fixes committed (2026-04-21)

## Progress
```
[#######################] 92% — 23/25 plans complete (Phase 9 REVIEW CYCLE 1 COMPLETE ✓)
```

## Next Action
Review cycle 2/3 in progress — re-verification of all cycle 1 fixes.

## Phase 9 Plan Structure (planned 2026-04-21, refine_cycle=2)

| Plan | Wave | Deps | Primary Agents | Reviewer |
|---|---|---|---|---|
| 09-01 CLI Backend Foundation — Team CRUD routes + aggregation endpoint + tests | 1 | Phase 8 | Backend Architect | QA Verification Specialist |
| 09-02 Extension Layer — DevilConnectionService methods + message contracts + TeamBuilderHandler | 2 | 09-01 | Senior Developer | QA Verification Specialist |
| 09-03 Webview UI — TeamBuilderTab + dashboards + SDK exports | 3 | 09-02 | Frontend Developer | QA Verification Specialist |

## Phase 9 Architecture Decision
- Selected **Clean** after 3 parallel proposal agents (Minimal/Clean/Pragmatic) — user prioritized Phase 10 zero-rework (consistent with Phases 3-8).
- Server-side aggregation endpoint at `/devilcode/workflow/aggregations`
- devil-ui component reuse (StageCoverageIndicator, TabGroup)
- Type-safe message contracts (discriminated unions)
- Isolated TeamBuilderHandler class
- SDK type exports (manual, no generator)
- Spec written to `.planning/specs/09-vscode-telemetry-spec.md` (Medium-Complex)
- Estimated ~1,700 LOC source + ~500 LOC tests = ~2,200 total across Phase 9

## Phase 9 Auto-Refine History

- **2026-04-21 cycle 0** → 3 competing architecture proposals (Minimal/Clean/Pragmatic) spawned. User selected **Clean**. Spec pipeline (5 stages) produced `.planning/specs/09-vscode-telemetry-spec.md`; 3 plan files generated (09-01 Wave 1, 09-02 Wave 2, 09-03 Wave 3).
- **2026-04-21 cycle 1** → Pre-Mortem + Assumption Hunt returned **REWORK**. 5 fixes applied:
  - R1: SDK types are MANUAL (no generate.ts exists) — added explicit type definitions to Plan 09-03
  - R2: Shared message types pattern — single source of truth at `src/messages/team-builder-types.ts`
  - R3: Error handling with try/catch + `teamBuilder.error` message type
  - R4: `Instance.directory` for planning path resolution in aggregation route
  - R5: Performance query params (`?since`, `?limit=10000` default)
- **2026-04-21 cycle 2** → Verification returned **CAUTION**. All 5 fixes HELD. 3 clarifications added:
  - Type validation test for SDK ↔ CLI schema consistency
  - Direct copy approach for webview message types (esbuild compatible)
  - Backwards compatibility note for query param defaults
- **AUTO_REFINE limit reached (2 cycles)** — plans at refine_cycle=2. Verdict: **CAUTION** accepted.

## Phase 9 Open Risks (documented, not blocking execution)

- **SDK type maintenance**: Manual types require discipline; CI test validates shape consistency
- **Event log scaling**: Default limit=10000 events; archival recommended for >10MB logs
- **Chart rendering**: Plain SVG may need canvas fallback for >1000 data points
- **Phase 10 prep**: Live team editing will extend TeamBuilderHandler; message contract patterns established

## Phase 9 Wave Results

### Wave 1 Results (09-01)
- CLI Backend Foundation — Complete ✓
  - `workflow/aggregations.ts`: AggregationResponse interface + computeAggregations + computeAggregationsFromEvents + emptyAggregations. Since/limit query params; default limit 10000.
  - `server/routes/config.ts`: 4 Team CRUD routes: GET/GET:id/PUT:id/DELETE /config/team
  - `workflow/routes.ts`: GET /devilcode/workflow/aggregations route
  - 25 new tests pass (13 aggregation + 12 team-routes)

### Wave 2 Results (09-02)
- Extension Layer — Complete ✓
  - `src/messages/team-builder-types.ts`: Single source of truth for all team builder message contracts (5 in + 5 out types + union exports)
  - `src/agent-manager/team-builder-handler.ts`: Isolated handler class with full try/catch on all 5 message types
  - `src/services/cli-backend/connection-service.ts`: 5 team methods added
  - `src/agent-manager/AgentManagerProvider.ts`: Delegates to TeamBuilderHandler in onMessage()
  - All devil-vscode CI checks pass: typecheck + format:check + knip

### Wave 3 Results (09-03)
- Webview UI — Complete with Warnings ✓
  - `webview-ui/agent-manager/TeamBuilderTab.tsx` (295 LOC): Team list sidebar, editable fields, role table, save button, stage coverage count
  - `webview-ui/agent-manager/dashboards/TelemetryDashboards.tsx`: 4 plain-SVG charts with empty-state handling
  - `webview-ui/agent-manager/AgentManagerApp.tsx`: Top-level nav bar with Agent Manager | Team Builder | Telemetry
  - `sdk/js/src/team.ts`: Manual type definitions for external consumers
  - Warning: pre-existing `@devilcode/kilo-ui` typecheck errors (TS2307 module resolution — unrelated to Phase 9)

## Phase 8 Wave Results

### Wave 1 Results (08-01)
- Registry module foundation — Complete ✓
  - `team/registry/manifest.ts`: TeamRegistryManifest, TeamManifestMetadata, RegistryIndex (all .strict(), browser-safe)
  - `team/registry/errors.ts`: TeamRegistryError + 4 subclasses (browser-safe)
  - `team/registry/signing.ts`: Ed25519 sign/verify via Node crypto; generateKeyPair, signManifest, verifyManifestSignature, getPublicKeyFingerprint
  - `team/registry/http-client.ts`: fetchManifest with SSRF protection (net.isIPv4/IPv6 numeric range checks blocking RFC-1918, loopback, link-local 169.254.x.x, IPv4-mapped IPv6), 5 MB body cap
  - `team/registry/trust-store.ts`: Explicit key-pinning trust store at ~/.local/share/kilo/registry/trusted-publishers.json
  - 72 tests pass across 5 test files

### Wave 2 Results (08-02)
- I/O orchestration + TUI commands — Complete ✓
  - `team/registry/io.ts`: publishManifest + installManifest; skipTrustCheck decoupled from crypto verification; verifyWithKey option for trust-store-bypass with crypto enforcement
  - `workflow-tui/commands/team-registry.ts`: publishCommand, installCommand (requireSignature forwarded), trustCommand, untrustCommand, registerTeamRegistryCommands
  - `workflow-tui/command-input.tsx`: all 4 command branches; --publisher-id extracted; --require-signature flag parsed and forwarded
  - 39 new tests (13 io + 15 commands + 11 integration)

### Wave 3 Results (08-03)
- Security review + docs — Complete ✓
  - `test/devilcode/team/registry/security.test.ts`: 26 tests across Signature Forgery Resistance, Manifest Tampering Detection, Trust Store Integrity, Install Safety (including forged-key rejection with verifyWithKey)
  - `devil-docs/pages/collaborate/teams/team-registry.md`: full registry docs with updated team install syntax, --require-signature argument table row, and example
  - `devil-docs/pages/collaborate/index.md`: Team Registry link added

### Review Cycles
- Cycle 1 (FAIL→fixed): skipTrustCheck bypass, SSRF, body size limit, toast variant, --publisher-id forwarding, placeholder test
- Cycle 2 (NEEDS WORK→fixed): SSRF regex bypass vectors (decimal int IP, IPv4-mapped IPv6, 169.254.x.x), --require-signature TUI wiring
- Cycle 3 (Security PASS, QA NEEDS WORK→fixed): docs syntax block/table incomplete, no --require-signature regression tests
- Cycle 4 (PASS): All findings resolved. 472/472 tests pass.

## Phase 7 Wave Results

### Wave 1 Results
- Plan 07-01 (Wave 1): DAG Module + Schema Integration — Complete.
  - `team/dag/schema.ts`: WorkflowDAG, WorkflowDAGEdge, DAGOverride Zod schemas (R1-01: z.record string + refine)
  - `team/dag/validator.ts`: validateDAG() + 7 DAGError types + formatDAGError() (R1-02) + Kahn's+BFS split
  - `team/dag/helpers.ts`: getNextStage(), getEntryStage(), generateDefaultDAG()
  - `team/config.ts`: workflowOverride field + DAG superRefine validation
  - `team/versioning.ts`: CURRENT_TEAM_CONFIG_VERSION = "1.1.0"; identity migration 1.0.0→1.1.0
  - `team/io.ts`: version check uses TeamConfigVersion.safeParse() (not hard equality)
  - 64 tests pass (13 schema + 22 validator + 12 helpers + 17 integration), 93 expect() calls

### Wave 2 Results
- Plan 07-02 (Wave 2): UI + Runtime Integration — Complete.
  - `devil-ui/primitives/dag-editor/`: DAGEditor SolidJS component + local types (R2-02: no cross-package import)
  - `devil-ui/package.json`: dag-editor exports map entry
  - `team-builder-context.tsx`: dagDraft/dagErrors/advancedMode state + setAdvancedMode/updateDAG(R2-03)/resetDAGToDefault actions
  - `team-builder-view.tsx`: Workflow tab + advanced-mode DAGEditor (readOnly=true, v1 display-only)
  - `workflow/index.ts`: Workflow.nextStage() uses getNextStage() for custom DAGs; falls back to generateDefaultDAG()
  - 16 dag-runtime structural tests; 306 total tests pass, 664 expect() calls
  - All CI gates: knip + format:check + check-devilcode-change clean

## Phase 7 Plan Structure (planned 2026-04-21, refine_cycle=2)

| Plan | Wave | Deps | Primary Agents | Reviewer |
|---|---|---|---|---|
| 07-01 DAG Module + Schema Integration — schema/validator/helpers + config workflowOverride + version 1.1.0 + 3 synthetic DAGs | 1 | Phase 6 | Backend Architect + Senior Developer | QA Verification Specialist |
| 07-02 UI + Runtime Integration — devil-ui dag-editor primitive + team-builder Workflow tab + orchestrator getNextStage() | 2 | 07-01 | Frontend Developer + Senior Developer | QA Verification Specialist |

## Phase 7 Architecture Decision
- Selected **Clean** (vs Minimal / Pragmatic) after 3 parallel proposal agents — user prioritized Phase 9 zero-rework (matches Phases 3-6 precedent).
- New `team/dag/` module: schema.ts (WorkflowDAG, WorkflowDAGEdge, DAGOverride), validator.ts (validateDAG + DAGError types + formatDAGError + Kahn's algorithm), helpers.ts (getNextStage, getEntryStage, generateDefaultDAG), index.ts (barrel).
- Explicit edge representation `{ from, to, condition? }` supports non-linear DAGs and future conditional branching.
- `capabilityOverrides` uses `z.record(z.string(), ...)` with refine (not `z.record(WorkflowStage, ...)` which requires ALL enum keys in Zod v4).
- Config integration: `CanonicalTeamConfig.workflowOverride?: DAGOverride` with DAG validation in superRefine.
- Version bump to 1.1.0; identity migration from 1.0.0.
- devil-ui primitive: `primitives/dag-editor/` with local type definitions (avoids cross-package import complexity).
- Team-builder integration: Workflow tab with advanced mode toggle (hidden by default).
- Runtime: `getNextStage(current, effectiveDAG)` replaces hardcoded stage array.
- Spec written to `.planning/specs/07-configurable-dag-spec.md` (Medium complexity; PASS verdict, HIGH confidence).
- Estimated ~350 LOC source + ~250 LOC tests = ~600 total across Phase 7.

## Phase 7 Auto-Refine History

- **2026-04-21 cycle 0** → 3 competing architecture proposals (Minimal/Clean/Pragmatic) spawned as Explore agents. User selected **Clean**. Spec pipeline produced `.planning/specs/07-configurable-dag-spec.md` (Medium rating); 2 plan files generated (07-01 Wave 1, 07-02 Wave 2).
- **2026-04-21 cycle 1** → Pre-Mortem (QA Verification Specialist) + Assumption Hunt (Sprint Prioritizer) returned **REWORK**. 5 surgical fixes applied:
  - R1-01: `capabilityOverrides` schema changed to `z.record(z.string(), ...)` with refine — Zod v4 `z.record(WorkflowStage, ...)` requires ALL enum keys present.
  - R1-02: Added `formatDAGError()` export to validator.ts specification.
  - R2-01: Fixed file reference `team-builder.tsx` → `team-builder-view.tsx` (actual filename).
  - R2-02: DAGEditor types defined locally in devil-ui — avoids cross-package import complexity.
  - R2-03: `updateDAG()` action null-safety — check `store.draft.roles` existence before iteration.
- **2026-04-21 cycle 2** → Verification returned **CAUTION**. All 5 fixes HELD in plan text. CAUTION due to "code not yet implemented" — expected since this is planning phase.
- **AUTO_REFINE limit reached (2 cycles)** — plans at refine_cycle=2 with Cycle 1 refinements folded in. Verdict: **CAUTION** accepted. No further auto-refine.

## Phase 7 Open Risks (documented, not blocking execution)

- **Type sharing**: devil-ui defines DAGEditor types locally; Phase 9 may extract to shared types package if friction surfaces.
- **Conditional edges deferred**: Schema supports `condition?: string` on edges; runtime ignores in v1; documented as "reserved for Phase 9+".
- **Visual DAG editor deferred**: CSS-based layout for v1; no external graph library.
- **Cross-package import**: team/dag/ types mirrored in devil-ui to avoid @devilcode/cli import complexity.

## Phase 6 Plan Structure (planned 2026-04-19, refine_cycle=2)

| Plan | Wave | Deps | Primary Agents | Reviewer |
|---|---|---|---|---|
| 06-01 Pure Modules — versioning/checksum/errors/envelope/io/layered-repo + project-local + quickstart repos | 1 | Phase 5 | Backend Architect + Senior Developer | QA Verification Specialist |
| 06-02 Commands + Integration + Docs — team-io.ts command module + LayeredTeamRepository composition swap + command-input.tsx branches + team-portability.md docs | 2 | 06-01 | Senior Developer + Frontend Developer + Technical Writer | QA Verification Specialist + Backend Architect |

## Phase 6 Architecture Decision
- Selected **Clean** (vs Minimal / Pragmatic) after 3 parallel proposal agents — user prioritized Phase 8 registry reuse + Phase 9 zero-rework (matches Phase 3/4/5 precedent).
- 8 new source modules: versioning.ts (TeamConfigVersion + CURRENT_TEAM_CONFIG_VERSION + migrateTeamConfig pipeline), checksum.ts (stableStringify + sha256 + timingSafeEqual verify), errors.ts (4 plain Error subclasses: TeamImportError/VersionMismatch/Checksum/SchemaValidation), export-envelope.ts (`.strict()` Zod schema with version/checksum/config/exportedAt/exportedBy), io.ts (pure exportTeamToFile + importTeamFromFile), layered-repository.ts (LayeredTeamRepository composite with saveTeamToLayer extension), repositories/project-local.ts (`.planning/team.json` reserved id "project"), repositories/quickstart.ts (read-only wrapper over loadQuickstartTemplates).
- 1 new command module: workflow-tui/commands/team-io.ts with handler-injection DI pattern (TeamIOCommandHandlers type).
- Composition-site edits: workflow-tui/index.tsx swap `createFileSystemTeamRepository()` → `createLayeredTeamRepository({..., defaultWriteLayer: "user-level"})` preserving Phase 5 OnboardingWizard save semantics; command-input.tsx adds two `cmd.startsWith("team export|import ")` branches with teamIOHandlers() closure.
- Docs: NEW `packages/devil-docs/pages/collaborate/teams/team-portability.md` (NOT overwriting existing `team-management.md` which holds unrelated member-management content) + `collaborate/index.md` link entry.
- Spec written to `.planning/specs/06-team-export-import-spec.md` (gather → research → write → critique → assess complete; Medium complexity; PASS verdict, HIGH confidence).
- Estimated ~940 LOC source + ~780 LOC tests + ~220 LOC docs = ~1,940 total across Phase 6.

## Phase 6 Auto-Refine History

- **2026-04-19 cycle 0** → 3 competing architecture proposals (Minimal/Clean/Pragmatic) spawned as Explore agents. User selected **Clean**. Spec pipeline produced `.planning/specs/06-team-export-import-spec.md` (Medium rating); 2 plan files generated (06-01 Wave 1, 06-02 Wave 2).
- **2026-04-19 cycle 1** → Pre-Mortem (QA Verification Specialist) + Assumption Hunt (Sprint Prioritizer) both returned **REWORK**. 16 surgical fixes applied via CYCLE 1 REFINEMENTS blocks in each plan file:
  - R1-01: Test dir moved from `test/kilocode/team/` to `test/devilcode/team/` (Phase 4+5 precedent).
  - R1-02: `isLegacyShape` heuristic REPLACED — role-name check was unsound (`reviewer`/`researcher`/`coordinator` are valid canonical CanonicalPosition values). Structural detector: canonical roles REQUIRE positionId; legacy shapes lack it.
  - R1-03: `migrateTeamConfig` MUST unwrap `migrateLegacyTeamConfig` discriminated-union Result (not `fromLegacyTeamConfig(raw as never)` which returns `LegacyMigrationResult`, not CanonicalTeamConfig).
  - R1-04: Quickstart repo `loadTeam(id)` returns `template.team` (unwrap QuickstartTemplate envelope), not whole template.
  - R1-05: File authoring order — errors → checksum → versioning → export-envelope (dep-topological).
  - R1-06: `crypto.timingSafeEqual` wrapped in defensive try/catch.
  - R1-07: Round-trip test baseline = Zod-parsed `templates[id].team`; no re-parse.
  - R2-01: `Instance.cwd()` does NOT exist — use `Instance.directory` (getter, no parens).
  - R2-02: `team-management.md` ALREADY EXISTS with unrelated member-management content; Phase 6 docs publish to NEW `team-portability.md` + adjacent link in `collaborate/index.md`.
  - R2-03: `getActiveTeam` closure reads via existing `team()` helper at command-input.tsx:48-52 (not speculative `wf.state.teamConfig`).
  - R2-04: `teamRepo` instantiation site is `WorkflowViewInner` (not `WorkflowView`); execution greps before editing.
  - R2-05: `RegisterFn = (cmd: Command) => () => void` declared LOCALLY per `team-builder-commands.ts:2-6` pattern (no central re-export).
  - R2-06: `check-devilcode-change` is definitive CI script name (not `check-kilocode-change`).
  - R2-07: Consolidate team imports to barrel `../team` in index.tsx.
  - R2-08: Cross-reference to R1-02 canonical-role name collision.
  - R2-09: Doc file rename cascade: frontmatter, internal anchors.
- **2026-04-19 cycle 2** → Reality Checker returned **CAUTION**. All 14 R1/R2 fixes HELD against actual source. 2 new CRITICALs + 10 CAUTIONs surfaced; surgical cycle-2 edits folded:
  - R1-08 (new): Trim barrel exports — `CURRENT_TEAM_CONFIG_VERSION`/`TeamConfigVersion`/`migrateTeamConfig`/`isLegacyShape`/`stableStringify` stay internal-only; avoids knip orphan risk. Public surface = error classes + envelope + io functions + 3 repo factories.
  - R2-10 (new): `/team init` lives in `workflow-commands.tsx`, NOT `command-input.tsx`. Phase 6 `team export|import` branches are FIRST `team ...` branches in command-input.tsx. Insert before `WorkflowStage.safeParse(cmd)` fallback.
  - R2-11 (new): `toast.show` requires `duration` field per existing convention (14 call sites). Success 3000ms, error 6000ms, warning 4000ms.
  - R2-12 (new): `Instance.directory` in SolidJS component body is a new pattern; add defensive try/catch → `process.cwd()` fallback (belt-and-suspenders).
  - R2-13 (new): `team-portability.md` frontmatter keys = `title:` + `description:`; collaborate/index.md link format = plain markdown `- [**Team Portability**](...) — ...` adjacent to existing team-management line.
- **AUTO_REFINE limit reached (2 cycles)** — plans at refine_cycle=2 with surgical cycle-2 edits folded in. Verdict: **CAUTION** accepted. No further auto-refine.

## Phase 6 Open Risks (documented, not blocking execution)

- **OQ-1**: Palette-click prompt flow — palette entries for "Team: Export" / "Team: Import" show toast hint ("Type 'team export <path>' in the prompt"); blocking modal deferred to Phase 10 polish.
- **OQ-2**: `/team export` empty-path default — rejected with usage message in v1; future `.planning/team.json` default deferred.
- **`.planning/team.json` gitignore policy** — user-discretion; docs call this out explicitly.
- **`exportedBy` default** — `undefined`; git-config fallback deferred.
- **`Config.get` / `Config.update` imports in command-input.tsx** — execution may need to add these imports (Grep first); `workflow-commands.tsx:55-56` is the reference site.
- **Phase 7 DAG interaction** — schema-migration pipeline (`migrateTeamConfig`) is the extension hook; Phase 7 will chain v1→v2 migration + bump CURRENT_TEAM_CONFIG_VERSION.
- **Phase 8 registry reuse** — envelope + checksum + versioning promoted to barrel exports at Phase 8 if needed; signed-manifest wraps AROUND envelope (no envelope churn).
- **Phase 9 webview compatibility** — pure modules (versioning/envelope/errors) browser-safe; Node-only modules (io/checksum) proxied via KiloConnectionService message bridge.
- **Knip barrel-trim** — `stableStringify` is test-only consumer; test file imports via deep path. If Phase 8 promotes internal symbols to public, re-add to barrel at that time.
- **Test sibling dir split** — new Phase 6 tests in `test/devilcode/team/` + `test/devilcode/workflow-tui/`; legacy Phase 2 tests stay in `test/kilocode/team/`. Full regression gate runs both: `bun test test/kilocode/ && bun test test/devilcode/`.

## Phase 5 Plan Structure (planned 2026-04-19, refine_cycle=2)

| Plan | Wave | Deps | Primary Agents | Reviewer |
|---|---|---|---|---|
| 05-01 Foundations: devil-ui hooks + 4 primitives (DensityProvider/Toggle, StagePositionBadge, DetailPanel, TabGroup) | 1 | Phase 4 | Frontend Developer + Senior Developer | QA Verification Specialist |
| 05-02 Unstubs + OnboardingWizard + Phase 4 carry-forwards (closeOverlays, lazy Show fallback, CONVENTIONS.md) | 2 | 05-01 | Frontend Developer + UX Researcher | QA Verification Specialist |
| 05-03 Cockpit composition + progressive disclosure + integration tests (Config.Info workflow field, auto-compact persisted flag) | 3 | 05-01, 05-02 | Frontend Developer + Senior Developer | QA Verification Specialist + Backend Architect |

## Phase 5 Architecture Decision

- Selected **Clean** (vs Minimal / Pragmatic) after 3 parallel proposal agents — user prioritized Phase 9 zero-rework (matches Phases 3+4).
- 5 new devil-ui primitives (OnboardingWizard, DensityProvider+Toggle, StagePositionBadge, TabGroup, DetailPanel) + 3 hooks (useDensity/useDensityOptional, useFirstRun, useStagePosition).
- Unstub all 4 Phase 3 terminal-stub primitives (CommandPalette, HelpOverlay, FooterBar, PasteModal) in Wave 2.
- DetailPanel primitive encodes the `detail-panel.tsx:113-115` flex fix (`<box flexGrow={1} minWidth={0}>`) as a layout invariant.
- TabGroup render-prop children pattern (NOT Slot compound API) — `<TabGroup>{(tab) => <Component/>}</TabGroup>`.
- Density persistence: `Config.Info.workflow = {density, firstRunComplete, autoCompactFired}` schema extension (Plan 05-03 Task 0); Config.update read-then-merge per Phase 2 precedent.
- OnboardingWizard onReviewAccept uses `TeamRepository.saveTeam("default", config)` directly; `wf.startBuild(config)` fire-and-forget.
- Auto-compact `autoCompactFired` flag persisted to Config — seeded on mount to prevent re-fire across sessions for returning users.
- Spec written to `.planning/specs/05-runtime-cockpit-spec.md` (gather → research → write → critique → assess complete).
- Estimated ~1,500 LOC source + ~900 LOC tests across Phase 5.

## Phase 5 Auto-Refine History

- **2026-04-19 cycle 0** → Spec pipeline produced `.planning/specs/05-runtime-cockpit-spec.md` (Complex rating); 3 plan files generated (05-01 Wave 1, 05-02 Wave 2, 05-03 Wave 3).
- **2026-04-19 cycle 1** → Pre-Mortem (QA Verification Specialist) + Assumption Hunt (Sprint Prioritizer) returned **REWORK**. 14 surgical fixes applied via CYCLE 1 REFINEMENTS blocks in each plan file:
  - R1-01: devil-ui `package.json` exports-map subpath additions (9 entries) — required for Plan 05-03 deep imports to resolve.
  - R1-02: `useFirstRun` return-type truth corrected (object with Accessor slot, not Accessor of object).
  - R1-03: `STAGE_CAPABILITY_REQUIREMENTS` is always single-capability — dead-code `Array.isArray` branch removed.
  - R1-04: TabGroup slot marker-object pattern REPLACED with render-prop children `(tab) => JSX.Element`.
  - R1-05: TabGroup terminal branch wires `useKeyboard` from `@opentui/solid` (DOM-only `document.addEventListener` was a no-op in TUI).
  - R1-06: TabGroup DOM branch keyboard handler scoped to tablist container, not document (prevents Tab-focus break in command input).
  - R1-07: DensityProvider test uses Phase 3 `withRoot` harness, not direct function invocation.
  - R1-08: New `useDensityOptional()` hook — returns `Accessor<DensityContextValue> | undefined` without throwing; DetailPanel + runtime-cockpit consumers use it.
  - R2-01: Terminal unstub marker is `<div class="terminal-stub">` — NOT "Phase 5 TODO" string; verification greps fixed.
  - R2-02: CommandPalette terminal branch uses real `useCommandRegistry` object API (`registry.entries()` + `registry.search()`), not fake `commands()` + `searchCommands(commands, query, limit)`.
  - R2-03: OpenTUI `<input>` event shape investigation gate added before terminal branch authoring.
  - R2-04: HelpOverlay uses same `useCommandRegistry` (no `useKeybindRegistry` — that hook does not exist).
  - R2-05: RosterTable gets a `readOnly` prop (Wave 2 scope expansion) — OnboardingWizard review step uses it.
  - R2-06: Plan 05-02 task order: Task 1 (unstubs) → Task 3 (conversions + readOnly + CONVENTIONS + closeOverlays) → Task 2 (OnboardingWizard).
  - R2-07: CONVENTIONS.md single authoritative path = `packages/devil-ui/CONVENTIONS.md`.
  - R2-08: `closeOverlays()` explicit signal list = `pickerOpen` + `quickstartOpen` only.
  - R3-01: `Config.Info.workflow` field schema extension (Plan 05-03 Task 0) — `.strict()` rejects unknown keys without it.
  - R3-02: Config.update full-object read-then-merge pattern (Phase 2 precedent at workflow-commands.tsx:55-56).
  - R3-03: OnboardingWizard uses `TeamRepository.saveTeam("default", config)` directly — NOT `builder.save("default")` (wrong signature + empty draft).
  - R3-04: `wf.startBuild(config)` fire-and-forget via `void … .catch(...)` — never awaited.
  - R3-05: Auto-compact `autoCompactFired` flag persisted to Config + seeded on mount.
  - R3-06: Forward-reference resolution — density handlers declared as named functions BEFORE `createEffect` registration.
  - R3-07: `runtime-cockpit.tsx` renders hint panel + selected-task detail box explicitly (detail-panel.tsx deletion dropped them otherwise).
  - R3-08/09: TabGroup render-prop + deep subpath imports per R1-01.
  - R3-10: Storybook story ID slugification.
  - R3-11: `useDensityOptional` consumer pattern for Storybook-without-provider scenarios.
- **2026-04-19 cycle 2** → Reality Checker returned **CAUTION**. All 9 cycle-1 verification points HELD against actual source. 3 new CRITICALs + 1 CAUTION surfaced; surgical cycle-2 edits folded:
  - R1-10 (new): TabGroup render-prop invoked inside `<Show when={active()} keyed>{(tab) => props.children(tab)}</Show>` reactive scope — prevents frozen one-shot invocation.
  - R3-13 (new): `teamRepo = createFileSystemTeamRepository()` instantiated inside `WorkflowView` component body, NOT at module scope (Instance.state AsyncLocalStorage honor).
  - R3-14 (new): onboarding.integration.test.ts asserts pre-build state only (Config persisted + mode transition); does NOT invoke real `wf.startBuild`. Optional `WorkflowProviderProps.services` seam if structural insufficient.
  - R3-15 (new): Playwright snapshot branch conditional on `STORYBOOK_CI=1` env var; structural min-width:0 assertion is always-required authoritative path.
- **AUTO_REFINE limit reached (2 cycles)** — plans at refine_cycle=2 with surgical cycle-2 edits folded in. Verdict: **CAUTION** accepted. No further auto-refine.

## Phase 5 Open Risks (documented, not blocking execution)

- **OpenTUI `<input>` event contract unverified** (R2-03) — Plan 05-02 Task 1 execution MUST inspect `@opentui/solid` types before authoring terminal branch onInput handlers. Fallback: ref-based imperative read on ESC/Ctrl+D.
- **PasteModal single-line limitation** (OpenTUI has no `<textarea>`) — documented in CONVENTIONS.md; multi-line via system paste only; deferred to Phase 6+ or upstream PR.
- **Config.Info schema extension risk** (R3-01) — adding `workflow` field to `.strict()` object does NOT reject existing configs lacking the field (optional), but new migration tests should confirm before merge.
- **Playwright visual regression** (R3-15) — SKIPPABLE until Storybook wired into CI; structural min-width:0 assertion is always-authoritative.
- **TabGroup keyboard focus scoping** (R1-05+R1-06) — DOM branch scopes to tablist container; terminal branch uses OpenTUI `useKeyboard`. If cross-scope routing surfaces issues (Phase 3 carry-forward #4 provider action test constraint), structural tests fall back to source introspection.
- **RosterTable readOnly expansion** (R2-05) — Plan 05-02 scope includes Phase 4 file modification; requires additional tests in existing `roster-table.test.ts`.
- **OnboardingWizard test coverage under Bun/@opentui constraint** (Phase 4 carry-forward #3) — full reactive action coverage not achievable; structural smoke tests authoritative.

## Phase 4 Plan Structure (planned 2026-04-19, refine_cycle=2)

| Plan | Wave | Deps | Primary Agents | Reviewer |
|---|---|---|---|---|
| 04-01 Foundations: TeamRepository + useTeamValidation + StageCoverageIndicator | 1 | Phase 3 | Backend Architect + Senior Developer | QA Verification Specialist |
| 04-02 Reusable Components: RosterTable + PositionPicker (devil-ui) | 2 | 04-01 | Frontend Developer + UI Designer | QA Verification Specialist |
| 04-03 Composition: TeamBuilderProvider + view + commands + integration tests | 3 | 04-01, 04-02 | Frontend Developer + Senior Developer | QA Verification Specialist |

## Phase 4 Architecture Decision

- Selected **Clean** (vs Minimal / Pragmatic) after 3 parallel proposal agents — user prioritized Phase 9 zero-rework (matches Phase 3 decision).
- Persistence seam via `TeamRepository` interface in `team/repository.ts` (Phase 6 ships additional implementations).
- Reusable components in `devil-ui/components/` + `devil-ui/primitives/` + `devil-ui/hooks/` so Phase 9 webview imports unchanged.
- `useTeamValidation()` hook delegates to existing `CanonicalTeamConfig` `superRefine` — single source of truth.
- TeamBuilderProvider parallel to WorkflowProvider (NOT nested) — Phase 5 cockpit redesign isolation.
- Spec written to `.planning/specs/04-team-builder-views-spec.md` (gather → research → write → critique → assess complete).
- Estimated ~1,300 LOC source + ~700 LOC tests across Phase 4.

## Phase 4 Auto-Refine History

- **2026-04-19 cycle 0** → Spec pipeline produced `.planning/specs/04-team-builder-views-spec.md` (Medium-Complex rating). 3 plan files generated. Plan 04-01 (Wave 1), 04-02 (Wave 2), 04-03 (Wave 3).
- **2026-04-19 cycle 1** → Pre-Mortem (read-only Explore) returned **REWORK**; Assumption Hunt returned **CAUTION**. 5 fixes applied:
  - `WorkflowStage._type` → `z.infer<typeof WorkflowStage>` (Zod v4.1.8 dropped `._type` accessor) in Plan 04-01 Task 2.
  - `createDOMAdapter` → `createDomAdapter` (lowercase 'm' per actual export name) in Plan 04-01 Task 3 + Plan 04-02 Tasks 1+2.
  - Added Task 0 to Plan 04-02 — wires `"./components": "./src/components/index.ts"` exports map entry in `devil-ui/package.json` + creates barrel; existing exports map had no `./components` subpath.
  - Removed `category: "Team"` from Plan 04-03 commands — `CommandData` Zod schema has no `category` field.
  - Removed `keybind: null` — `Keybind.optional()` rejects null; field omitted instead.
- **2026-04-19 cycle 2** → Cycle-2 Explore agent verified all 5 cycle-1 fixes held. 1 new CRITICAL surfaced + 9 CAUTIONs/INFOs verified safe:
  - `import z from "zod"` → `import { z, type ZodIssue } from "zod"` (devil-ui tsconfig defaults to `esModuleInterop=false`; named import only).
- **AUTO_REFINE limit reached (2 cycles)** — plans at refine_cycle=2 with surgical cycle-2 edit folded in. Verdict: **PASS** after fix. No further auto-refine.

## Phase 4 Open Risks (documented, not blocking execution)

- **devil-ui → opencode/team import edge** (OQ-1 from spec): `useTeamValidation` imports `CanonicalTeamConfig` from `@devilcode/cli/devilcode/team/config`. New cross-package edge. Phase 9 may extract shared types package if friction surfaces. devil-ui must declare `@devilcode/cli` workspace dep (verify in Plan 04-01 Task 2 execution).
- **`bun install` sequencing in Plan 04-02 Task 0**: package.json edit requires `bun install` BEFORE Tasks 1+2 typecheck — Task 0 verification commands include the install gate.
- **Knip "unused export" risk**: Wave 2 outputs (RosterTable/PositionPicker) consumed only by Wave 3 — knip runs after all plans complete; expected behavior, not blocking.
- **Component test harness reuse**: Plan 04-02 Tasks 1+2 mount JSX trees via Phase 3 `withRoot` hook harness. Fallback to structural smoke tests if direct DOM assertions infeasible (Phase 3 precedent at `test/devilcode/workflow-tui/index.smoke.test.ts`).
- **`startBuild` return type wrap**: `WorkflowViewState.startBuild` returns `Promise<TaskResult[]>`; team-builder wraps in `.then(() => undefined)` for `Promise<void>` API. Intentional narrowing.
- **`<input>`/`<button>`/`<select>` JSX in opencode TUI tree**: Phase 3 paste-modal already uses native HTML elements in DOM branch successfully. Phase 4 follows same convention.


## Phase 3 Plan Structure (planned 2026-04-19, refine_cycle=2)

| Plan | Wave | Deps | Primary Agents | Reviewer |
|---|---|---|---|---|
| 03-01 devil-keybind Package Foundation | 1 | Phase 2 | Backend Architect + Senior Developer | QA Verification Specialist |
| 03-02 devil-ui RenderTarget + Adapters + Hooks | 2 | 03-01 | Frontend Developer + Senior Developer | Backend Architect |
| 03-03 Primitives + Storybook + Integration | 3 | 03-02 | Frontend Developer + UI Designer | QA Verification Specialist |

## Phase 3 Architecture Decision

- Selected **Clean** (vs Minimal / Pragmatic) after 3 parallel proposal agents — user prioritized Phase 9 zero-rework.
- New package `packages/devil-keybind/` for pure logic (Zod schemas + registry + matcher + leader chain).
- `packages/devil-ui/` gains `primitives/`, `adapters/{terminal,dom}.ts`, `context/render-target.tsx`, `hooks/use-command-registry.ts` + `hooks/use-prompt-history.ts`.
- `<RenderSurface>` helper (renamed from `<Surface>` to avoid upstream collision) branches terminal vs DOM.
- Estimated ~1,660 LOC across Phase 3.

## Phase 3 Auto-Refine History

- **2026-04-19 cycle 0** → spec pipeline produced `.planning/specs/03-tui-scaffolding-spec.md` (verdict PASS); 3 plan files generated.
- **2026-04-19 cycle 1** → Pre-mortem (QA Verification Specialist) + assumption hunt (Sprint Prioritizer) returned REWORK. 8 CRITICALs fixed:
  - Zod 4.1.8 `z.function().returns` deprecated → `CommandData` Zod + TS-only `Command` interface w/ function fields.
  - Root `workspaces.packages: ["packages/*"]` glob auto-includes; D32 root edit DROPPED.
  - tsconfig extends `@tsconfig/bun/tsconfig.json` (catalog-pinned).
  - opencode missing `@devilcode/kilo-ui` dep → ADD `workspace:*`.
  - `@opentui/*` catalog entries added; opencode flipped to `catalog:`.
  - Workflow-tui integration fixed: wrap INSIDE `WorkflowProvider`; `WorkflowViewInner` takes no props; existing inline `command.register` untouched.
  - devil-ui has no test runner → ship per-pkg bunfig + Bun native tests via `createRoot` harness (no `@solidjs/testing-library`).
  - Context/hooks barrels re-export upstream `@opencode-ai/ui` via `export *` → add new symbols as EXPLICIT named exports beneath.
  - `CommandRegistry.subscribe(listener)` added for SolidJS reactivity (no monkey-patch).
  - OpenTUI `<textarea>` missing → paste-modal terminal branch reduced to stub + Phase-5-TODO.
- **2026-04-19 cycle 2** → Reality Checker returned REWORK w/ 5 NEW CRITICALs:
  - `RenderTargetAdapter.focus(nodeId)` unimplementable (OpenTUI has no imperative focus API) → declarative `focusedNodeId: Accessor<string|null>` + `setFocusedNodeId` signal; primitives use `focused={...}` JSX prop.
  - Multiple OpenTUI versions (0.1.75 + 0.1.87) already transitively installed → add root `overrides` + `bun pm why` check before proceeding.
  - `@devilcode/kilo-ui: "workspace:*"` inside catalog is malformed → catalog holds registry pkgs only.
  - `Surface` name too generic; upstream `@opencode-ai/ui/context` could shadow → renamed `RenderSurface` + grep guard.
  - DOM consumer transitive pull of `@opentui/*` risk → `createTerminalAdapter` is now async factory w/ dynamic-import; workflow-tui uses top-level await.
  - CAUTION-1: `onMount` doesn't fire under `createRoot` → hooks subscribe synchronously in body + `onCleanup`.
- **AUTO_REFINE limit reached (2 cycles)** — plans at refine_cycle=2. No further auto-refine. Outstanding risks surfaced in cycle 2 verdict are addressed in-plan; any residual non-blockers carried to execution.

## Phase 3 Open Risks (documented, not blocking execution)

- Top-level `await` in opencode `workflow-tui/index.tsx` — verify Bun startup + tsgo accept it; fallback to `createResource` wrapper documented in Plan 03-03 Task 3.
- Transitive `@opentui/core@0.1.75` deduping depends on identifying the upstream pinner via `bun pm why`; Plan 03-02 Step 1c makes this a hard gate.
- Storybook terminal spike is pre-authorized INFEASIBLE; if spike unexpectedly succeeds, primitive terminal stories can be added opportunistically.
- Playwright cross-platform baselines: Linux-only generation; Windows dev iterations use `--update-snapshots=none`.
- Parser corpus test asserts byte-identical parse against existing `util/keybind.ts`; any format drift surfaces at Wave 1.

## Phase 1 Results
- Plan 01-01 (Wave 1): Capability Model & Reconciliation — Complete.
- Plan 01-02 (Wave 2): Position Library & Canonical Team Types — Complete.

## Phase 2 Plan Structure

| Plan | Wave | Deps | Primary Agent | Reviewer |
|---|---|---|---|---|
| 02-01 Migration Tool + Quickstart JSON Templates | 1 | Phase 1 | Senior Developer | QA Verification Specialist |
| 02-02 Clean-Break Removal + Consumer Flip + /team init + Docs | 2 | 02-01 | Senior Developer | Backend Architect |

## Recent Decisions
- 2026-04-19 — Phase 2 architecture proposal: **Fully clean break now, break extension** (user chose aggressive clean-break over server-side legacy adapter). Extension runtime breaks until Phase 9; SDK NOT regenerated in Phase 2 to keep `bun turbo typecheck` monorepo-clean.
- 2026-04-19 — AUTO_REFINE cycle 1: pre-mortem + assumption-hunt critiques returned REWORK. Fixed in refined plans: SDK regen deferred to Phase 9, server response shape consistent (QuickstartTemplate[] wrapper), actual route paths (`/config/team/presets` + `/config/team/validate`), static JSON imports for Bun compile embedding, `fromLegacyTeamConfig` MOVE semantics, `Config.update` instead of WorkflowState for team persistence, `LegacyParseTeamConfig` test-only export, per-quickstart tier + parent-role assertions.
- 2026-04-19 — AUTO_REFINE cycle 2: Reality Checker verified 11/11 cycle-1 fixes held. Surfaced 1 new CRITICAL (`Config.update(config: Info)` takes full Info, not partial) + 4 CAUTIONs. Applied targeted edits: read-then-merge pattern for Config.update, EffortLevel import path corrected, migration.test.ts fixture-inlining path disambiguated to Plan 02-01, compiled-binary probe spec restored, OpenAPI runtime spec drift documented.
- 2026-04-19 — AUTO_REFINE limit reached (2 cycles). Plans at Plan 02-01 (refine_cycle=1) + Plan 02-02 (refine_cycle=1) with surgical cycle-2 edits folded in. No further auto-refine.

## Phase 2 Open Risks (documented, not blocking execution)
- `Config.update` + `Instance.dispose` interaction in `/team init` → smoke-test-verified in Plan 02-02 Task 3
- Bun `--compile` JSON static-import embedding → probe via compiled binary boot in Plan 02-01 Task 3; fallback to bun-test proxy with explicit risk-ack if probe infeasible
- OpenAPI runtime spec drift vs committed SDK → documented; dev-tool-only impact, not blocking
- migration.test.ts LOC budget: ~180 LOC of inlined legacy fixtures — acknowledged

## Phase 2 Wave 1 Results
- Plan 02-01 (Wave 1): Migration Tool + Quickstart JSON Templates — Complete.
  - migration.ts: fromLegacyTeamConfig MOVED, migrateLegacyTeamConfig + migrateLegacyTeamConfigFile added
  - 5 quickstart JSONs + static-import loader; all pass CanonicalTeamConfig stage coverage
  - 18 migration tests + 53 quickstart tests; canonical-config.test.ts slimmed
  - No circular dep re-export added (config.ts imports updated directly in tests)
  - TEAM_PRESETS consumers: only presets.ts, team/index.ts, server/routes/config.ts (no test files)

## Phase 2 Wave 2 Results
- Plan 02-02 (Wave 2): Clean-Break Removal + Consumer Flip + /team init + Docs — Complete.
  - presets.ts deleted; all legacy TeamRole/TeamConfig/TeamRouting removed from config.ts + index.ts
  - All consumers flipped: agents.ts, router.ts, workflow files, TUI files, server/routes/config.ts, config/config.ts
  - /team init reworked: 5 quickstart commands + read-then-merge Config.update pattern
  - migration-v1.md published to packages/devil-docs
  - 156 team tests passing; bun turbo typecheck clean; SDK/devil-vscode unchanged

## Phase 2 Review Results
- Review passed after 3 cycles (2026-04-19)
- 2 blockers found and fixed (collision test coverage, canDelegate dedup assertion)
- 9 warnings found and fixed (doc import path, test invariants, coverage gaps, JSDoc)
- 3 suggestions noted (not required): OpenAPI typed schema, doc table entry, test name
- Final: 158 team tests pass, 76 expect() calls, bun turbo typecheck clean

## Phase 3 Wave 1 Results
- Plan 03-01 (Wave 1): devil-keybind Package Foundation — Complete.
  - packages/devil-keybind registered; schemas + registry + matcher + leader implemented
  - 46 unit tests passing (registry / matcher / leader / parser-corpus); 79 expect() calls
  - Zero opencode / devil-ui / SolidJS / OpenTUI dependencies
  - bun turbo typecheck clean (13/13 tasks)
  - Ready for Plan 03-02 consumption

## Phase 3 Wave 2 Results
- Plan 03-02 (Wave 2): devil-ui RenderTarget + Adapters + Hooks — Complete.
  - RenderTarget context + provider + RenderSurface helper shipped
  - Terminal adapter (OpenTUI peer-dep, async factory) + DOM adapter (no OpenTUI) shipped
  - use-command-registry + use-prompt-history hooks + tests passing
  - @opentui/solid single version (0.1.87) verified via bun pm why
  - opencode gains @devilcode/keybind workspace dep
  - typecheck / knip / check-devilcode-change all green
  - Plan 03-03 primitives can be assembled on top

## Phase 3 Wave 3 Results
- Plan 03-03 (Wave 3): Primitives + Storybook + Integration — Complete.
  - CommandPalette + HelpOverlay + FooterBar + PasteModal shipped (DOM branches live, terminal branches stubbed for Phase 5)
  - Storybook terminal-harness: INFEASIBLE → DOM-only Storybook strategy, decision committed
  - 4 story files at flat path src/stories/*.stories.tsx
  - workflow-tui/index.tsx wraps providers (~12 LOC); no other workflow-tui file touched
  - Used createResource (not top-level await) — safer for bundler compatibility
  - createLeaderChain NOT wired in Phase 3 (grep confirmed zero hits)
  - All CI gates green (typecheck, knip, format, check-devilcode-change)
  - Phase 3 COMPLETE — ready for /legion:review

## Phase 3 Review Results
- Review passed after 3 cycles (2026-04-19)
- 8 warnings found and fixed across 3 cycles:
  - this-binding hazard in registry.ts (closure fix)
  - double focus init in paste-modal (sync block removed)
  - enabled predicate missing in command-palette (aria-disabled + click guard + color)
  - entries signal dual-contract undocumented (JSDoc + cross-scope subscribe test)
  - double onKeyDown handler in paste-modal (stopPropagation added)
  - selected index not clamped in command-palette (createEffect clamp added)
  - reactive self-subscription in clamp effect (untrack(selected) fix)
  - JSDoc comment accuracy in paste-modal (createEffect timing corrected)
- 3 informational findings noted (Phase 5 carry-forward for terminal stubs)
- Final: 46 keybind tests + 15 hook tests + 7 smoke tests pass; bun turbo typecheck clean

## Phase 4 Review Results
- Review passed after 3 cycles (2026-04-19)
- Panel: QA Verification Specialist · Frontend Developer · Test Results Analyzer · Senior Developer
- 1 blocker fixed (cycle 1: `selectRole` action missing — `onSelectRole` wrote to wrong state field)
- 2 cycle-2 blockers fixed (TS2698 spread on `unknown`; ARIA regression from `role="option"` removal)
- 1 cycle-3 blocker fixed (TS2554: `toBe` called with 2 args — Bun expect API)
- 14 cycle-1 warnings fixed: onCleanup registration, ENOENT domain error, saveTeam name field, Show-pattern lazy instantiation (×2), aria-invalid string, focus-on-open, ARIA role/scope fixes (×3), test coverage gaps (×3), quickstart try/catch
- Carry-forward to Phase 5: TerminalStub eager-fallback documentation, selectRole overlay contract, provider action test coverage (Bun/@opentui constraint)
- Final: 80 tests pass (65 Phase-4 + 15 pre-existing), 0 fail; typecheck clean

## Phase 5 Wave Results

### Wave 1 Results
- Plan 05-01 (Wave 1): Foundations — Complete.
  - 5 devil-ui primitives: DensityProvider+Toggle, StagePositionBadge, DetailPanel, TabGroup (render-prop pattern)
  - 3 hooks: useDensity, useDensityOptional, useStagePosition; useFirstRun
  - detailpanel flex fix (minWidth:0) codified as layout invariant
  - devil-ui package.json exports-map extended with 9 new subpaths

### Wave 2 Results
- Plan 05-02 (Wave 2): Unstubs + OnboardingWizard — Complete.
  - CommandPalette, HelpOverlay, FooterBar, PasteModal terminal stubs replaced with real implementations
  - OnboardingWizard primitive shipped (wizard + team-review step with RosterTable readOnly)
  - Phase 4 carry-forwards: closeOverlays() signal list, lazy Show fallback, CONVENTIONS.md
  - RosterTable gains readOnly prop

### Wave 3 Results
- Plan 05-03 (Wave 3): Cockpit Composition — Complete.
  - Config.Info.workflow schema extension (density, firstRunComplete, autoCompactFired)
  - WorkflowViewState extended: density/firstRunComplete state + setDensity/markFirstRunComplete actions
  - Auto-compact createEffect: fires once on first completed task, persists autoCompactFired (R3-05)
  - runtime-cockpit.tsx created; status-bar.tsx, detail-panel.tsx, tabs/tab-bar.tsx deleted
  - index.tsx rewritten as 3-mode router (onboarding|workflow|team-builder) with DensityProvider
  - OnboardingWizard wired: teamRepo.saveTeam (R3-03); startBuild fire-and-forget (R3-04)
  - /density command added to command-input.tsx
  - 64 new integration tests across 4 files; all structural (R3-14, R3-15)

## Phase 5 Review Results
- Review passed after 2 cycles (2026-04-19)
- Panel: QA Verification Specialist · Frontend Developer · Test Results Analyzer
- 2 blockers fixed (B1: onboarding-wizard bare require; B2: useWorkflow() in anonymous accessor → WorkflowViewShell)
- 10 warnings fixed (W1-W4, W6-W8, W10 in cycle 1; TerminalCommandPalette bare require in cycle 2)
- 2 findings ruled as false positive / established pattern (W5 autoCompactFired race, W9 eager dual-branch)
- Fix commits: `a8725e96f` (cycle 1), `b36be5ec5` (cycle 2 residual)
- Final: 329 tests pass (195 devil-ui + 134 opencode/devilcode), 0 fail

## Phase 6 Wave Results

### Wave 1 Results
- Plan 06-01 (Wave 1): Pure Modules Layer — Complete.
  - 8 new source files: errors.ts, checksum.ts, versioning.ts, export-envelope.ts, io.ts, layered-repository.ts, repositories/project-local.ts, repositories/quickstart.ts
  - 9 new test files; 74 new tests pass (81 total across team/ suite including 7 pre-existing); 181 expect() calls
  - `isLegacyShape` structural detector (R1-02); `migrateTeamConfig` unwraps LegacyMigrationResult (R1-03)
  - Round-trip fidelity: all 5 quickstarts pass `stableStringify(imported) === stableStringify(original)`
  - 8 malformed-input error cases covered in io.test.ts
  - Barrel trimmed to public surface only per R1-08 (internal symbols via deep import paths)
  - Zero new typecheck errors (4 pre-existing devil-ui errors unchanged)

### Wave 2 Results
- Plan 06-02 (Wave 2): TUI Wiring + Docs — Complete.
  - `commands/team-io.ts`: exportCommand + importCommand + registerTeamIOCommands + TeamIOCommandHandlers DI type
  - `workflow-tui/index.tsx`: `createFileSystemTeamRepository()` → `createLayeredTeamRepository({..., defaultWriteLayer:"user-level"})` at WorkflowViewInner (R2-04); Instance.directory with defensive try/catch fallback (R2-12)
  - `command-input.tsx`: `team export <path>` / `team import <path>` branches inserted before WorkflowStage.safeParse fallback (R2-10); teamIOHandlers() closure using existing team() helper (R2-03)
  - NEW `packages/devil-docs/pages/collaborate/teams/team-portability.md` (team-management.md untouched per R2-02)
  - `collaborate/index.md`: Team Portability link added
  - 18 new tests (12 commands + 6 structural); 40 new expect() calls
  - Phase 5 regression gate: 92 pass / 0 fail in workflow-tui suite (205 pre-existing + 40 new = 245 expect() total)
  - All CI gates: knip PASS, format:check PASS, check-devilcode-change PASS, zero new typecheck errors

## Phase 6 Carry-Forward Items
- **OQ-1**: Palette-modal UI for team export/import — deferred to Phase 10 polish
- **Phase 7 DAG**: checksum re-computation needed in versioning pipeline for migrated configs
- **Phase 8 Registry**: signed manifests (Ed25519) for authenticity on top of integrity checksum
- **Pre-existing flake**: `worktree-diff.test.ts` hangs in full kilocode suite on Windows (pre-existing, unrelated)
- **Pre-existing typecheck**: 440 errors in kilo-ui @/* alias resolution (pre-existing, recommend hygiene phase)

## Phase 6 Review Results
- Review passed after 1 cycle (2026-04-20)
- Panel: QA Verification Specialist · Backend Architect · Test Results Analyzer
- 0 blockers, 0 warnings, 3 suggestions (all optional)
- 173 tests pass (81 team + 92 workflow-tui), 0 fail
- All CI gates green

## Phase 7 Review Results
- Review passed after 3 cycles (2026-04-21)
- Panel: QA Verification Specialist · Test Results Analyzer
- Cycle 1: 3 blockers + 9 warnings fixed (retro regression, test contract gaps, type errors, checksum, round-trip)
- Cycle 2: 2 new blockers + 2 warnings fixed (resolveAction DAG wiring, capabilityOverrides round-trip, reset() DAG clear, true-cycle test)
- Cycle 3: PASS — all 5 success criteria satisfied
- 318 tests pass, 0 fail; all CI gates green

## Phase 8 Plan Structure (planned 2026-04-21, refine_cycle=0)

| Plan | Wave | Deps | Primary Agents | Reviewer |
|---|---|---|---|---|
| 08-01 Registry Module Foundation — manifest.ts + errors.ts + signing.ts + http-client.ts + trust-store.ts + barrel | 1 | Phase 7 | Backend Architect + Senior Developer | QA Verification Specialist |
| 08-02 I/O Orchestration + Commands — io.ts (publishManifest/installManifest) + team-registry.ts commands + TUI integration | 2 | 08-01 | Senior Developer + Frontend Developer | QA Verification Specialist |
| 08-03 Security Review + Docs — security.test.ts (18+ attack vectors) + team-registry.md docs + CI gates | 3 | 08-02 | Security Engineer + Technical Writer | QA Verification Specialist |

## Phase 8 Architecture Decision
- Selected **Clean** after 3 parallel proposal agents — user prioritized Phase 9 zero-rework (consistent with Phases 3-7).
- New `team/registry/` submodule with clear separation:
  - Browser-safe: manifest.ts, errors.ts (no Node imports)
  - Node-only: signing.ts, http-client.ts, trust-store.ts, io.ts
- Manifest wraps AROUND TeamExportEnvelope (no envelope churn from Phase 6).
- Ed25519 signing via Node.js built-in crypto (`crypto.generateKeyPairSync("ed25519")`).
- Explicit key pinning trust model (no trust-on-first-use vulnerability).
- Trust store at `~/.local/share/kilo/registry/trusted-publishers.json`.
- Command handler DI pattern from Phase 6 team-io.ts reused for team-registry.ts.
- Spec written to `.planning/specs/08-registry-marketplace-spec.md` (Medium complexity).
- Estimated ~800 LOC source + ~600 LOC tests + ~180 LOC docs = ~1,580 total.

## Phase 8 Auto-Refine History
- **2026-04-21 cycle 0** → 3 competing architecture proposals (Minimal/Clean/Pragmatic) spawned. User selected **Clean**. Spec pipeline produced `.planning/specs/08-registry-marketplace-spec.md`; 3 plan files generated (08-01 Wave 1, 08-02 Wave 2, 08-03 Wave 3).
- **Critique agents failed** — Pre-mortem + Assumption-hunt agents searched wrong working directory (`packages/opencode/.planning/` instead of repo root `.planning/`). False negative; plans verified manually (9 tasks, 3 per plan, dependencies correct).
- Plans at refine_cycle=0 ready for execution.

## Phase 8 Open Risks (documented, not blocking execution)
- **Bun Ed25519 support**: Node crypto.generateKeyPairSync("ed25519") support assumed; verify in execution.
- **fetch() native**: Uses native fetch() with AbortController timeout; no wrapper.
- **Trust store persistence**: JSON file at ~/.local/share/kilo/registry/trusted-publishers.json; no migration needed (new store).
- **Phase 9 webview**: Browser-safe modules (manifest.ts, errors.ts) importable directly; Node-only modules proxied via KiloConnectionService.

## Phase 8 Wave Results

### Wave 1 Results
- Plan 08-01 (Wave 1): Registry Module Foundation — Complete.
  - `team/registry/manifest.ts`: TeamRegistryManifest, TeamManifestMetadata, RegistryIndex schemas (all .strict(), browser-safe)
  - `team/registry/errors.ts`: TeamRegistryError base + 4 typed subclasses (browser-safe)
  - `team/registry/signing.ts`: Ed25519 generateKeyPair, signManifest, verifyManifestSignature, getPublicKeyFingerprint
  - `team/registry/http-client.ts`: fetchManifest with AbortController timeout, TeamManifestFetchFailed errors
  - `team/registry/trust-store.ts`: CRUD for ~/.local/share/kilo/registry/trusted-publishers.json
  - `team/registry/index.ts`: barrel re-exporting all symbols
  - 72 tests pass (manifest + errors + signing + http-client + trust-store)

### Wave 2 Results
- Plan 08-02 (Wave 2): I/O Orchestration + Commands — Complete.
  - `team/registry/io.ts`: publishManifest (signed/unsigned) + installManifest (fetch/file, signature verify, trust check)
  - `workflow-tui/commands/team-registry.ts`: publishCommand, installCommand, trustCommand, untrustCommand + registerTeamRegistryCommands
  - `command-input.tsx`: 4 new branches (team publish/install/trust/untrust) before WorkflowStage.safeParse fallback
  - `index.tsx`: registerTeamRegistryCommands + onCleanup wired
  - `team/index.ts`: registry public surface exported
  - 39 new tests; 429 total devilcode tests pass (Phase 7 regression clean)

### Wave 3 Results
- Plan 08-03 (Wave 3): Security Review + Docs — Complete.
  - `test/devilcode/team/registry/security.test.ts`: 25 security tests across 4 threat vectors
    - Signature Forgery Resistance (5 tests): wrong key, random bytes, empty string, all-zeros, end-to-end
    - Manifest Tampering Detection (6 tests): config/name/version/exportedAt/checksum mutation, file-level MITM
    - Trust Store Integrity (6 tests): unknown/revoked/trusted publisher, malformed/truncated JSON recovery
    - Install Safety (8 tests): requireSignature, warnings, skipTrustCheck, schema/JSON rejection
  - `packages/devil-docs/pages/collaborate/teams/team-registry.md`: Full docs (272 LOC)
  - 454 total devilcode tests pass; typecheck clean

## Phase 8 Plan Structure (executed 2026-04-21)

| Plan | Wave | Deps | Primary Agents | Status |
|---|---|---|---|---|
| 08-01 Registry Module Foundation | 1 | Phase 7 | Backend Architect + Senior Developer | Complete |
| 08-02 I/O Orchestration + Commands | 2 | 08-01 | Senior Developer + Frontend Developer | Complete |
| 08-03 Security Review + Docs | 3 | 08-02 | Security Engineer + Technical Writer | Complete |

## Phase 8 Open Findings (documented, not blocking)

- **Trust store DI gap**: `installManifest` calls `getTrustedPublisher` against global path; no path injection. Medium severity design debt — security tests work around via real trust store cleanup. Phase 9 should add `storePath` param to `installManifest` signature.
- **publisherId default**: CLI `publishCommand` generates a default UUID when `--publisherId` not passed. Should be required when `--sign` provided. Low severity.
- **registryHandlers in index.tsx**: Uses stub `getActiveTeam` for palette registration; real execution through command-input.tsx reactive context. Intentional — matches Phase 6 pattern.

## Next Action
Run `/legion:build` to execute Phase 9: VS Code Extension UI & Telemetry Dashboards.

## GitHub
- Repository: `https://github.com/9thLevelSoftware/kilocode.git`
- Issue tracking: disabled on fork (no Phase 2 issue created)
- PR integration: available for work submissions
