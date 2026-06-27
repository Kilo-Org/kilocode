# JetBrains "Agent Behavior" settings parity

Bring the VS Code extension's **Agent Behaviour** settings tab to the JetBrains plugin with
**full feature parity**, built on the existing CLI-ready settings infrastructure and reusing
(and extending) the common settings classes.

## Decisions (from clarification)

- **Structure:** Separate IntelliJ Settings tree nodes per sub-tab (not one page with internal sub-tabs).
- **Scope:** Full end-to-end parity — agent create/edit/import/export, per-agent permission editor,
  calculated permissions, MCP runtime connect/disconnect/auth, skills discovery + on-disk removal,
  workflows viewer, instruction files, skill paths/urls.
- **Marketplace:** Do **not** wire up browsing/installing. Render a **disabled "Browse Marketplace"
  button with a "Coming soon" tooltip/note** everywhere VS Code shows it (Agents, MCP, Skills).
- **Claude Code compatibility:** Full parity — add a JetBrains plugin setting wired into the CLI spawn env.

## Source of truth (VS Code, for verbatim behavior/strings)

- `packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx` (5 sub-tabs)
- `ModeCreateView.tsx`, `ModeEditView.tsx`, `McpEditView.tsx`, `PermissionEditor.tsx`,
  `permission-utils.ts`, `mode-io.ts`, `agent-behaviour/WorkflowsTab.tsx`
- Strings: `packages/kilo-vscode/webview-ui/src/i18n/en.ts` lines 1317–1469 (`settings.agentBehaviour.*`,
  `settings.autoApprove.*`). Reuse the English copy verbatim.

Everything in `packages/kilo-jetbrains/` is Kilo-owned, so **no `kilocode_change` markers** are needed.

---

## Target tree structure

Today (registered in `frontend/src/main/resources/kilo.jetbrains.frontend.xml`, lines 26–55):

```
Tools → Kilo Code (KiloSettingsConfigurable, id ...settings)
  ├── Models     (...settings.models,    groupWeight 1)
  ├── Providers  (...settings.providers, groupWeight 1)
  └── Profile    (...settings.profile,   groupWeight 2)
```

Add a grouped **Agent Behavior** node with five children (mirrors the existing root-with-nav pattern
in `KiloSettingsConfigurable`):

```
Tools → Kilo Code
  ├── Models
  ├── Providers
  ├── Agent Behavior   (NEW group node, ...settings.agentBehavior, groupWeight 1)
  │     ├── Agents        (...settings.agentBehavior.agents)
  │     ├── MCP Servers   (...settings.agentBehavior.mcp)
  │     ├── Rules         (...settings.agentBehavior.rules)
  │     ├── Workflows     (...settings.agentBehavior.workflows)
  │     └── Skills        (...settings.agentBehavior.skills)
  └── Profile
```

- The **Agent Behavior** node itself is a plain `SearchableConfigurable` like `KiloSettingsConfigurable`
  (`frontend/.../settings/KiloSettingsConfigurable.kt`): a short description + `ActionLink`s to the five
  children. It does **not** gate on CLI ready and holds no settings.
- The five children are real configurables (gated on CLI ready). Register each as
  `<applicationConfigurable parentId="ai.kilocode.jetbrains.settings.agentBehavior" ...>` in
  `kilo.jetbrains.frontend.xml`. (Per the JetBrains AGENTS.md, configurables go in the module XML, not
  root `plugin.xml`.)

> Alternative considered: five flat siblings directly under Kilo Code (no group node). The group node is
> chosen to preserve the "Agent Behavior" concept while still being separate tree nodes.

---

## Architecture: layers to change

All paths under `packages/kilo-jetbrains/`.

### 1. Shared DTOs (`shared/.../rpc/dto/`)

**Read model — extend `ConfigDto`** (`KiloAppStateDto.kt`, currently only model fields):

- `ConfigDto` += `defaultAgent: String?`, `instructions: List<String>`, `skills: SkillsConfigDto?`,
  `mcp: Map<String, McpConfigDto>`.
- `AgentConfigDto` += `prompt`, `description`, `mode`, `hidden`, `disable`, `temperature`, `top_p`,
  `steps`, `permission: PermissionConfigDto?` (keep existing `model`, `variant`).
