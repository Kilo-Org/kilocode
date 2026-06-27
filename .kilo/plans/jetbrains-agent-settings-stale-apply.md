# JetBrains Configurable Draft Lifecycle Refactor

## Goal

Unify the async save lifecycle for JetBrains settings pages that participate in IntelliJ Settings `isModified/apply/reset`, then fix the agent prompt stale-apply bug through that shared path.

The implementation should not be an Agents-only workaround. Models already has the right semantics in `BaseSettingsUi`; extract those semantics so Agents, Rules, Skills, and Models all share one baseline/pending/save model.

## Current Findings

IntelliJ `Configurable.apply()` is synchronous from the Settings dialog's perspective. The platform calls `apply()` and then immediately calls `isModified()`; it does not call `reset()` after apply.

Local IntelliJ source references:

- `$INTELLIJ_REPO/platform/ide-core/src/com/intellij/openapi/options/UnnamedConfigurable.java`: `apply()` stores form settings, `reset()` loads settings into the form.
- `$INTELLIJ_REPO/platform/platform-impl/src/com/intellij/openapi/options/ex/ConfigurableCardPanel.java`: calls `createComponent()` then `reset()` after component creation.
- `$INTELLIJ_REPO/platform/platform-impl/src/com/intellij/openapi/options/newEditor/SettingsEditor.java`: after `ConfigurableEditor.apply(configurable)`, the configurable is removed from the modified set only when `!configurable.isModified()`.

Affected Settings `Apply` pages:

- `ModelsSettingsUi` already uses `BaseSettingsUi`, which has `baseline`, `pending`, stale app-state rejection, failure rollback, and concurrent-edit preservation.
- `AgentsSettingsUi` duplicates a weaker version and can accept stale returned config, causing the reported prompt regression.
- `RulesSettingsUi` and `SkillsSettingsUi` both launch async saves and update their baseline only after the RPC returns, so they can also remain modified immediately after Apply and can accept stale returned config.

Not in scope for this draft lifecycle:

- `ProvidersSettingsUi` saves immediately from per-action flows, not via Settings `Apply`.
- `UserProfileConfigurable` is status/login UI with no persistent draft.
- `WorkflowsSettingsUi` is read-only.
- `McpSettingsUi` currently performs immediate remove actions, not a draft/apply page.

## Extraction Plan

1. Add a generic draft page contract under `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/base/`.

Suggested name: `SettingsDraftPage`.

```kotlin
internal interface SettingsDraftPage {
    fun modified(): Boolean = false
    fun applyDraft() = Unit
    fun resetDraft() = Unit
}
```

2. Move the generic ready-configurable delegation into a superclass.

Suggested name: `DraftReadyConfigurable<T : JComponent>`.

Responsibilities:

- Store the created ready UI component.
- Delegate `isModifiedReady()`, `applyReady()`, and `resetReady()` to `SettingsDraftPage` when the component implements it.
- Dispose the retained component if it implements `Disposable`.
- Leave project-directory lookup to subclasses.

3. Refactor `AgentBehaviorConfigurableBase` to extend `DraftReadyConfigurable<T>`.

Keep `AgentBehaviorConfigurableBase` only for agent-behavior-specific project directory resolution and `create(cs, dir)`.

4. Refactor `ModelsConfigurable` to extend `DraftReadyConfigurable<ModelsSettingsUi>`.

This removes the duplicate `ui?.modified()`, `ui?.applyDraft()`, `ui?.resetDraft()`, and disposal wiring while preserving model-specific directory resolution.

5. Replace `AgentBehaviorPage` with `SettingsDraftPage`.

Agents, Rules, and Skills should implement the base contract directly. Remove the agent-specific interface after callers are migrated.

6. Extract `BaseSettingsUi` draft-save semantics into a shared state helper.

Suggested name: `SettingsDraftState<D>`.

Responsibilities:

- Track `base`, `draft`, `pending`, `saving`, and `error`.
- Compute `modified()` as `draft` versus `pending ?: base` using a supplied saved-equality predicate.
- Start a save synchronously by setting `pending = draft`, `saving = true`, and clearing errors before the async RPC is launched.
- Accept external/app-state base updates only when there is no pending save, or when the update matches the pending target.
- Complete a successful save by accepting returned base only if it matches the applied target; otherwise use the applied target as the new base.
- Complete a failed save by restoring the previous base, keeping the edited draft visible, clearing pending, and leaving `modified()` true.
- Preserve user edits made while a save is in flight.

7. Refactor `BaseSettingsUi` to use `SettingsDraftState<D>` internally.

Keep its public/protected API stable where possible:

- `protected var draft`
- `protected val saving`
- `protected val saveError`
- `modified()`
- `resetDraft()`
- `applyDraft()`
- `acceptBase(base)`

The goal is for existing `ModelsSettingsUi` behavior and tests to continue passing while the reusable lifecycle moves out of `BaseSettingsUi`.

8. Use `SettingsDraftState` in `AgentsSettingsUi`.

Specific agent behavior:

- Initialize the state with `agentsDraft(app.state.value.config, emptyList())` and `savedMatches`.
- In `fetch()`, build `next = agentsDraft(currentConfig, agents)` and pass it through the shared base-accept path.
- Preserve the existing agent-details merge behavior for local dirty drafts, so newly discovered or removed agents do not disappear while the user is editing.
- Do not treat `modified() == false` during a pending save as permission to overwrite the draft from stale app config.
- In `applyDraft()`, use the shared start/complete/fail flow with `patch(base, draft)` and `KiloAppService.updateConfig(change)`.
- On successful but stale returned config, keep the applied draft as the new base so reopening `ask` shows the saved prompt without a manual refresh.

9. Use `SettingsDraftState` in `RulesSettingsUi`.

Specific rules behavior:

- Use `List<String>` or a tiny `RulesDraft` as the draft type.
- The `SettingsListEditor` callback updates `state.draft` through the shared update path.
- `applyDraft()` patches `ConfigPatchDto(instructions = draft)` through the shared lifecycle.
- `resetDraft()` resets through the shared lifecycle and updates the editor.
- Successful but stale returned config keeps the applied rules as the base.
- Failed saves keep the edited rules visible and modified.

10. Use `SettingsDraftState` in `SkillsSettingsUi`.

Specific skills behavior:

- Introduce `SkillsDraft(paths: List<String>, urls: List<String>)` if that keeps state readable.
- `modified()`, `resetDraft()`, and `applyDraft()` should all use the shared lifecycle.
- `fetch()` accepts current app config into the shared base state but must preserve dirty or pending local `paths/urls` edits.
- Local remove actions update the draft state, then refresh the rendered rows.
- Successful but stale returned config keeps the applied skills draft as the base.
- Failed saves keep the edited skills visible and modified.

## Backend Hardening

Keep the backend fix from the original plan because it protects every frontend settings caller.

Update `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/app/KiloBackendAppService.kt` so `updateConfig(...)` never returns the pre-patch `Ready` state after a successful `PATCH /global/config`.

Preferred approach:

- Keep sending the raw `PATCH /global/config` request with `KiloCliDataParser.buildConfigPatch(...)`.
- After a successful PATCH, fetch fresh config with `fetchConfig()` and warnings with `fetchWarnings()`.
- Build and return a `KiloAppState.Ready(current.data.copy(config = cfg, warnings = warns))` from the fresh config.
- Update `_appState` only when race checks show it is still safe, following the existing `refreshConfigState()` pattern.
- Throw if fresh config cannot be fetched after a successful PATCH instead of returning stale `current`; the frontend shared failure path will keep the draft modified.

## Tests

1. Add pure tests for `SettingsDraftState`.

Cover:

- Baseline edit and reset.
- Pending save target is not modified immediately after apply starts.
- New edits during a pending save become modified.
- Matching external base update accepts pending target.
- Stale external base update is ignored while pending.
- Successful save with matching returned base accepts returned base.
- Successful save with stale returned base falls back to applied target.
- Failed save keeps draft dirty and restores previous base.
- Concurrent edit is preserved after save completion.

2. Keep `BaseSettingsUiTest` and `BaseSettingsUiWorkspaceTest`, but adjust them to assert integration with the extracted state rather than owning all lifecycle behavior.

The existing tests already cover pending save, failed save, concurrent edit preservation, login banner stability, workspace load, and app/model state delivery.

3. Keep `ModelsSettingsUiTest` passing after the refactor.

These tests are important regression coverage because Models is the known-good implementation. They should verify that the extracted lifecycle preserves existing behavior.

4. Add `AgentsSettingsUiTest` coverage for the exact reported bug.

Use the real `AgentsSettingsUi`, real frontend services, fake RPC APIs, and real Swing component tree.

Use `com.intellij.ui.UiInterceptors.register(...)` to intercept the next `DialogWrapper` opened by clicking the `ask` row edit cell. Cast to `AgentEditDialog`, mutate the prompt field in `contentForTest()`, and call `performOKAction()`.

Assert:

- The prompt edit makes the page modified.
- `applyDraft()` makes `modified()` false immediately when no further edits were made.
- The recorded config patch contains `agents["ask"].prompt == "new"`.
- Reopening `ask` shows the new prompt, not the old prompt, without manual refresh.

