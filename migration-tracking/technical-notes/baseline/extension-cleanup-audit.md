# Extension and Upstream Patch Cleanup Audit

## 1. Overview and Provenance

This audit evaluates the current v2 worktree against the consumed upstream snapshot and the approved fork plan allowance. It distinguishes Kilo-owned additions from shared upstream patches, audits the exact technical necessity of each shared modification, and determines whether proposed cleanups represent genuine removable duplication or required upstream extension seams.

- **Consumed Upstream Snapshot Base SHA:** `59b29de40966803e2c7cd734d439843fb773f6a6` (`fix(core): detect new ecosystem config roots (#47026)`), distinct from the earlier historical pinned snapshot `76dbaf20adbd43fd208a00ef3cda4a51e125a234`.
- **Local Production Ref (`origin/main`) SHA:** `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7` (`Merge pull request #13805 from Kilo-Org/fix/glob-search-timeout-20260904`).
- **Current Branch HEAD SHA:** `82040801cd253665d2785c290031d307a18a0d64`.
- **Canonical Fork Plan:** `plans/kilo-opencode-v2-issue-13750.md` (lines 84–92 define the approved shared-patch ceiling).

## 2. Shared-File Accounting vs Fork Plan Allowance

The canonical fork plan (`plans/kilo-opencode-v2-issue-13750.md`) authorizes exactly **6 approved shared-patch files**:
1. `AGENTS.md` (root pointer to Kilo fork rules)
2. `packages/plugin/src/tui/context.ts` (`home.logo` slot definition)
3. `packages/tui/src/app.tsx` (`pluginDirectories` pass-through)
4. `packages/tui/src/routes/home.tsx` (`Slot home.logo` rendering)
5. `packages/core/src/plugin/sdk.ts` (host-enforced post-registration hook)
6. `packages/core/src/plugin/supervisor.ts` (post-config activation hook)

### Tracked Working-Tree Changes vs Base

A complete diff of tracked files against base `59b29de40966803e2c7cd734d439843fb773f6a6` shows **466 total modified/added tracked files**:
- **444 Kilo-owned new tracked files** (`packages/kilo-*`, `kilocode/`, `plans/`, and Kilo-namespaced subtrees in upstream packages).
- **22 shared upstream files** (6 approved + 1 generated `bun.lock` + 15 handwritten unapproved/unresolved paths).

*Scope Note:* These counts cover tracked working-tree files only. Untracked working-tree additions (such as AI wrapper modules in `packages/ai/src/kilocode/` and `packages/ai/test/kilocode/`, untracked baseline audit docs, and scratch directories like `.blume/` and `.kilo/`) are omitted from tracked diff accounting and are not claimed as exhaustive repository additions.

### Inventory of All 22 Modified Shared Files

