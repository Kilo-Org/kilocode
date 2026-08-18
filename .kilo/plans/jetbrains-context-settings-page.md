# JetBrains Context Settings Page

Implement the Tier 1 Context settings from `docs/jetbrains-vscode-settings-parity.md` in the JetBrains plugin. This is a pure `kilo.json` settings UI: no CLI feature work, no SDK regen, and no session-rendering changes.

## Goal

Add a new JetBrains settings page under `Settings -> Tools -> Kilo Code -> Context` for:

| Setting | Config key | Type |
|---|---|---|
| Auto-compaction | `compaction.auto` | boolean |
| Compaction threshold percent | `compaction.threshold_percent` | number or null |
| Prune on compaction | `compaction.prune` | boolean |
| Watcher ignore patterns | `watcher.ignore` | string array |

Do not include VS Code Context-tab memory/indexing controls in this first pass. JetBrains does not have the equivalent memory/indexing settings service yet, and the parity doc excludes indexing from easy wins.

Do not put `snapshot` on this page unless product explicitly decides to combine Context and Checkpoints. The parity doc suggests `snapshot` belongs on a new Checkpoints page.

## Context Verified

- Source parity doc: `docs/jetbrains-vscode-settings-parity.md`.
- JetBrains settings guidance: `packages/kilo-jetbrains/AGENTS.md`, especially `Settings UI`.
- Existing settings pages are registered in `packages/kilo-jetbrains/frontend/src/main/resources/kilo.jetbrains.frontend.xml`.
- Existing page pattern to mirror:
  - `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/models/ModelsConfigurable.kt`
  - `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/models/ModelsSettingsUi.kt`
  - `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/models/ModelsSettingsState.kt`
- Existing global config write path is sufficient once DTO/parser support is added:
  - Frontend: `KiloAppService.updateConfigAsync(...)`
  - RPC: `KiloAppRpcApi.updateConfig(patch: ConfigPatchDto)`
  - Backend: `KiloBackendAppService.updateConfig(...)`
  - HTTP: `PATCH /global/config`, then `GET /global/config`
- Existing backend parser currently only serializes selected string keys from `ConfigPatchDto.values`; Context needs typed booleans, numbers, explicit null, and string arrays.

## Decisions

- Use global config for the first implementation, matching the existing app-level settings write path.
- Add typed DTO fields instead of overloading `ConfigPatchDto.values` for non-string values.
- Use an explicit `clear` list for nullable compaction fields, because `Double?` cannot distinguish absent from explicit `null`.
- Reuse `BaseSettingsUi`, `DraftReadyConfigurable`, `SettingsDraftState`, `SettingsRows`, `SettingsRow`, and `SettingsToggle`.
- Use the shared settings list primitives for `watcher.ignore`; do not build a bespoke add/remove list if `SettingsListPanel` or adjacent list primitives fit.
- Keep all UI strings in `KiloBundle.properties`. Let other locale bundles fall back unless the repo's resource-bundle checks require duplicated English keys.

## Part A - Shared DTOs

File: `packages/kilo-jetbrains/shared/src/main/kotlin/ai/kilocode/rpc/dto/KiloAppStateDto.kt`

Add config read DTOs:

```kotlin
@Serializable
data class WatcherConfigDto(
    val ignore: List<String> = emptyList(),
)

@Serializable
data class CompactionConfigDto(
    val auto: Boolean? = null,
    val threshold_percent: Double? = null,
    val prune: Boolean? = null,
)
```

Extend `ConfigDto`:

```kotlin
val watcher: WatcherConfigDto? = null,
val compaction: CompactionConfigDto? = null,
```

Add patch DTOs:

```kotlin
@Serializable
data class WatcherPatchDto(
    val ignore: List<String>? = null,
)

@Serializable
data class CompactionPatchDto(
    val clear: List<String> = emptyList(),
    val auto: Boolean? = null,
    val threshold_percent: Double? = null,
    val prune: Boolean? = null,
)
```

Extend `ConfigPatchDto`:

```kotlin
val watcher: WatcherPatchDto? = null,
val compaction: CompactionPatchDto? = null,
```

