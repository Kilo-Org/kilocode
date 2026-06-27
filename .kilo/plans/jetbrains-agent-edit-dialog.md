# JetBrains Agent Edit Dialog

## Goal

Implement the Agents settings `Edit` action as a modal `DialogWrapper` that edits a parent-owned draft model. Dialog `OK` saves into the settings page draft only; JetBrains Settings `Apply` / `OK` persists to CLI config, and `Reset` discards the draft.

## Scope

- Open a `DialogWrapper` from `AgentsSettingsUi.onCell(..., EDIT_CELL)`.
- Build the dialog with existing Swing settings helpers: `BaseContentPanel`, `SettingsRows`, `SettingsRow`, `SettingsToggle`, `Stack`, and IntelliJ platform components.
- Validate with IntelliJ platform validation (`initValidation()`, `doValidate()` / `doValidateAll()`, `ValidationInfo`, optionally `ComponentValidator` for live field feedback).
- Preserve regular `Configurable` workflow: edit dialog commit updates `AgentsSettingsUi` draft; `AgentBehaviorConfigurableBase.applyReady()` calls `applyDraft()`; `resetReady()` calls `resetDraft()`.
- Do not implement Add/Create/Import in this pass; leave existing placeholder actions.
- Do not add opencode server routes or SDK generation; ordinary agent settings can be persisted through existing `KiloAppService.updateConfig(ConfigPatchDto)`.

## Design Decisions

- Use a child `DialogWrapper`, not inline editing, so `Esc` only affects the edit dialog and cannot close the parent Settings dialog while editing.
- Treat dialog `OK` as "save to draft", not "write to disk". This is the key part that keeps JetBrains Settings Apply/Cancel/Reset semantics intact.
- Existing agent names remain read-only. Rename/create/delete are separate workflows because the agent map key is the identity.
- Start with the VS Code edit-mode fields that are config-backed and practical in this dialog: description, prompt, model override, variant, temperature, top_p, steps, hidden, disabled, mode.
- Display resolved/calculated permission rules read-only if useful, but do not build the full per-agent permission editor in this pass unless time remains. A raw JSON permission editor is a fallback only if explicitly desired during implementation.

## Patch DTO Fix First

Before editing arbitrary agent fields, fix the current `AgentConfigPatchDto` semantics.

Problem:

- `KiloCliDataParser.buildConfigPatch()` currently always emits `"model": null` for every `AgentConfigPatchDto` whose `model` property is null.
- That is safe for the existing model-settings use case, but unsafe for agent editing: a description-only patch would accidentally clear the model override.
- Nullable fields such as `prompt`, `description`, `variant`, `temperature`, `top_p`, and `steps` also cannot distinguish "unchanged" from "clear this field".

Plan:

- Extend `AgentConfigPatchDto` in `shared/src/main/kotlin/ai/kilocode/rpc/dto/KiloAppStateDto.kt` with a field such as `clear: List<String> = emptyList()`.
- Change `KiloCliDataParser.buildConfigPatch()` so agent fields are emitted only when non-null, and fields listed in `clear` are emitted as JSON null.
- Update `ModelsSettingsState.patch(...)` to use `AgentConfigPatchDto(clear = listOf("model"))` when clearing a per-agent model override.
- Update `FakeAppRpcApi.applyPatch(...)` to apply non-null agent fields and respect `clear` for tests.
- Update `KiloCliDataParserTest` expectations for per-agent model clear and add tests proving description-only patches do not emit `model: null`.

## Agent Draft Model

Add a focused state helper under `frontend/src/main/kotlin/ai/kilocode/client/settings/agentbehavior/`, likely `AgentSettingsState.kt`.

Data shape:

- `AgentsDraft(defaultAgent: String?, agents: Map<String, AgentEditDraft>)`.
- `AgentEditDraft` contains the editable config-backed fields plus display-only metadata needed for rows.
- Keep a `base` draft and mutable `draft` in `AgentsSettingsUi`.

Functions:

- `agentsDraft(config: ConfigDto?, details: List<AgentDetailDto>): AgentsDraft` merges `KiloAppService.state.value.config` with `KiloAgentBehaviorService.agents(dir)` results.
- `patch(from: AgentsDraft, to: AgentsDraft): ConfigPatchDto?` emits `values["default_agent"]` and `agents[name]` only for changed fields.
- `savedMatches(base, draft)` should compare only known draft fields, similar to `ModelsSettingsState.savedMatches(...)`.
- When `hidden` or `disable` becomes true for the current default agent, clear `defaultAgent` in the draft.

Notes:

- `AgentDetailDto` currently lacks some fields (`model`, `variant`, `prompt`, numeric overrides), so use `ConfigDto.agent[name]` for persisted override values.
- `AgentDetailDto` still provides row metadata and resolved permission rules.
- Built-in/native agents can accept config overrides; custom-only behavior should be limited to fields VS Code treats as custom-only, such as editing the description if needed.

## UI Changes

Modify `AgentsConfigurable.kt` or split new classes into nearby files:

- Store latest fetched `AgentDetailDto` list in `AgentsSettingsUi`.
- Build list rows from `draft` plus details so edited values and disabled/hidden badges update immediately after dialog OK.
- Implement `onCell(key, EDIT_CELL)`:
  - Find the agent detail and current `AgentEditDraft`.
  - Construct `AgentEditDialog(agent, draft, names)`.
  - If `showAndGet()` returns true, update `draft` with dialog result and refresh list UI without writing config.
- Keep `DELETE_CELL` behavior unchanged unless the implementation needs a small guard; deletion remains outside this request.
- Update `modified()` to compare the whole `AgentsDraft` to base.
- Update `applyDraft()` to call `KiloAppService.updateConfig(patch(base, draft))`, then refresh base from returned config or fall back to the applied draft.
- Update `resetDraft()` to restore `draft = base`, picker selection, and list rows.

Dialog implementation:

- Add `AgentEditDialog : DialogWrapper(true)`.
- Constructor sets title, calls `init()`, then `initValidation()`.
- `createCenterPanel()` returns a `BaseContentPanel` with sections/rows.
- Use IntelliJ components: `JBTextField`, `JBTextArea` inside `JBScrollPane`, `JComboBox`, `SettingsToggle` / `JBCheckBox` if appropriate.
- Override `getPreferredFocusedComponent()` and `getDimensionServiceKey()`.
- Use `doValidateAll()` if multiple validation messages are useful, otherwise `doValidate()` for the first invalid field.
- Override `doCancelAction(...)` only if the dialog needs a discard confirmation for dirty dialog fields. Since dialog changes are not committed until OK, plain Cancel/Escape already forgets edits; a confirmation can be added if the UX should explicitly warn.

Validation rules:

- `mode` must be one of `primary`, `subagent`, `all`.
- `temperature` and `top_p` must be blank or finite numbers, preferably in `[0, 1]` for `top_p`; keep `temperature` finite and non-negative unless existing product behavior requires broader values.
- `steps` must be blank or a positive integer.
- `model` and `variant` are optional text fields in this pass; trim whitespace and treat blank as clear.
- If permission JSON editing is included, parse with `kotlinx.serialization.json.Json` and validate action values are `ask`, `allow`, `deny`, or null.

## Strings

Add user-facing strings to `frontend/src/main/resources/messages/KiloBundle.properties` for:

- Dialog title and section headings.
- Field titles/descriptions/placeholders.
- Validation messages.
- Save/Cancel labels only if default `DialogWrapper` labels are not sufficient.
- Saving/failed text for agent settings apply progress if surfaced.

If the repo convention requires locale bundles to contain every key, add English fallback values to the `KiloBundle_*.properties` files; otherwise rely on ResourceBundle fallback to the base bundle.

## Tests

Add focused tests rather than broad UI snapshots:

- `AgentSettingsStateTest`:
  - Builds draft from config plus agent details.
  - Emits default-agent changes.
  - Emits changed description/prompt/mode/hidden/disable/numeric fields without emitting unrelated fields.
  - Emits explicit clears via `clear`.
  - Clears `defaultAgent` when hiding/disabling the selected default.
- `KiloCliDataParserTest`:
  - Agent description-only patch does not emit `model: null`.
  - Agent model clear emits `model: null` through `clear`.
  - Full agent patch still emits booleans/numbers/permission correctly.
- `AgentsSettingsUiTest` if practical:
  - Dialog OK updates draft and `modified()` becomes true without calling RPC update immediately.
  - `applyDraft()` sends one `ConfigPatchDto` through `FakeAppRpcApi`.
  - `resetDraft()` discards dialog changes.
- `AgentEditDialogTest` if practical:
  - `performValidateAll()` reports invalid numeric fields on EDT.
  - Cancel leaves parent draft unchanged by testing the parent `onCell` path or dialog result flow.

## Verification

Run the smallest relevant checks after implementation:

- `./gradlew typecheck` or `bun run typecheck` from `packages/kilo-jetbrains/`.
- Targeted frontend tests for new state/dialog tests if available.
- Targeted backend parser test if `KiloCliDataParserTest` is changed.
- Do not run `java -version` unless Gradle fails with a Java-version or missing-Java error.

## Files Expected To Change

- `packages/kilo-jetbrains/shared/src/main/kotlin/ai/kilocode/rpc/dto/KiloAppStateDto.kt`
- `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/cli/KiloCliDataParser.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/models/ModelsSettingsState.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agentbehavior/AgentsConfigurable.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agentbehavior/AgentSettingsState.kt` or equivalent new helper
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agentbehavior/AgentEditDialog.kt` or equivalent new helper
- `packages/kilo-jetbrains/frontend/src/main/resources/messages/KiloBundle.properties`
- Tests under `packages/kilo-jetbrains/frontend/src/test/...` and `packages/kilo-jetbrains/backend/src/test/...`
- A patch changeset under `.changeset/` because this is a user-facing JetBrains settings feature

## Out Of Scope

- Full Create Agent flow.
- Import/export agent JSON.
- Full visual per-agent permission editor parity with VS Code.
- Editing custom agent markdown files directly.
- New CLI HTTP endpoints or SDK regeneration.