| File | Status | Nature of Diff | Lines Diff | Technical Necessity Classification |
|---|---|---|---|---|
| `AGENTS.md` | Approved (1/6) | Root documentation pointer | 2 | Retain (approved) |
| `packages/plugin/src/tui/context.ts` | Approved (2/6) | `home.logo` plugin slot | 12 | Retain (approved) |
| `packages/tui/src/app.tsx` | Approved (3/6) | `pluginDirectories` pass-through | 11 | Retain (approved) |
| `packages/tui/src/routes/home.tsx` | Approved (4/6) | `Slot home.logo` placement | 13 | Retain (approved) |
| `packages/core/src/plugin/sdk.ts` | Approved (5/6) | Post-registration hook | 11 | Retain (approved) |
| `packages/core/src/plugin/supervisor.ts` | Approved (6/6) | Post-config activation hook | 10 | Retain (approved) |
| `bun.lock` | Unresolved (Generated) | Dependency & workspace lockfile | 148 | Generated package manager lockfile; reconcile on release |
| `packages/theme/src/tui/defaults.ts` | Unapproved (Handwritten) | `text.logo` light/dark defaults | 22 | Required by `AGENTS.md` theme token rule; no safe equivalent seam |
| `packages/theme/src/tui/fallback.ts` | Unapproved (Handwritten) | `text.logo` fallback resolution | 12 | Required by `AGENTS.md` theme token rule; no safe equivalent seam |
| `packages/theme/src/tui/schema.ts` | Unapproved (Handwritten) | `text.logo` optional token schema | 13 | Required by `AGENTS.md` theme token rule; no safe equivalent seam |
| `packages/theme/src/tui/types.ts` | Unapproved (Handwritten) | `text.logo: RGBA` type token | 13 | Required by `AGENTS.md` theme token rule; no safe equivalent seam |
| `packages/tui/src/component/dialog-agent.tsx` | Unapproved (Handwritten) | `title: item.name ?? item.id` | 13 | Missing upstream presentation seam; canonical IDs cannot be renamed |
| `packages/tui/src/component/dialog-integration.tsx` | Unapproved (Handwritten) | Hardcoded `kilo: -1` in `INTEGRATION_PRIORITY` | 44 | Missing upstream provider priority configuration seam |
| `packages/tui/src/component/dialog-model.tsx` | Unapproved (Handwritten) | Inlined grouping, loading state, disclosures | 211 | Async Gateway RPC metadata presentation; unproven to remove without upstream slot |
| `packages/tui/src/component/prompt/autocomplete.tsx` | Unapproved (Handwritten) | Local command shadowing in autocomplete | 19 | Dual registry collision; required to avoid duplicate `/memory` |
| `packages/tui/src/component/prompt/index.tsx` | Unapproved (Handwritten) | `agentLabel` name fallback | 13 | Missing upstream presentation seam; canonical IDs cannot be renamed |
| `packages/tui/src/context/local.tsx` | Unapproved (Handwritten) | Added `local.agent.name` helper | 23 | Centralized display name lookup helper |
| `packages/tui/src/context/runtime.tsx` | Unapproved (Handwritten) | Added `TuiModelGroup`/`TuiModelPicker` | 33 | Contract for host-injected model presentation |
| `packages/tui/src/routes/session/composer/subagents-tab.tsx` | Unapproved (Handwritten) | Agent display name resolution | 33 | Missing upstream presentation seam; canonical IDs cannot be renamed |
| `packages/tui/src/routes/session/index.tsx` | Unapproved (Handwritten) | Epilogue override + agent name callsites | 99 | Missing upstream presentation seams across session transcript views |
| `packages/tui/src/util/renderer.ts` | Unapproved (Handwritten) | `renderer.screenMode = "main-screen"` | 16 | Sets intended exit screen mode; claims of native destroy corruption unproven |
| `packages/tui/test/util/renderer.test.ts` | Unapproved (Handwritten) | Upstream test assertions for screen restoration | 50 | Unit test coverage for intended `destroyRenderer` call order |

## 3. Inventory of Tracked Additions (Kilo-Owned vs Generated vs Shared)

The 444 new tracked files are categorized strictly under Kilo-owned namespaces:

| Category | File Count | Purpose |
|---|---|---|
| `packages/kilo-cli/` | 207 | Host CLI entrypoint, commands, RPC plugins, TUI plugins, tests |
| `packages/kilo-indexing/` | 121 | Vector indexing engine, parsers, embedders, tests |
| `packages/kilo-memory/` | 66 | Durable memory, capture, recall, storage, prompts |
| `kilocode/` | 26 | Baseline audits, fork conventions, parity ledgers, verification scripts |
| `packages/kilo-gateway/` | 13 | Gateway account resolution, model routing, session management |
| `packages/kilo-client/` | 3 | Typed RPC client wrapper for Kilo extensions |
| `plans/` | 2 | Kilo v2 port roadmap and issue plan (`13750`) |
| Kilo-namespaced subtrees in upstream packages | 6 | `packages/cli/src/kilocode/acp.ts`, `packages/schema/src/kilocode/*` (3 files), `packages/theme/test/kilocode/logo.test.ts`, `packages/tui/test/kilocode/model-presentation.test.tsx` |

**Generated Surface Hygiene:** No generated files (`packages/client/src/generated*`, OpenAPI specs) have manual edits. All client generation continues to be driven through `packages/client/bun run generate`.

## 4. In-Depth Evaluation of the 5 Candidate Cleanup Areas

### Area 1: TUI Theme Overrides (`packages/theme/src/tui/{defaults,fallback,schema,types}.ts`)

- **Source Evidence:**
  - `packages/theme/src/tui/schema.ts:109` (`logo: Schema.optional(ColorValue)`)
  - `packages/theme/src/tui/defaults.ts:112,335` (`logo: "#6f6500"`, dark default)
  - `packages/theme/src/tui/fallback.ts:11` (`logo: DEFAULT_THEME[mode].text.logo`)
  - `packages/theme/src/tui/types.ts:31` (`readonly logo: RGBA`)
  - Consumer: `packages/kilo-cli/src/tui-plugin/tui.tsx:30` (`render: () => <KiloLogo fg={ctx.theme.text.logo} ... />`).