Notes:

- `watcher.ignore = null` means no change.
- `watcher.ignore = emptyList()` means explicitly save an empty list.
- `compaction.threshold_percent = null` alone means no change.
- `compaction.clear = listOf("threshold_percent")` means emit JSON `"threshold_percent": null`.
- `false` boolean values must be serialized; do not treat `false` as absent.

## Part B - Backend Config Parser And Serializer

File: `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/cli/KiloCliDataParser.kt`

### Parse

Extend `parseConfig(raw)` to read:

- `watcher.ignore`
- `compaction.auto`
- `compaction.threshold_percent`
- `compaction.prune`

Add private helpers near `parseSkillsConfig` / `parseMcpConfig`:

```kotlin
private fun parseWatcherConfig(obj: JsonObject?): WatcherConfigDto?
private fun parseCompactionConfig(obj: JsonObject?): CompactionConfigDto?
```

Use existing helper style:

- strings: `str(...)`
- booleans: `flagOrNull(...)`
- numbers: `num(...)`
- arrays: `arr()?.mapNotNull { it.jsonPrimitive.contentOrNull }`

### Serialize

Extend `buildConfigPatch(patch)` to emit typed context patches:

```json
{
  "watcher": {
    "ignore": ["**/node_modules/**"]
  },
  "compaction": {
    "auto": true,
    "threshold_percent": 80,
    "prune": false
  }
}
```

For explicit threshold clearing:

```json
{
  "compaction": {
    "threshold_percent": null
  }
}
```

Keep the existing `values` allowlist for string model keys. Do not pass Context values through `values`.

## Part C - Frontend State Model

Add package: `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/context/`

New file: `ContextSettingsState.kt`

Define:

```kotlin
internal data class ContextDraft(
    val auto: Boolean? = null,
    val threshold: String = "",
    val prune: Boolean? = null,
    val ignore: List<String> = emptyList(),
)
```

Use a string for the threshold draft so the UI can represent blank/invalid intermediate input without losing user text. Convert only when building a patch.

Functions to add:

- `contextDraft(config: ConfigDto?): ContextDraft`
- `patch(from: ContextDraft, to: ContextDraft): ConfigPatchDto`
- `savedMatches(base: ContextDraft, draft: ContextDraft): Boolean`
- `threshold(value: String): Double?` or equivalent parsing helper
- validation helper for threshold range if desired

Patch behavior:

- Only emit changed fields.
- Emit `CompactionPatchDto(auto = false)` when the user turns auto-compaction off.
- Emit `CompactionPatchDto(prune = false)` when the user turns pruning off.
- Emit `CompactionPatchDto(threshold_percent = 80.0)` for a non-blank valid number.
- Emit `CompactionPatchDto(clear = listOf("threshold_percent"))` when an existing threshold is cleared.
- Emit `WatcherPatchDto(ignore = emptyList())` when the last ignore pattern is removed.
- Return no change from the page when all fields match the baseline.

## Part D - Frontend UI Page

New file: `ContextConfigurable.kt`

Mirror `ModelsConfigurable`:

- Extend `DraftReadyConfigurable<JComponent>`.
- `ID = "ai.kilocode.jetbrains.settings.context"`.
- `getDisplayName()` returns `KiloBundle.message("settings.context.displayName")`.
- `create(cs)` returns `ContextSettingsUi(cs)`.

New file: `ContextSettingsUi.kt`

Mirror the simple parts of `ModelsSettingsUi`:

- Extend `BaseSettingsUi<ContextSettingsContent, ContextDraft, ConfigPatchDto, KiloAppStateDto, Unit>`.
- Initial draft is `ContextDraft()`.
- `save(change, done)` calls `app.updateConfigAsync(change, done)`.
- `base(result)` and `draft(state)` call `contextDraft(state.config)`.
- `saved(base, draft)` calls `savedMatches(base, draft)`.
- `pendingText()` uses `settings.context.save.pending`.
- `failedText()` uses `settings.context.save.failed`.
- `loadWorkspace(root)` returns `Unit`; `applyWorkspace(result)` is `Unit`.
- `models(state)` is `Unit`.
- `syncContent()` updates enabled states, field values, save/progress overlay, and validation messaging.