- New DTOs: `SkillsConfigDto(paths, urls)`, `McpConfigDto(type, command: List<String>?, url, environment: Map<String,String>?)`,
  `PermissionConfigDto = Map<String, PermissionRuleDto>`, and
  `PermissionRuleDto` = sealed { `Level(value: String?)` | `Patterns(map: Map<String,String?>)` } (mirrors
  `PermissionRule` in `permissions.ts`).

**Write model — extend `ConfigPatchDto`** (currently `values: Map<String,String?>` + `agents: Map<String,AgentConfigPatchDto{model}>`):

- Keep `values` for scalars (add `default_agent` to the allowlist).
- Add `instructions: List<String>?` (null = no change; empty list = clear), `skills: SkillsPatchDto?`,
  `mcp: Map<String, McpConfigDto?>?` (entry present = upsert; value null = delete server).
- Expand `AgentConfigPatchDto` to the **full** agent shape: `model`, `variant`, `prompt`, `description`,
  `mode`, `hidden`, `disable`, `temperature`, `top_p`, `steps`, `permission: PermissionConfigDto?`.

**Patch semantics (matches the CLI's deep-merge + null-as-delete):** the frontend includes an
agent/mcp object in the patch only when that entity changed vs baseline, and sends the **full target
object** with explicit `null` for cleared scalar fields (exactly how VS Code's `ModeEditView`/`McpEditView`
accumulate into the draft, e.g. sending explicit `false`/`null` so the CLI overwrites/deletes). This avoids
a per-field "present vs null" wrapper.

### 2. New RPC: `KiloAgentBehaviorRpcApi` (directory-scoped reads + runtime actions)

The config-backed values come from `KiloAppService.state.config` (existing). The **workspace/runtime**
data and side-effecting actions need a new RPC (modeled on `KiloWorkspaceRpcApi`):

- `shared/.../rpc/KiloAgentBehaviorRpcApi.kt` (`@Rpc`, `RemoteApi<Unit>`, suspend methods) with DTOs:
  - `agents(directory): List<AgentDetailDto>` — name, displayName, description, mode, native, hidden,
    deprecated, and **resolved permission rules** (`List<PermissionRuleItemDto>`).
  - `skills(directory): List<SkillDto{name, description, location}>`
  - `removeSkill(directory, location): Boolean`
  - `removeAgent(directory, name): Boolean`
  - `commands(directory): List<CommandDto{name, description, template}>` (workflows)
  - `mcpStatus(directory): List<McpStatusDto{name, status, error?}>`
  - `mcpConnect(directory, name)`, `mcpDisconnect(directory, name)`
  - `mcpAuthenticate(directory, name)` (+ `mcpAuthStart`/`mcpAuthCallback` if OAuth code flow is needed)
- Backend impl `backend/.../rpc/KiloAgentBehaviorRpcApiImpl.kt` delegates to the **already-generated**
  `DefaultApi` client (`backend/build/generated/openapi/.../client/DefaultApi.kt`), which exposes typed
  methods for every endpoint: `appAgents`, `appSkills`, `kilocodeRemoveSkill`, `kilocodeRemoveAgent`,
  `commandList`, `mcpStatus`, `mcpConnect`, `mcpDisconnect`, `mcpAuthAuthenticate`, etc. Map results to DTOs.
- Register a provider `KiloAgentBehaviorRpcApiProvider` in
  `backend/src/main/resources/kilo.jetbrains.backend.xml` (mirror `KiloAppRpcApiProvider`, lines 9–13) and
  in the shared module descriptor. Calls require `app.requireReady()`.
- Frontend service `frontend/.../app/KiloAgentBehaviorService.kt` (`@Service(APP)`) wraps the RPC with
  `durable {}` like `KiloWorkspaceService`.

> Underlying CLI routes (for reference): `GET /agent`, `GET /skill`(v2)/`app.skills`, `GET /command`,
> `GET /mcp` + `POST /mcp/{name}/connect|disconnect|auth/authenticate`,
> `POST /kilocode/skill/remove`, `POST /kilocode/agent/remove`. The "calculated permissions" come from the
> `Agent.permission` field on `GET /agent` (no separate endpoint).

### 3. Config write extension (backend)

`backend/.../cli/KiloCliDataParser.kt` → `buildConfigPatch` (lines 626–649) currently allowlists 4 keys
and emits strings only. Extend to emit JSON for:

- `default_agent` (string|null) — add to allowlist.
- `instructions` (string array).
- `skills: { paths: [...], urls: [...] }`.
- `mcp: { name: {…} | null }` (null deletes).
- `agent: { name: { full agent object incl. booleans/numbers/prompt/permission } }`.
- Permission objects: serialize `PermissionConfigDto`/`PermissionRuleDto` (level string or pattern map,
  null deletes a key).

Add unit tests in `backend/src/test/.../cli/KiloCliDataParserTest.kt` (the existing model-patch tests are
around lines 1657–1692) covering each new field type, null-as-delete, and full-agent objects.

The write path itself is unchanged: `KiloAppService.updateConfig(patch)` → `KiloAppRpcApi.updateConfig` →
`KiloBackendAppService.updateConfig` → `PATCH /global/config`.

### 4. Backend read mapping

`backend/.../rpc/KiloAppRpcApiImpl.kt` → `config(c: Config)` (lines 176–203) maps the generated `Config`
(which already deserializes `command`, `skills`, `defaultAgent`, `agent`, `mcp`, `instructions`,
`permission`) into the extended `ConfigDto`. Extend the `agents()` and `agent()` mappers to populate the
new `AgentConfigDto` fields incl. permission.

---

## New / extended common settings classes

Reuse: `KiloReadyConfigurable`, `BaseSettingsUi`, `BaseContentPanel.section()`, `SettingsRow`/`SettingsRows`,
`SettingsPanel`, `SettingsTop` banners, `SettingsProgressOverlay`, `UiStyle.*`, `Stack`/`Align`.

Extract these **new common classes** into `frontend/.../settings/base/` (or `client/ui/` where generic):

1. **`SettingsToggle`** — reusable boolean control for the `SettingsRow` value slot. Wrap
   `com.intellij.ui.components.OnOffButton` (switch, to match VS Code's `Switch`) with
   `selected`/`onToggle`. (The research confirmed no settings toggle widget exists yet.) This is the key
   new common class.
2. **`SettingsListEditor`** — the add-field + removable-rows pattern shared by Instruction Files, Skill
   Paths, Skill URLs, and MCP env/args. A `JBTextField` + "Add" button + rows (monospace value + close
   icon), optional per-row "open file" (pencil) action; `onChange(List<String>)` callback. Built from
   `SettingsRows` + `JBUI` spacing.
3. **`SettingsSectionHeader`** — section title with right-aligned action buttons (Available Agents +
   Import / Browse Marketplace / Create New Mode). Complements `BaseContentPanel.section()`.
4. **`comingSoonButton(text)`** — disabled `JButton` with a "Coming soon" tooltip, used for every
   "Browse Marketplace" placement. Add to `UiStyle.Components` (or `settings/base`).
5. **`SettingsBadge`** — small tag label (custom / subagent / hidden / disabled / deprecated) using theme
   colors (`JBUI.CurrentTheme` badge colors or `SimpleColoredComponent`), no hardcoded hex.
6. **`SettingsNavigator`** — `CardLayout` master/detail container with back navigation, for the Agents and
   MCP list↔edit/create drill-down (replaces VS Code's per-tab `view` signal).
7. **`LevelSelect`** — Default/Allow/Ask/Deny dropdown (`JComboBox`) used by the permission editor
   (Default = inherit).

Feature-specific (not "common") helpers, under `frontend/.../settings/agentbehavior/`:

8. **`PermissionUtils.kt`** — Kotlin port of `permission-utils.ts` (wildcard/exception patch builders,
   `effectiveRuleLevel`, `mostRestrictive`, `inheritedWildcard`, `permissionExceptions`).
9. **`PermissionEditorPanel`** — port of `PermissionEditor.tsx`: granular tools (external_directory, bash,
   read, edit with wildcard + add-path/add-command exceptions), simple tools, grouped (todoread/todowrite),
   trailing (websearch/webfetch/doom_loop); each row a `LevelSelect`; emits `PermissionConfigDto` patches.
10. **`CalculatedPermissionsPanel`** — read-only collapsible table (Tool / Pattern / Action), effective
    wildcard summary chips, copy-as-JSON; data from `AgentDetailDto.permission`.

---

## Per-node implementation

Each child configurable extends `KiloReadyConfigurable` (CLI-ready gate) and resolves the open project's
`basePath` for the directory (like `ModelsConfigurable.kt` line 17). Config-backed editing uses
`BaseSettingsUi<…>` (draft → IntelliJ **Apply**/**Reset**), and workspace/runtime data is fetched in
`loadWorkspace()` via `KiloAgentBehaviorService` (mirroring `ModelsSettingsUi.loadWorkspace → workspaces.models`).

### A. Agents (`AgentsConfigurable` + `AgentsSettingsUi`)
- **List view** (`SettingsNavigator` master):
  - **Default Agent** `SettingsRow` + dropdown → config `default_agent`. Options: visible primary agents +
    "Default" (empty → null). Reuse a combo like Models' picker pattern.
  - **`SettingsSectionHeader`** "Available Agents" with `[Import]`, `comingSoonButton("Browse Marketplace")`,
    `[Create New Mode]`.
  - Agent rows: name + `SettingsBadge`s (custom/subagent/hidden/disabled/deprecated), 0.5 opacity when
    disabled, remove (custom only) + edit chevron. Empty state "No agents found.".
- **Create view** (`ModeCreateView` parity): name (validated `^[a-z][a-z0-9-]*$`, unique), description,
  system prompt → adds `agent[slug] = {mode:"primary", description, prompt}` to draft.
- **Edit view** (`ModeEditView` parity): description (custom only), system prompt / prompt-override (native
  shows the "built-in mode" note), Model Override + Variant Override (reuse `ModelSettingPicker` /
  `ReasoningPicker`), Temperature, Top P, Max Steps (`JBTextField` parse), Hidden + Disabled
  (`SettingsToggle`; setting true clears `default_agent` if it points here), **`PermissionEditorPanel`**
  (custom agents) writing `agent.<name>.permission`, and **`CalculatedPermissionsPanel`** (read-only).
- **Import** (`mode-io.ts` port): IntelliJ `FileChooser` → parse/validate JSON (≤1 MB) → merge into draft;
  surface `nameRequired`/`nameInvalid`/`nameTaken`/`invalidJson`/`tooLarge` errors via `SettingsTop` banner.
- **Export** (custom): `FileSaverDialog` → write `{name}.agent.json`.
- **Remove** (custom): confirm dialog → **immediate** `KiloAgentBehaviorService.removeAgent` (deletes the
  custom agent file; matches `kilocode.removeAgent`), then reload agents.
- Config edits commit via **Apply**; add/remove agent + default_agent are part of the draft except the
  file-deleting Remove which is immediate (parity with VS Code).

### B. MCP Servers (`McpConfigurable` + `McpSettingsUi`)
- Header `comingSoonButton("Browse Marketplace")`.
- List from `ConfigDto.mcp` joined with runtime `mcpStatus` (service): status dot + label, expandable detail
  (command/args/url/env), **connect/disconnect `SettingsToggle`** (immediate RPC), **Sign In** button when
  `needs_auth` (immediate `mcpAuthenticate`), remove (immediate config write removing `mcp.<name>`), edit
  chevron. Empty state string. Status refreshed on load and after each action.
- **Edit view** (`McpEditView` parity): transport note; local → Command + Arguments (`SettingsListEditor`,
  one arg/line) + Environment Variables (KEY/value add + rows); remote → Server URL. Edits go to the draft
  → **Apply** (writes `mcp.<name>`).

### C. Rules (`RulesConfigurable` + `RulesSettingsUi`)
- Section description (`rules.description`).
- **Additional Instruction Files**: `SettingsListEditor` (add path, per-row pencil "open file" via
  `KiloWorkspaceService.openPath`, remove) → config `instructions` (draft → Apply).
- **Claude Code Compatibility** section: `SettingsRow` + `SettingsToggle` "Load Claude Code Files"
  (description incl. "Requires restart"). This is a **plugin setting**, not CLI config — see below.

### D. Workflows (`WorkflowsConfigurable`)
- Read-only. Reuse `SettingsPanel` + `section()`. Description (`workflows.description`). List from
  `KiloAgentBehaviorService.commands`: `/name` + description, expandable Description/Template. Empty state.
- No draft; can use `KiloReadyConfigurable` directly with a small ready panel that calls the service on
  ready (no `BaseSettingsUi` needed since `isModified` is always false).

### E. Skills (`SkillsConfigurable` + `SkillsSettingsUi`)
- Header `comingSoonButton("Browse Marketplace")`.
- **Discovered Skills**: list from `KiloAgentBehaviorService.skills`; non-builtin rows get a remove →
  confirm dialog → **immediate** `removeSkill(location)` (deletes files on disk), then reload. Empty state.
- **Skill Folder Paths** + **Skill URLs**: two `SettingsListEditor`s → config `skills.paths` / `skills.urls`
  (draft → Apply).

---

## Claude Code compatibility (full parity)

VS Code: `kilo-code.new.claudeCodeCompat` (default false). The backend launcher sets
`KILO_DISABLE_CLAUDE_CODE: "true"` **only when compat is false** (`server-manager.ts` line 142). So enabling
compat = do not disable Claude Code in the spawned CLI.

JetBrains today always sets `KILO_DISABLE_CLAUDE_CODE=true` in
`backend/.../cli/KiloBackendCliManager.kt` (`buildKiloCliEnv`, line 306).

Plan:
- Add an app-level plugin setting `claudeCodeCompat` (default false). Store via a `PersistentStateComponent`
  service (or extend `KiloPluginSettings`/`PropertiesComponent`). Must be readable from the **backend**
  spawn path — choose an app-level `@Service` accessible in `backend` (place the setting service so both the
  Rules UI in `frontend` and `KiloBackendCliManager` in `backend` can read/write it; if cross-module access
  is awkward, expose read/write via the new `KiloAgentBehaviorRpcApi`).
- In `buildKiloCliEnv`, make `KILO_DISABLE_CLAUDE_CODE` conditional: set `"true"` only when compat is
  **false** (matches VS Code exactly).
- The Rules toggle writes the setting **immediately** and prompts/triggers a CLI restart
  (`KiloAppService.restart()` exists) since it only takes effect on respawn ("Requires restart").

---

## i18n strings

Add `settings.agentBehavior.*` keys to `frontend/src/main/resources/messages/KiloBundle.properties`
(reuse the VS Code English copy verbatim from `en.ts` 1317–1437), plus:
- Display names: `settings.agentBehavior.displayName`, `.agents.displayName`, `.mcp.displayName`,
  `.rules.displayName`, `.workflows.displayName`, `.skills.displayName`.
- `save.pending` / `save.failed` per node (mirror `settings.models.save.*`).
- The permission editor reuses `settings.autoApprove.*` (levels, tool descriptions, add path/command,
  exceptions) — add those keys too.
Add matching entries to the 18 `KiloBundle_<locale>.properties` files (English fallback is acceptable
initially; translation is a follow-up).

---

## File-by-file change list

**Shared (`shared/src/main/kotlin/ai/kilocode/rpc/`)**
- `dto/KiloAppStateDto.kt` — extend `ConfigDto`, `AgentConfigDto`, `ConfigPatchDto`, `AgentConfigPatchDto`;
  add `SkillsConfigDto`, `McpConfigDto`, `SkillsPatchDto`, `PermissionConfigDto`, `PermissionRuleDto`.
- `dto/AgentBehaviorDto.kt` (new) — `AgentDetailDto`, `SkillDto`, `CommandDto`, `McpStatusDto`,
  `PermissionRuleItemDto`.
- `KiloAgentBehaviorRpcApi.kt` (new).
- shared module descriptor — register the new RPC if needed.

**Backend (`backend/src/main/kotlin/ai/kilocode/backend/`)**
- `rpc/KiloAppRpcApiImpl.kt` — extend `config()`/`agents()`/`agent()` mappers.
- `cli/KiloCliDataParser.kt` — extend `buildConfigPatch` for the new fields + permission JSON.
- `rpc/KiloAgentBehaviorRpcApiImpl.kt` (new) + `rpc/KiloAgentBehaviorRpcApiProvider.kt` (new).
- `cli/KiloBackendCliManager.kt` — conditional `KILO_DISABLE_CLAUDE_CODE` based on the compat setting.
- claude-compat setting service (new, app-level, backend-readable).
- `src/main/resources/kilo.jetbrains.backend.xml` — register the new RPC provider.

**Frontend (`frontend/src/main/kotlin/ai/kilocode/client/`)**
- `app/KiloAgentBehaviorService.kt` (new).
- `settings/base/SettingsToggle.kt`, `SettingsListEditor.kt`, `SettingsSectionHeader.kt`,
  `SettingsBadge.kt`, `SettingsNavigator.kt`, `LevelSelect.kt` (new common classes);
  `comingSoonButton` in `ui/UiStyle.kt` (`Components`).
- `settings/AgentBehaviorConfigurable.kt` (new group node, nav links).
- `settings/agentbehavior/` (new): `AgentsConfigurable`/`AgentsSettingsUi`(+state),
  `McpConfigurable`/`McpSettingsUi`, `RulesConfigurable`/`RulesSettingsUi`,
  `WorkflowsConfigurable`, `SkillsConfigurable`/`SkillsSettingsUi`,
  `PermissionUtils.kt`, `PermissionEditorPanel.kt`, `CalculatedPermissionsPanel.kt`,
  `ModeIo.kt` (import/export port).
- `settings/KiloSettingsConfigurable.kt` — add an `ActionLink` to Agent Behavior (optional, mirrors lines 42–64).
- `src/main/resources/kilo.jetbrains.frontend.xml` — register the group node + 5 child configurables.
- `messages/KiloBundle*.properties` — new strings.

**Tests (`*/src/test/...`)**
- `KiloCliDataParserTest` — new patch encodings (arrays, bools, numbers, mcp, full agent, permission, null delete).
- Frontend settings tests extending `BasePlatformTestCase` (mirror `KiloReadyConfigurableTest`,
  `SettingsRow`/state tests): list editor add/remove, toggle, permission patch builders (`PermissionUtils`),
  agent draft → patch, navigator master/detail, calculated permissions rendering.
- `KiloBackendCliManagerEnvTest` — `KILO_DISABLE_CLAUDE_CODE` flips with the compat setting.

---

## Suggested build sequence

1. **Foundation:** shared DTO extensions + `buildConfigPatch` extension + backend `config()` mapper + tests.
2. **Common classes:** `SettingsToggle`, `SettingsListEditor`, `SettingsSectionHeader`, `SettingsBadge`,
   `comingSoonButton`, `LevelSelect`, `SettingsNavigator`.
3. **RPC + service:** `KiloAgentBehaviorRpcApi`(+impl/provider/registration) + `KiloAgentBehaviorService`.
4. **Group node + registration** in `kilo.jetbrains.frontend.xml` + bundle display names.
5. **Rules** (instruction files + Claude compat incl. CLI-manager env wiring) — smallest config+plugin-setting node.
6. **Skills** (paths/urls config + discovered list + removal).
7. **Workflows** (read-only).
8. **MCP Servers** (config edit + runtime connect/auth/remove).
9. **Agents** (list/create/edit + `PermissionUtils`/`PermissionEditorPanel`/`CalculatedPermissionsPanel` +
   import/export) — largest, do last.
10. Full strings sweep, locale files, and verification.

## Verification

From `packages/kilo-jetbrains/`: `bun run typecheck` (or `./gradlew typecheck`) and `./gradlew test`
(requires Java 21). Manual: `./gradlew runIde`, open Settings → Tools → Kilo Code → Agent Behavior, verify
each node gates on CLI ready and matches VS Code behavior; confirm the disabled "Browse Marketplace
(coming soon)" buttons; toggle Claude Code compat and confirm CLI respawns with/without
`KILO_DISABLE_CLAUDE_CODE`.

## Risks / notes

- **Patch semantics**: full-object-per-changed-entity relies on the CLI's deep-merge + null-as-delete (as
  VS Code does). Cover with `KiloCliDataParserTest` and a manual round-trip check.
- **Permission editor** is the most intricate port (`PermissionEditor.tsx` + `permission-utils.ts`);
  isolate in `PermissionUtils.kt` with unit tests before wiring UI.
- **MCP OAuth**: `mcpAuthAuthenticate` may need the start/callback code flow for some servers; scope the
  authenticate path to match VS Code's `McpOAuth` (connect → if needs_auth, authenticate).
- **Claude-compat setting placement**: must be readable from `backend` at spawn time; if a frontend-only
  store is used, expose it to the backend (e.g. via the new RPC or a shared app service) so
  `KiloBackendCliManager` can read it.
- **Generated `DefaultApi`** already covers all needed endpoints; no SDK/CLI regeneration required for the
  reads/actions. Only the JetBrains plugin (shared/backend/frontend) changes.