5. Add a stale-return `AgentsSettingsUiTest`.

Extend `FakeAppRpcApi` with a test mode such as `configUpdateReturnStale = true` or a `configUpdateResult` callback.

The fake should still record and apply the patch to its internal state, but return the pre-patch state from `updateConfig(...)`.

Assert that the UI still reopens the agent with the applied prompt and `modified()` is false after save completion.

6. Add pending/failure `AgentsSettingsUiTest` coverage.

Use `FakeAppRpcApi.configUpdateGate` to block save completion.

Assert:

- `modified()` is false while the pending save target matches the draft.
- A second edit during the pending save makes `modified()` true.
- Releasing the gate preserves the second edit instead of overwriting it.
- `configUpdateError` leaves the edited prompt visible and `modified()` true.

7. Add `RulesSettingsUiTest` coverage.

Use real UI components where practical by finding the `SettingsListEditor` text field and Add button in the component tree.

Assert:

- Adding/removing a rule makes the page modified.
- `applyDraft()` makes `modified()` false immediately.
- Successful stale returned config keeps the applied rules as base.
- Failed save keeps edited rules visible and modified.
- Reset during pending save returns to the pending target.

8. Add `SkillsSettingsUiTest` coverage.

Seed `KiloAppService` config with `skills.paths` and `skills.urls`, and use `FakeAgentBehaviorRpcApi` for discovered skills.

Assert:

- Removing a local path or URL makes the page modified.
- `applyDraft()` makes `modified()` false immediately.
- Successful stale returned config keeps the applied skills as base.
- Failed save keeps edited skills visible and modified.
- Reload/fetch during a pending save does not overwrite the pending target from stale app config.

9. Add backend regression coverage in `KiloBackendAppServiceTest`.

Scenario:

- Seed `mock.config` with `ask.prompt = "old"` and connect until `Ready`.
- Change `mock.config` to `ask.prompt = "new"` before or during `svc.updateConfig(...)` so the next config fetch represents post-patch server state.
- Push `global.disposed` around the update to exercise the reload race.
- Call `svc.updateConfig(ConfigPatchDto(agents = mapOf("ask" to AgentConfigPatchDto(prompt = "new"))))`.
- Assert the returned `KiloAppState.Ready` contains `ask.prompt == "new"` and not the old prompt.
- Assert `mock.lastConfigPatchBody` contains the prompt patch.

10. Do not add production-only test accessors.

Use existing real UI traversal patterns, `UiInterceptors`, fake RPC APIs, EDT execution through `BasePlatformTestCase`, and `UIUtil.dispatchAllInvocationEvents()`.

## Files

Production files likely touched:

- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/base/SettingsDraftPage.kt` or equivalent new base file.
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/base/SettingsDraftState.kt` or equivalent new base file.
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/base/BaseSettingsUi.kt`.
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/models/ModelsConfigurable.kt`.
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agents/AgentBehaviorConfigurableBase.kt`.
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agents/AgentsConfigurable.kt`.
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agents/RulesConfigurable.kt`.
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/agents/SkillsConfigurable.kt`.
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/testing/FakeAppRpcApi.kt`.
- `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/app/KiloBackendAppService.kt`.

Test files likely touched or added:

- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/base/SettingsDraftStateTest.kt`.
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/base/BaseSettingsUiTest.kt`.
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/base/BaseSettingsUiWorkspaceTest.kt`.
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/models/ModelsSettingsUiTest.kt`.
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/agents/AgentsSettingsUiTest.kt`.
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/agents/RulesSettingsUiTest.kt`.
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/agents/SkillsSettingsUiTest.kt`.
- `packages/kilo-jetbrains/backend/src/test/kotlin/ai/kilocode/backend/app/KiloBackendAppServiceTest.kt`.

## Validation

Run from `packages/kilo-jetbrains/`:

```sh
./gradlew :frontend:test --tests "ai.kilocode.client.settings.base.*" --tests "ai.kilocode.client.settings.models.ModelsSettingsUiTest" --tests "ai.kilocode.client.settings.agents.*SettingsUiTest"
./gradlew :backend:test --tests "ai.kilocode.backend.app.KiloBackendAppServiceTest"
./gradlew typecheck
```

Run the full package test suite if shared settings base changes have wider impact:

```sh
./gradlew test
```

## Notes

All planned source changes are under `packages/kilo-jetbrains/`, which is Kilo-owned, so no `kilocode_change` markers are needed.

No CLI or SDK regeneration should be needed.

The user-visible outcome is that every Settings `Apply` draft page has consistent async-save behavior, and agent prompt edits reopen with the newly saved value without requiring manual refresh.
