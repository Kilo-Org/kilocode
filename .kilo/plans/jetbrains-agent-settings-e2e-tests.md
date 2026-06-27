# JetBrains Agent Settings — Add/Delete + End-to-End Test Coverage

Two parts:

- **Part A (feature)**: implement **adding** a custom agent in the JetBrains **Agents** settings page
  (currently a no-op placeholder), reusing the CLI's existing agent-builder endpoint.
- **Part B (tests)**: end-to-end coverage for the full agent settings round trip — **load** (CLI → UI),
  **save/edit** (UI → CLI), **add**, and **delete** — using **real frontend services backed by fake RPC
  apis** (no mocks) and the **real Swing component tree**, matching the existing `ProvidersSettingsUiTest`
  and `SessionControllerTestBase` patterns.

Delete is already implemented end-to-end; this plan keeps it and adds its tests.

## Decisions (confirmed with user)

- **Implement add.** Wire the existing "New Agent…" placeholder to a real create flow backed by the
  CLI's agent-builder `save` endpoint.
- **Edit-property → CLI** stays covered by two cooperating tests (dialog form binding + existing state
  transforms) rather than a test-only seam in the final, modal `AgentsSettingsUi`.
- Pure/validatable logic (state transforms, create validation) lives in plain functions that are unit
  tested directly, so modal `DialogWrapper` flows never need to be driven headlessly.

## How agent create/delete work in the CLI (already present)

- **Create**: `PUT /agent-builder/:id` → `AgentBuilder.save` (`packages/opencode/src/kilocode/agent/builder.ts`)
  writes a canonical agent markdown file (`<dir>/.kilo/agent/<id>.md` for project scope, `<config>/agent/<id>.md`
  for global), then the handler disposes the instance store so agent state refreshes. Body fields:
  `id`, `scope` (project|global), `mode` (primary|subagent|all), `description?`, `model?`, `color?`,
  `steps?`, `tools?`, `permission?`, `prompt` (**required, non-blank**). The JetBrains generated client
  **already exposes** `DefaultApi.agentBuilderSave(id, directory, workspace, AgentBuilderSaveRequest)`
  and `AgentBuilderSaveRequest` — **no SDK/CLI regen needed**.
- **Delete**: `POST /kilocode/agent/remove` → `KiloAgent.remove` deletes the agent markdown file (rejects
  native/organization agents) and refreshes. Already wired through `removeAgent` RPC.
- Backend RPC impls (`KiloAgentBehaviorRpcApiImpl`) call the typed generated client (e.g. `api.appAgents`)
  for reads and a raw okhttp `post(...)` for `removeAgent`. New `createAgent` uses the typed
  `api.agentBuilderSave(...)` (mirrors `agents()`), so no new okhttp plumbing.

## Background / current data flow (UI)

- `AgentsSettingsUi` (`settings/agents/AgentsConfigurable.kt`) extends `SettingsListPanel` and implements
  `AgentBehaviorPage`. It is `internal` and **final**, with `protected onCell`/`view`, so tests drive it
  via its public API (`modified()`, `applyDraft()`, `resetDraft()`, `reload()`, `dispose()`) plus
  component-tree traversal.
- **Load**: `fetch()` reads `KiloAgentBehaviorService.agents(dir)` + `KiloAppService.state.value.config`
  + `KiloWorkspaceService.models(dir).providers`, runs `agentsDraft(...)` (`AgentSettingsState.kt`) to merge
  them, and renders `rows()` into the `SettingsListView` `JBList<SettingsListItem>`.
- **Save (edit/default agent)**: `applyDraft()` → `patch(base, draft)` → `KiloAppService.updateConfig(patch)`
  → RPC. `FakeAppRpcApi.updateConfig` records the patch and applies it to its state, returning new state —
  a faithful CLI round-trip. The UI reloads the returned config into `base` (so `modified()` → `false`).
- **Edit properties**: `onCell(EDIT_CELL)` → modal `AgentEditDialog.showAndGet()` → `result()` →
  `updateAgent(draft, result)`. The modal `DialogWrapper` can't be accepted headlessly, so the dialog's
  form binding is tested directly.
- **Add**: today `addAction()` builds a `DefaultActionGroup` of two `PlaceholderAction`s (Create/Import)
  whose `actionPerformed` is a no-op. Part A replaces "Create" with a real action.