New content class: `ContextSettingsContent`

Suggested layout:

- Section `settings.context.compaction.title`
  - Toggle row `settings.context.compaction.auto.title`
  - Numeric row `settings.context.compaction.threshold.title`
  - Toggle row `settings.context.compaction.prune.title`
- Section `settings.context.watcher.title`
  - List editor row/panel for ignore patterns

Controls:

- Use `SettingsToggle` for booleans.
- Use `JBTextField` or a small reusable numeric field pattern based on `AgentEditDialog` for threshold.
- Use shared list primitives (`SettingsListPanel` / `SettingsListView` / `SettingsListItem` / `SettingsListCell`) for `watcher.ignore` where practical.
- Keep the page editable while app status is ready and no save is pending.
- Disable controls while saving.

Validation:

- Blank threshold is valid and means clear/reset the config value if it differs from baseline.
- Non-numeric threshold is invalid and should prevent `apply()` from sending a patch.
- Suggested accepted range is `0..100`; if existing CLI allows a broader range, follow CLI behavior.
- Show validation through existing settings messaging rather than custom ad hoc labels.

## Part E - Settings Registration And Root Navigation

File: `packages/kilo-jetbrains/frontend/src/main/resources/kilo.jetbrains.frontend.xml`

Add a child configurable:

```xml
<applicationConfigurable
        parentId="ai.kilocode.jetbrains.settings"
        id="ai.kilocode.jetbrains.settings.context"
        groupWeight="3"
        instance="ai.kilocode.client.settings.context.ContextConfigurable"
        bundle="messages.KiloBundle"
        key="settings.context.displayName"/>
```

Adjust weights so the desired order is stable. Recommended order:

| Page | Weight |
|---|---|
| User Profile | 5 |
| Models | 4 |
| Context | 3 |
| Providers | 2 |
| Agent Behavior | 1 |

File: `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/KiloSettingsConfigurable.kt`

Add a root-page `ActionLink` for Context between Models and Providers:

- Import `ContextConfigurable`.
- Link text: `settings.context.displayName`.
- Link target: `ContextConfigurable.ID`.

`KiloSettingsSelection.kt` probably needs no code changes because child IDs already share the root prefix.

## Part F - Strings

File: `packages/kilo-jetbrains/frontend/src/main/resources/messages/KiloBundle.properties`

Add base strings near the other settings strings:

```properties
settings.context.displayName=Context
settings.context.description=Configure compaction and file-watcher context behavior.
settings.context.save.pending=Saving context settings...
settings.context.save.failed=Failed to save context settings
settings.context.compaction.title=Compaction
settings.context.compaction.description=Control when Kilo summarizes long sessions to reduce context usage.
settings.context.compaction.auto.title=Auto-compaction
settings.context.compaction.auto.description=Automatically compact long conversations before they exceed the model context window.
settings.context.compaction.threshold.title=Compaction threshold
settings.context.compaction.threshold.description=Percent of the context window to use before auto-compaction starts. Leave blank to use the default.
settings.context.compaction.threshold.invalid=Enter a number from 0 to 100, or leave the field blank.
settings.context.compaction.prune.title=Prune on compaction
settings.context.compaction.prune.description=Drop older raw conversation details after compaction to keep the session context smaller.
settings.context.watcher.title=Watcher ignore patterns
settings.context.watcher.description=Glob patterns Kilo should ignore when watching repository file changes.
settings.context.watcher.add=Add pattern
settings.context.watcher.empty=No ignore patterns configured.
settings.context.watcher.placeholder=e.g. **/dist/**
settings.context.watcher.remove=Remove {0}
```

If resource-bundle tests require every key in every locale bundle, copy English values into the localized bundles and leave translation work for a later i18n pass.

## Part G - Test Updates

### Frontend state tests

Add: `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/context/ContextSettingsStateTest.kt`

Cover:

- Draft reads `ConfigDto.watcher` and `ConfigDto.compaction`.
- Unchanged draft emits no patch.
- Boolean changes emit `false` and `true` correctly.
- Threshold set emits `threshold_percent`.
- Threshold clear emits `clear = listOf("threshold_percent")`.
- Watcher list add/remove emits the whole new `ignore` list, including empty list.
- Invalid threshold is rejected before save if validation lives in state helpers.

### Frontend UI tests

Add: `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/context/ContextSettingsUiTest.kt`

Use `ModelsSettingsUiTest` as the main pattern:

- `BasePlatformTestCase`.
- Real EDT.
- `FakeAppRpcApi`.
- `KiloAppService`.
- `flushUntil` helpers.
- Assert `rpc.configPatches` after user interaction.
- Assert controls disable during pending save.
- Assert failed save leaves page modified and shows `settings.context.save.failed`.

Update `FakeAppRpcApi`:

- File: `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/testing/FakeAppRpcApi.kt`
- Apply `patch.watcher` and `patch.compaction` to fake config state.
- Preserve explicit empty lists.
- Preserve boolean `false`.
- Honor `compaction.clear` by setting cleared fields to `null`.

### Backend parser tests

Update: `packages/kilo-jetbrains/backend/src/test/kotlin/ai/kilocode/backend/cli/KiloCliDataParserTest.kt`

Add exact JSON tests for:

- `parseConfig` reads watcher and compaction fields.
- `buildConfigPatch` emits watcher ignore arrays.
- `buildConfigPatch` emits `auto=false` and `prune=false`.
- `buildConfigPatch` emits numeric `threshold_percent`.
- `buildConfigPatch` emits explicit `threshold_percent:null` when `clear` includes the field.

### Backend app service tests

Update: `packages/kilo-jetbrains/backend/src/test/kotlin/ai/kilocode/backend/app/KiloBackendAppServiceTest.kt`

Add a test similar to the existing model config update test:

- Call `updateConfig(ConfigPatchDto(watcher = ..., compaction = ...))`.
- Assert `MockCliServer.lastConfigPatchBody` exactly matches the expected nested JSON.
- Assert the returned/reloaded `ConfigDto` includes the saved Context values.

### Root settings tests

Update: `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/KiloSettingsConfigurableTest.kt`

Add:

- `ContextConfigurable.ID == "ai.kilocode.jetbrains.settings.context"`.
- Root page includes a Context link.
- Link order matches XML order.

## Validation

Run from `packages/kilo-jetbrains/`:

```bash
./gradlew typecheck
./gradlew test
```

Focused checks while iterating:

```bash
./gradlew :shared:test --tests '*ContextSettingsStateTest'
./gradlew :frontend:test --tests '*ContextSettingsUiTest'
./gradlew :backend:test --tests '*KiloCliDataParserTest'
./gradlew :backend:test --tests '*KiloBackendAppServiceTest'
```

If the exact Gradle module test selectors differ, run the package-level `./gradlew test` before marking the implementation ready.

Manual verification:

1. Run `./gradlew runIde` from `packages/kilo-jetbrains/`.
2. Open `Settings -> Tools -> Kilo Code -> Context`.
3. Toggle auto-compaction and prune.
4. Set threshold to a number, apply, reopen settings, and verify it persists.
5. Clear threshold, apply, reopen settings, and verify it resets.
6. Add and remove watcher ignore patterns, apply, reopen settings, and verify the list persists.
7. Inspect the global Kilo config file through the existing `Open: global ...` action if needed.

## Risks And Follow-ups

- Global vs project-local config: this plan uses the existing global config write path. Project-local Context settings would need new workspace config RPC plumbing.
- Threshold null semantics: implement explicit clear handling; otherwise clearing the field will silently do nothing.
- String-array UI: reuse list primitives even if it takes a small adapter type; avoid one-off list widgets.
- VS Code memory/indexing parity: defer because it is not pure config and is excluded by the easy-win criteria.
- Checkpoints page: implement `snapshot` separately unless product asks to combine it with Context.
- Changeset: when implementing this user-facing JetBrains settings feature, add a patch changeset for `kilo-code`/JetBrains according to repo release guidance.
