# Team Orchestrator — Roadmap

## Phases

- [x] Phase 1: Foundation — Canonical Library & Capability Model ✓ Review passed
- [x] Phase 2: Preset Migration & Clean-Break Schema Cleanup ✓ Review passed
- [x] Phase 3: TUI Scaffolding — Hybrid Interaction Primitives ✓ Review passed
- [ ] Phase 4: Team Builder Views
- [ ] Phase 5: Runtime Cockpit Redesign
- [ ] Phase 6: Team Export/Import & Persistence Layer
- [ ] Phase 7: Configurable Workflow DAG
- [ ] Phase 8: Team Registry & Marketplace
- [ ] Phase 9: VS Code Extension UI & Telemetry Dashboards
- [ ] Phase 10: Live Team Editing & Final Polish

## Phase Details

### Phase 1: Foundation — Canonical Library & Capability Model
**Goal**: Lock the data model that every later phase depends on. Define the canonical 11-position library, the canonical capability enum, the stage → capability mapping, and schema extensions to `TeamConfig`. Read and reconcile the prior 2026-04-06 design spec.
**Requirements**: Canonical 11-position library; Capability enum + stage→capability mapping; Schema extensions
**Recommended Agents**: Backend Architect (schema design, stage→capability mapping), UX Architect (position semantics, developer-facing naming), Senior Developer (Zod schema extensions, migration pre-work), QA Verification Specialist (schema validation tests, prior-spec reconciliation)
**Success Criteria**:
- `packages/opencode/src/devilcode/team/library.ts` exports the 11 canonical positions with defaults (tier, canDelegate, capabilities, displayName)
- `packages/opencode/src/devilcode/team/capabilities.ts` exports canonical capability enum + `STAGE_CAPABILITY_REQUIREMENTS` mapping covering all 7 stages
- `TeamConfig` Zod schema extended with new capability model; existing fields preserved
- Prior 2026-04-06 design spec read; reconciliation document produced in `.planning/phases/01-reconciliation.md`
- `retro` stage owner decision made (canonical position or new 12th position)
- 100% unit test coverage on new schema validators
**Plans**: 2

### Phase 2: Preset Migration & Clean-Break Schema Cleanup
**Goal**: Convert the 5 existing hardcoded presets into JSON-based quickstart templates using the new position library. Build the migration tool for existing user `TeamConfig`s. Deprecate or rework `/team init` as a TUI-launcher.
**Requirements**: Migration from 5 existing presets; Clean-break schema cleanup
**Recommended Agents**: Senior Developer (migration logic, preset conversion), Backend Architect (clean-break boundary decisions), QA Verification Specialist (migration coverage tests, preset-equivalence tests), Technical Writer (migration notes for users)
**Success Criteria**:
- `packages/opencode/src/devilcode/team/migration.ts` maps every old role name to a new canonical position
- Old presets converted to JSON quickstart templates bundled in repo
- Migration tests cover all 5 presets + at least 5 synthetic `TeamConfig` fixtures
- `/team init` reworked to launch the TUI team-builder with quickstart options
- Legacy code paths removed; CI passes without backwards-compat shims
**Plans**: 2

### Phase 3: TUI Scaffolding — Hybrid Interaction Primitives
**Goal**: Build the reusable interaction primitives that power every later TUI view: command palette (Ctrl+K), help overlay (`?`), context-aware footer action bar, paste-mode modal, central keybinding registry with Ctrl+X leader, prompt history. Decide whether OpenTUI provides modal/palette primitives or whether we build them in `packages/devil-ui/`.
**Requirements**: Hybrid interaction model
**Recommended Agents**: Frontend Developer (SolidJS + OpenTUI component implementation), UX Architect (keyboard ergonomics, shortcut conflicts), UI Designer (visual density, theming), Senior Developer (central keybinding registry architecture)
**Success Criteria**:
- Ctrl+K command palette opens fuzzy-searchable modal with all registered commands, descriptions, aliases, hidden_keywords
- `?` overlay shows keybinds + commands grouped by context
- Footer action bar dynamically renders 3-5 context-relevant actions with single-key shortcuts
- Paste-mode modal triggered explicitly (`/paste` or keybind); replaces overloaded `workflow>` input
- Ctrl+X leader key registered; prompt history (Up/Down) works; tab navigation (Tab/Shift+Tab) cycles tabs
- All primitives usable from both TUI and (in Phase 9) the VS Code webview via shared `devil-ui` components
- Storybook entries for each primitive; unit tests for fuzzy match + keybind routing
**Plans**: 3