- **Delete**: `onCell(DELETE_CELL)` → `Messages.showYesNoDialog` (auto-answerable via `TestDialogManager`)
  → `KiloAgentBehaviorService.removeAgent(dir, name)` → RPC (`FakeAgentBehaviorRpcApi.removals`).
- **Default agent**: a `JComboBox<String>` built in `toolbarRight()` (real, non-modal).
- **Existing coverage**: `AgentSettingsStateTest` already unit-tests the transforms (`agentsDraft`,
  `updateAgent`, `patch`, `savedMatches`). The gap is the *wiring* through real services + real Swing.

## Part A — Implement "Add agent"

All changes are in Kilo-owned packages (`kilo-jetbrains` + reuse of existing `opencode` endpoints); no
`packages/opencode/` files are modified.

1. **Shared DTO** — `shared/.../rpc/dto/AgentBehaviorDto.kt`: add
   `@Serializable data class AgentCreateDto(name, prompt, mode = MODE_PRIMARY, description? = null, scope = "project")`
   (strings keep the wire payload simple; values validated before send).
2. **Shared RPC** — `shared/.../rpc/KiloAgentBehaviorRpcApi.kt`: add
   `suspend fun createAgent(directory: String, input: AgentCreateDto): Boolean`.
3. **Backend impl** — `backend/.../rpc/KiloAgentBehaviorRpcApiImpl.kt`: implement `createAgent` by mapping
   `AgentCreateDto` → `AgentBuilderSaveRequest` (`id = name`, `scope`, `mode`, `description`, `prompt`) and
   calling `api.agentBuilderSave(id = input.name, directory = directory, agentBuilderSaveRequest = req)`;
   return `true`. Mirrors the existing `agents()` typed-client call. The save handler refreshes state.
4. **Frontend service** — `frontend/.../app/KiloAgentBehaviorService.kt`: add
   `suspend fun createAgent(directory, input) = safe(false) { call { createAgent(directory, input) } }`.
5. **Pure create logic** — `frontend/.../settings/agents/AgentCreateState.kt` (new, mirrors
   `AgentSettingsState.kt`): `validateAgentCreate(input, existingNames): List<ValidationError>` (or a
   message map) enforcing the agent-id regex `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`, non-blank/non-duplicate name,
   non-blank prompt, and valid mode. Unit-testable without a dialog.
6. **Create dialog** — `frontend/.../settings/agents/AgentCreateDialog.kt` (new `DialogWrapper`): collects
   name (`JBTextField`), prompt (`EditorTextField`/`JBTextArea`), mode (`ComboBox`), scope
   (Project/Global `ComboBox`), description (`JBTextArea`, optional). `result(): AgentCreateDto`.
   `doValidateAll()` delegates to `validateAgentCreate(result(), existingNames)`.
7. **Wire the action** — `frontend/.../settings/agents/AgentsConfigurable.kt`: replace the Create
   `PlaceholderAction` with a real `DumbAwareAction` that opens `AgentCreateDialog(draft.agents.keys)`, and
   on OK runs `cs.launch { if (service<KiloAgentBehaviorService>().createAgent(dir, dialog.result())) withContext(edt) { reload() } }`.
   Keep "Import" as a placeholder (out of scope). After `reload()`, the new agent (now on disk / in the
   fake) renders in the list.
8. **i18n** — `frontend/src/main/resources/messages/KiloBundle.properties`: add create-dialog keys
   (`settings.agentBehavior.agents.create.title`, `.name`, `.name.invalid`, `.name.duplicate`, `.prompt`,
   `.prompt.invalid`, `.mode`, `.scope`, `.scope.project`, `.scope.global`, `.description`). English source
   only; other locales fall back.
9. **Test fake** — `frontend/src/test/.../testing/FakeAgentBehaviorRpcApi.kt`: add a `createAgent` override
   that records `creations` and appends a corresponding `AgentDetailDto(name, mode, native=false, ...)` to
   `agents`, so a subsequent `agents()` / `reload()` surfaces it.

### Add UX note (consistent with edit)