- **AGENTS.md Constraint Analysis:**
  Root `AGENTS.md` explicitly mandates under **TUI Theme Tokens**:
  - *"Choose theme tokens by semantic role, not by their current color. Do not use raw `theme.hue` values or borrow an unrelated semantic token to achieve a preferred appearance."*
  - *"If the theme does not expose a token for the required semantic role, extend the theme schema, defaults, resolution, and types with that role before using it in a component. Do not repurpose the nearest-looking existing token."*
  - *"When changing the public theme token surface, verify the built-in light and dark defaults and the custom-theme fallback path in addition to the affected TUI component."*
- **Audit Finding:**
  The 4 theme files were modified strictly in compliance with repo rules. Reverting this patch to borrow `ctx.theme.hue.yellow[400]` or `ctx.theme.text.default` is explicitly **forbidden** by `AGENTS.md`. Hardcoding hex strings inside the component breaks custom theme support and light/dark theme resolution.
- **Classification:** **No safe equivalent extension seam exists.** These 4 files represent an intentional upstream theme schema expansion that should be submitted upstream or formally proposed for plan approval.

### Area 2: Model Picker Presentation Hook (`dialog-model.tsx`, `runtime.tsx`)

- **Source Evidence:**
  - `packages/schema/src/kilocode/models.ts` & `packages/kilo-cli/src/model-picker.ts`: `KiloModels.Definition.list` RPC provides `recommendedIndex`, `hasUserByokAvailable` ("BYOK"), `mayTrainOnYourPrompts` ("May train"), and routing classification (`isKiloAutoID`).
  - `packages/tui/src/component/dialog-model.tsx:28–60, 82–89, 120–129, 184–228, 246–260`: Manages an async lifecycle with `AbortController`, signals `groupState` ("loading" \| "ready" \| "fallback"), locks filtering while loading, renders loading spinner `emptyView`, and shows a warning banner on RPC failure.
- **Audit Finding:**
  This is not static catalog metadata or removable duplicate scaffolding. Model disclosures and recommendations are dynamic, location-scoped, and tied to authenticated Gateway account state. The native `Model` schema (`@opencode-ai/schema/model`) lacks BYOK, prompt-training, and recommendation fields.
- **Classification:** **Unproven to remove without an upstream extension slot.** While inlining 211 lines into `dialog-model.tsx` incurs merge tax, simply deleting the logic removes Kilo Auto and BYOK disclosures. The proper long-term solution is a narrow upstream slot or hook in `DialogModel` allowing host plugins to provide async metadata decorators.

### Area 3: Agent Display Naming Across 5 Shared Files

- **Source Evidence:**
  - `packages/tui/src/component/dialog-agent.tsx:14` (`title: item.name ?? item.id`)
  - `packages/tui/src/component/prompt/index.tsx:1559` (`agentLabel: agent ? (agent.name ?? Locale.titlecase(agent.id)) : undefined`)
  - `packages/tui/src/context/local.tsx:94–98` (`name: (id: string) => string`)
  - `packages/tui/src/routes/session/composer/subagents-tab.tsx:48` (`local.agent.name(session.agent, session.location)`)
  - `packages/tui/src/routes/session/index.tsx:2056,2091,2093,2122,3493` (`AssistantFooter`, `SessionSwitchMessageV2`, `SessionNoticeMessageV2`, `Subagent`).
- **Audit Finding:**
  Canonical agent IDs (`"general"`, `"code"`, `"architect"`, custom IDs) are durable identifiers used in execution, state storage, protocol events, and permissions. They **cannot** be mutated to display names without breaking routing and persistence. Upstream OpenCode hardcodes `Locale.titlecase(agent.id)` across all these components.
- **Classification:** **Functionally required upstream hooks.** Until upstream OpenCode provides a native display name resolver (e.g. updating upstream components to natively render `agent.name ?? Locale.titlecase(agent.id)`), these UI hooks cannot be removed without regressing custom agent presentation to raw uppercase IDs.

### Area 4: Autocomplete Deduplication & Integration Priority (`autocomplete.tsx`, `dialog-integration.tsx`)

- **Source Evidence:**
  - `packages/tui/src/component/prompt/autocomplete.tsx:522–536`: Deduplicates `results` across two distinct registries: TUI keymap commands (`keymapCommands()`) and server-side commands (`data.location.command.list(location.current)`).
  - `packages/tui/src/component/dialog-integration.tsx:30`: `kilo: -1` in `INTEGRATION_PRIORITY`.