### Phase 4: Team Builder Views
**Goal**: Ship the in-TUI team-building experience. Position picker browsing the canonical library; editable roster table; save/load flow; live stage-coverage indicator with strict validation; quickstart template loader.
**Requirements**: In-TUI team builder view; Strict 7-stage coverage validation
**Recommended Agents**: Frontend Developer (view implementation), UX Architect (builder flow, validation feedback loops), UI Designer (table ergonomics, coverage indicator visual), Senior Developer (schema binding + save logic)
**Success Criteria**:
- Team roster view shows columns: Position | Provider | Model | Effort | Delegates-to | Capabilities
- Position picker browses canonical library with descriptions + default capabilities
- Stage coverage indicator highlights missing stages in red; blocks workflow start until complete
- Save-as-custom-team writes to `~/.local/share/kilo/teams/<id>.json`
- Load-from-quickstart populates the roster from bundled templates
- Integration tests cover build → validate → save → reload round-trip
**Plans**: 3

### Phase 5: Runtime Cockpit Redesign
**Goal**: Replace the existing 8 workflow-tui files with the redesigned runtime cockpit. Fix the `detail-panel.tsx:113-115` rendering bug. Keyboard-navigable tabs. Visible stage → position mapping indicator showing who's working on what. Progressive disclosure: first-run onboarding wizard; compacts to power-user density after first successful workflow.
**Requirements**: Runtime cockpit redesign; Progressive disclosure (first-run vs daily)
**Recommended Agents**: Frontend Developer (view replacement, SolidJS refactor), UX Researcher (first-run vs daily usage patterns), UI Designer (progressive-disclosure transitions, density toggle), Senior Developer (state-machine integration with existing workflow runtime), QA Verification Specialist (regression coverage across old feature set)
**Success Criteria**:
- All 8 existing workflow-tui files replaced; no feature regression (commands: back, status, pause, approve, revise, next, task, stage names all still work)
- Rendering bug in `detail-panel.tsx` fixed and covered by visual regression test
- Tabs (`Plan | Activity | Challenge | Review | AgentOutput`) keyboard-navigable via Tab/Shift+Tab + number shortcuts
- Stage → position mapping indicator visible in header; shows which role is currently executing
- First-run users see onboarding wizard when no team configured
- Density toggle in settings; defaults to compact after first successful workflow completes
- All existing integration tests pass; new integration tests cover the onboarding flow
**Plans**: 3

### Phase 6: Team Export/Import & Persistence Layer
**Goal**: Ship the JSON-file-based team portability. Export team to JSON; import team from JSON; bundled quickstart templates; project-local override at `.planning/team.json`; user-level config at `~/.local/share/kilo/teams/<id>.json`.
**Requirements**: Team export/import (JSON files)
**Recommended Agents**: Senior Developer (file I/O, schema round-trip), Backend Architect (storage-path conventions, override precedence), QA Verification Specialist (round-trip tests, malformed-input safety), Technical Writer (share-team documentation)
**Success Criteria**:
- `/team export <path>` writes team JSON with schema version + checksum
- `/team import <path>` reads team JSON, validates schema, migrates older versions transparently
- Override precedence documented: project-local `.planning/team.json` > user-level `~/.local/share/kilo/teams/<id>.json` > quickstart
- 100% round-trip fidelity test: export → import → compare
- Malformed input rejected with clear error messages
- Docs added to `packages/devil-docs/pages/collaborate/teams/team-management.md`
**Plans**: 2

### Phase 7: Configurable Workflow DAG
**Goal**: Allow users to reorder stages and override the stage → capability mapping per team. DAG integrity validation (no cycles, all stages covered). UI in team-builder for DAG customization.
**Requirements**: Fully configurable workflow DAG
**Recommended Agents**: Backend Architect (DAG schema, cycle detection), Senior Developer (runtime dispatch integration), UX Architect (DAG editor UI), QA Verification Specialist (DAG validation coverage, runtime equivalence tests)
**Success Criteria**:
- `TeamConfig` supports optional `workflowOverride: { stages: Stage[], capabilityOverrides: Record<Stage, Capability[]> }`
- DAG validator rejects cycles, unreachable stages, missing required capabilities
- Team-builder surfaces a DAG editor (advanced mode, hidden by default)
- Runtime dispatch uses the override when present; falls back to default DAG otherwise
- At least 3 synthetic non-default DAGs pass runtime integration tests
**Plans**: 2