The Create action opens a modal `DialogWrapper`, which cannot be accepted in a headless test, and
`AgentsSettingsUi` is final. So "click Create → dialog → CLI" is **not** driven end-to-end headlessly.
Coverage is split: dialog form binding (`AgentCreateDialogTest`), validation (`AgentCreateStateTest`),
service round trip (`KiloAgentBehaviorServiceTest`), and the panel rendering a created agent after
`reload()` (`AgentsSettingsUiTest`).

## Part B — Tests

All under `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/...`. Extend
`BasePlatformTestCase`; never mock the EDT/threading; settle background RPC with a `flushUntil` loop that
drains coroutines + the EDT.

### `settings/agents/AgentCreateStateTest.kt` (new)
- Valid input passes; blank name, regex-invalid name, duplicate name (vs `existingNames`), blank prompt,
  and invalid mode each produce the expected validation error. Pure-function test, no UI.

### `settings/agents/AgentCreateDialogTest.kt` (new)
- Build on EDT (`edt { AgentCreateDialog(existingNames) }`); traverse `dialog.rootPane`, locating fields by
  their `SettingsRow` title (same `KiloBundle.message(...)` keys the dialog uses).
- Default form is empty/`primary`/`project`. Set name, prompt, mode, scope, description on the real
  components; `result()` returns the expected `AgentCreateDto`. Dispose via `edt { Disposer.dispose(dialog.disposable) }`.

### `settings/agents/AgentEditDialogTest.kt` (new) — *edit properties (form ⇄ data)*
- Real `AgentEditDialog`. Construct with `KiloAppService(scope, FakeAppRpcApi())` + `List<ModelPicker.Item>`.
- **Loads agent into form**: a fully-populated `AgentEditDraft` → assert each component shows the value
  (description/prompt/model/variant/mode/temperature/topP/steps/hidden/disable).
- **Reads edits back**: mutate real components (`JBTextArea.text`, `EditorTextField.text`,
  `JComboBox.selectedItem`, numeric `JBTextField.text`, toggles via `OnOffButton.doClick()`); assert
  `result()` reflects every edit (blank→null/trim, numbers parsed, flags flipped, mode updated).
- **Native restrictions**: `native = true` → description non-editable, mode/visibility toggles disabled,
  and `result()` leaves restricted fields unchanged.
- Locate fields via `SettingsRow`/`SettingsStackedRow` title labels; dispose the dialog in teardown.

### `app/KiloAgentBehaviorServiceTest.kt` (new) — *add + delete service round trips*
- `createAgent` forwards the right `AgentCreateDto` to the fake RPC and returns `true`; failure path
  returns `false` (the `safe(...)` fallback).
- `removeAgent` returns `true` and records the removal; failure path returns `false`.
- Construct the service directly with `KiloAgentBehaviorService(scope, FakeAgentBehaviorRpcApi())` (matches
  `KiloWorkspaceServiceTest`), call off the EDT.

### `settings/agents/AgentsSettingsUiTest.kt` (new) — *panel-level CLI ⇄ UI*
`installServices(...)`: `scope = CoroutineScope(SupervisorJob())`; build `app = KiloAppService(scope, appRpc)`
and seed `app._state.value = KiloAppStateDto(READY, config = ConfigDto(defaultAgent, agent))`;
`agentRpc.agents = listOf(AgentDetailDto(...))`; `workspaceRpc.models = ModelsWorkspaceDto(providers = ...)`
(provider id `kilo` so models survive the `items()` filter). Register all three on the application via
`replaceService(..., testRootDisposable)`. `ui = edt { AgentsSettingsUi(scope, "/test") }`. Traverse for the
`JBList<SettingsListItem>` (read `key`/`title`/`description`/`badges`/`cells`) and the default-agent
`JComboBox<String>`. Teardown: `edt { ui.dispose() }`, `scope.cancel()`, `TestDialogManager.setTestDialog(TestDialog.DEFAULT)`.

Cases:
- **loads agents from cli (CLI → UI)**: mix of native (`ask`), config-overridden primary (`code`), custom
  hidden, subagent, deprecated. After `flushUntil { rows present }`, assert keys/titles/merged descriptions
  and badges (`custom`/`hidden`/`disabled`/`subagent`/`deprecated`), that native rows expose no `DELETE`
  cell while custom rows do, and that the default-agent combo lists eligible candidates with the
  `config.defaultAgent` selected.