- **Audit Finding:**
  TUI client commands (like `/memory` and `/teams`) have client execution handlers, whereas server commands insert text. Without the client-side shadowing set in `autocomplete.tsx`, `/memory` appears twice with conflicting semantics. Server-side registration alone cannot deduplicate them because the client keymap commands are defined client-side in the TUI. In `dialog-integration.tsx`, upstream hardcodes priority in a static object literal with no configuration seam.
- **Classification:** **Functionally required client logic.** Deleting the autocomplete shadowing causes duplicate command entries with divergent handlers.

### Area 5: Terminal Screen Mode Restoration in `destroyRenderer` (`renderer.ts`, `renderer.test.ts`)

- **Source Evidence:**
  - `packages/tui/src/util/renderer.ts:8` (`renderer.screenMode = "main-screen"`)
  - `packages/tui/test/util/renderer.test.ts:7–38` (verifies screenMode transition prior to destruction)
- **Audit Finding:**
  The patch in `renderer.ts` sets `renderer.screenMode = "main-screen"` before calling `renderer.destroy()`, and the test in `renderer.test.ts` exercises this intended call order (`title:`, `screen:main-screen`, `destroy`).
  However, attributing this exit teardown to preventing BB idle redraw race conditions is explicitly **unproven**: terminal resize restores alternate screen mode during an active TUI session, whereas teardown occurs strictly on exit before the CLI epilogue prints. Furthermore, whether native OpenTUI `destroy()` causes terminal corruption without this assignment has not been demonstrated with empirical evidence.
- **Classification:** **Unproven necessity / intended exit ordering.** While the test asserts intended ordering on shutdown, claims of native destroy corruption or preventing redraw races remain unproven without empirical evidence.

## 5. Verified Intentional Architectural Differences (Preserved)

The following areas match upstream concepts by name but represent **intentional, non-removable architecture**:

1. **`.kilo` and `.kilocode` Project Config Discovery (`packages/kilo-cli/src/project-config.ts`):**
   - Native upstream directory entries expose and execute plugins (`DirectoryEntry`), which has different trust and execution characteristics.
   - Kilo's isolated config loader parses project documents (`kilo.json`, `kilo.jsonc`) without executing arbitrary third-party plugins.
   - Upstream native `.agents` discovery only feeds skills; it does not parse or normalize agent markdown. Agent normalization has no exported upstream decoder.
2. **Host Path Isolation (`packages/kilo-cli/src/paths.ts`):**
   - The preview explicitly uses `kilo2` identity and paths to prevent collision with production `kilo` and upstream `opencode` data stores.
3. **Bounded Activity Telemetry Exporter (`packages/kilo-cli/src/telemetry.ts`):**
   - Upstream uses ambient OpenTelemetry spans/logs that can expose session transcripts. Kilo's exporter is strictly opt-in, name-only, and backed by an isolated settings adapter.
4. **Explicit-Credential Cloud Adapter (`packages/kilo-cli/src/cloud/*`):**
   - Resolves credentials in-host via the Gateway account Effect so sensitive tokens never cross the public RPC boundary.

## 6. Summary and Recommendation

The 22 shared upstream files in the tracked diff break down as follows:
- **6 Approved Files:** Authorized in `plans/kilo-opencode-v2-issue-13750.md`.
- **1 Generated Lockfile:** `bun.lock` (package manager state).
- **15 Handwritten Shared Code/Test Files:**
  - 4 Theme files (`packages/theme/src/tui/*`): Required by `AGENTS.md` theme rules; no safe extension seam.
  - 2 Renderer files (`packages/tui/src/util/renderer.ts`, `test`): Intended teardown sequence; corruption claims unproven.
  - 5 Agent naming files (`dialog-agent.tsx`, `prompt/index.tsx`, `subagents-tab.tsx`, `session/index.tsx`, `local.tsx`): Required because canonical IDs cannot be renamed and upstream lacks a display name hook.
  - 2 Autocomplete & Integration files (`autocomplete.tsx`, `dialog-integration.tsx`): Required for dual registry deduplication and provider ranking.
  - 2 Model picker files (`dialog-model.tsx`, `runtime.tsx`): Required for async Gateway metadata presentation.

**Recommendation:** Based on this bounded source audit, no safe, functionally equivalent cleanups were proven that would reduce shared files without violating repository constraints (such as `AGENTS.md` theme token rules) or breaking runtime behaviors. This verdict is conditional on the current source evidence and boundaries analyzed, not an absolute theorem. These 15 handwritten shared files represent structural extension seam gaps that require either upstream PRs or formal fork plan approval.