### Phase 8: Team Registry & Marketplace
**Goal**: Remote team-template sharing. File-based MVP protocol (HTTP-fetchable JSON manifests). Publish/subscribe flow. Later extend to a hosted registry (out of v1 if time-constrained).
**Requirements**: Team registry / marketplace
**Recommended Agents**: Backend Architect (registry protocol, manifest format), Senior Developer (publish/subscribe client), Security Engineer (supply-chain review: signed manifests, provenance), Technical Writer (registry usage docs)
**Success Criteria**:
- Registry protocol specified: JSON manifest schema (team definition + metadata: author, version, license, description, tags)
- `/team publish <url-or-path>` packages team + manifest
- `/team install <url>` fetches manifest, verifies, installs to user-level teams
- Signed manifests (optional but strongly recommended) verified before install
- Basic registry index format documented (flat list or grouped by tag)
- Security review passes for supply-chain risks
**Plans**: 3

### Phase 9: VS Code Extension UI & Telemetry Dashboards
**Goal**: Port team-builder UI into the VS Code extension's Agent Manager webview, reusing the Zod schema. Build telemetry dashboards on the existing workflow event log: success rate, stall rate, per-position metrics, cost-per-workflow.
**Requirements**: Web/VS Code UI for team building + telemetry
**Recommended Agents**: Frontend Developer (SolidJS webview, shared devil-ui primitives), Analytics Reporter (dashboard design, KPI definition), Data Analytics Engineer (event-log querying, metric pipelines), Senior Developer (extension-to-CLI bridge reuse)
**Success Criteria**:
- VS Code Agent Manager webview has Team Builder tab with feature parity to TUI builder
- Teams edited in extension persist via existing `KiloConnectionService` to CLI
- Telemetry dashboards render: success-rate-per-team, stall-rate-per-position, cost-per-workflow, duration-by-stage
- Dashboards use existing `/devilcode/workflow/events` endpoint + (if needed) new aggregation endpoint
- No duplication of schema: extension imports types from `@devilcode/sdk`
- Knip passes (no dead exports); format check passes; `devilcode_change` markers not needed (new files in `packages/devil-vscode/`)
**Plans**: 3

### Phase 10: Live Team Editing & Final Polish
**Goal**: Allow hot-swapping positions mid-workflow with state reconciliation. Final docs, keyboard-help review, theming polish, migration-guide publication.
**Requirements**: Live team editing during active workflow
**Recommended Agents**: Senior Developer (state reconciliation, runtime swap), Backend Architect (concurrency/safety for mid-run edits), QA Verification Specialist (end-to-end regression suite, chaos tests), Technical Writer (user guide, migration guide)
**Success Criteria**:
- `/team swap <position> <provider> <model>` swaps a position mid-workflow without aborting
- In-flight task for swapped position finishes on old agent; new tasks route to new agent
- State-machine consistency verified by chaos tests (swap mid-wave, swap during review, swap during challenge)
- User guide published at `packages/devil-docs/pages/collaborate/teams/team-orchestrator-guide.md`
- Migration guide published for users of the old workflow-tui
- All CI checks green: `bun turbo typecheck`, `bun run knip`, `bun run format:check`, `bun run check-kilocode-change`, source-links
- Documented stretch: post-v1 hosted registry, team-performance analytics beyond v1 dashboards
**Plans**: 2

## Progress

| Phase | Plans | Completed | Status |
|-------|-------|-----------|--------|
| 1. Foundation | 2 | 2 | Complete |
| 2. Preset Migration | 2 | 2 | Complete ✓ Reviewed |
| 3. TUI Scaffolding | 3 | 3 | Complete ✓ Reviewed |
| 4. Team Builder Views | 3 | 3 | Complete (pending review) |
| 5. Runtime Cockpit | 3 | 0 | Not started |
| 6. Export/Import | 2 | 0 | Not started |
| 7. Configurable DAG | 2 | 0 | Not started |
| 8. Registry | 3 | 0 | Not started |
| 9. VS Code + Telemetry | 3 | 0 | Not started |
| 10. Live Editing + Polish | 2 | 0 | Not started |
| **Total** | **25** | **10** | **In Progress** |