- **changing default agent saves patch (UI → CLI)**: set the combo selection → `modified()` true →
  `applyDraft()` → `flushUntil { appRpc.configPatches.isNotEmpty() }`; assert
  `patch.values[CONFIG_DEFAULT_AGENT]` and that `modified()` returns to `false` after reload.
- **adding an agent renders it (add → CLI → UI)**: call `service<KiloAgentBehaviorService>().createAgent(...)`
  (fake records the create + appends the agent) then `edt { ui.reload() }`; `flushUntil` the new agent
  appears in the list with the `custom` badge and a `DELETE` cell. Assert `agentRpc.creations` captured the
  input. (Documents that the modal Create action wiring isn't driven headlessly.)
- **deleting custom agent removes it (delete → CLI)**: `TestDialogManager.setTestDialog(TestDialog.YES)`;
  realize the list (`edt { list.setSize(400,200); list.doLayout() }`) and dispatch synthetic
  `MOUSE_PRESSED`+`MOUSE_RELEASED` (button1) at the delete cell center, computed from
  `list.getCellBounds(idx,idx)` + `settingsListCellBounds(list, bounds, item, selected)` (internal helpers
  used by the provider test). `flushUntil { agentRpc.removals.contains(name) }`; assert the row is gone and,
  if it was the default, the picker cleared it.
  - *Fallback if synthetic mouse dispatch is flaky*: keep the model-level assertion (custom rows render a
    `DELETE` cell, native do not) and rely on `KiloAgentBehaviorServiceTest` for the `removeAgent` round trip.
- **reset reverts unsaved default-agent change**: change combo → `modified()` → `resetDraft()` →
  `modified()` false and combo reselected to base default.
- *(optional)* **failed config update keeps change pending**: set `appRpc.configUpdateError`, change
  default agent, `applyDraft()`, flush; assert the attempt happened but `base` is unchanged.

## Files

**Add (production):**
- `packages/kilo-jetbrains/shared/src/main/kotlin/ai/kilocode/rpc/dto/AgentBehaviorDto.kt` (AgentCreateDto)
- `packages/kilo-jetbrains/shared/src/main/kotlin/ai/kilocode/rpc/KiloAgentBehaviorRpcApi.kt` (createAgent)
- `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/rpc/KiloAgentBehaviorRpcApiImpl.kt` (createAgent)
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/app/KiloAgentBehaviorService.kt` (createAgent)
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agents/AgentCreateState.kt` (new)
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agents/AgentCreateDialog.kt` (new)
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agents/AgentsConfigurable.kt` (wire Create action)
- `packages/kilo-jetbrains/frontend/src/main/resources/messages/KiloBundle.properties` (create keys)

**Add (tests + fake):**
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/testing/FakeAgentBehaviorRpcApi.kt` (createAgent override)
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/agents/AgentCreateStateTest.kt`
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/agents/AgentCreateDialogTest.kt`
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/agents/AgentEditDialogTest.kt`
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/app/KiloAgentBehaviorServiceTest.kt`
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/agents/AgentsSettingsUiTest.kt`

No `packages/opencode/` or SDK files change (agent-builder endpoint + generated client already exist).

## Validation

Run from `packages/kilo-jetbrains/` (requires Java 21):

- `./gradlew typecheck`
- `./gradlew :frontend:test --tests "ai.kilocode.client.settings.agents.*" --tests "ai.kilocode.client.app.KiloAgentBehaviorServiceTest"`
- `./gradlew test` for a full backend+frontend run if touching the shared RPC interface.

## Notes

- `packages/kilo-jetbrains/` is entirely Kilo-owned → **no `kilocode_change` markers**; the shared
  RPC/DTO + backend impl + frontend all change together (per the JetBrains AGENTS.md "files that must
  change together" rule for RPC contracts).
- **No SDK/CLI regen**: the agent-builder `save` route and `DefaultApi.agentBuilderSave` already exist.
- Adding "create agent" is a **user-facing JetBrains feature** → include it in the JetBrains release
  changelog at release time (per the `release-jetbrains` skill); repo changesets use non-JetBrains scopes.
- Validation/state logic is pure-tested; modal `DialogWrapper` flows (create/edit) and the
  `Messages`/synthetic-click delete are exercised at the form/service/render level, never by mocking
  threading.
- "Import agent" remains a placeholder (out of scope).
