# JetBrains custom provider: close on OK, select, edit, edit/disconnect buttons

## Goal

Fix the JetBrains "Add custom provider" flow and add edit support:

1. Confirming the dialog closes it (OK label "Add" for add, "Save" for edit).
2. The added/edited provider becomes the selected row in the list.
3. Double-clicking an editable custom provider opens it for editing instead of disconnecting it.
4. Editable custom providers show both **Edit** and **Disconnect** action buttons.

All work is in `packages/kilo-jetbrains/frontend/`. No backend, RPC, or DTO changes. `saveCustom` already upserts, and `ProviderSettingsDto.config[id]` already carries the fields needed to prefill an edit. No `kilocode_change` markers are needed (all files are under Kilo-owned `packages/kilo-jetbrains/`).

## Root causes (verified in code)

- **Dialog does not close**: `CustomProviderDialog.syncActions()` sets `isOKActionEnabled = !saving && !fetching && modelIds().isNotEmpty()` (ProvidersSettingsUi.kt:957). On save success `doOKAction()` sets `outcome` and calls `closeOk()` → `super.doOKAction()` (line 966), which only closes when `getOKAction().isEnabled()` is true. `saving` stays `true`, so OK is disabled and nothing closes even though the log prints "closing dialog".
- **Double-click deletes**: `SettingsListView.mouseClicked` fires `primary(item)` on non-button double-clicks (SettingsListView.kt:65-72), and `primary` runs the first enabled cell. A configured custom provider only exposes `DISCONNECT` (ProviderListRows.kt:90), so double-click disconnects.
- **Edit feasibility**: `KiloBackendProviderSettingsManager.saveCustom` patches config as an upsert and only touches auth when a key/env is supplied (lines 154-166); a blank key on edit preserves the stored secret. Prefill source is `state.config[id]`: `name`, `options["baseURL"]`, `env` (first entry), `models` (model ids). The API key is a secret and is never returned, so the key field starts blank on edit.
- OK label is already `settings.providers.customAdd=Add`; edit mode needs a new "Save" label.

## Exact edits

### 1. `packages/kilo-jetbrains/frontend/src/main/resources/messages/KiloBundle.properties`

Add `settings.providers.edit=Edit` right after line 456 (`settings.providers.disconnect=Disconnect`):

```
settings.providers.edit=Edit
```

Add two keys in the custom block (after line 470 `customTitle` / line 471 `customAdd`):

```
settings.providers.customEditTitle=Edit OpenAI-Compatible Provider
settings.providers.customSave=Save
```

Only edit the base `KiloBundle.properties`; other locale files fall back to base for missing keys.

### 2. `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/providers/ProviderCatalog.kt`

Add a helper at the end of the file (after `configured(...)`, line 99):

```kotlin
internal fun customEditable(provider: ProviderSettingsProviderDto, state: ProviderSettingsDto) =
    state.config[provider.id]?.npm == CUSTOM_PROVIDER_PACKAGE
```

`CUSTOM_PROVIDER_PACKAGE` (`"@ai-sdk/openai-compatible"`) is already defined at line 19 and is the same signal the backend disconnect path uses.

### 3. `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/providers/ProviderListRows.kt`

Add `EDIT` to the enum (line 12-17):

```kotlin
internal enum class ProviderListAction {
    CONNECT,
    OAUTH,
    EDIT,
    DISCONNECT,
    ENABLE,
}
```

Update `cells` (lines 35-43) to mark EDIT primary and keep both EDIT and DISCONNECT visible when connected:

```kotlin
    override val cells: List<SettingsListCell>
        get() = actions.map { action ->
            SettingsListCell(
                action.name,
                providerListActionText(action),
                enabled(action),
                alwaysVisible = (action == ProviderListAction.DISCONNECT || action == ProviderListAction.EDIT) && connected,
                primary = action == ProviderListAction.EDIT,
            )
        }
```

`enabled(action)` (line 45) already returns true for EDIT (`action != DISCONNECT`), no change.

Add the EDIT label to `providerListActionText` (lines 48-53):

```kotlin
    ProviderListAction.EDIT -> KiloBundle.message("settings.providers.edit")
```

Update `providerActions` (lines 83-96) so configured editable custom providers expose EDIT + DISCONNECT:

```kotlin
internal fun providerActions(
    provider: ProviderSettingsProviderDto,
    state: ProviderSettingsDto,
    disabled: Set<String> = state.disabled.toSet(),
): List<ProviderListAction> {
    if (provider.id in disabled) return listOf(ProviderListAction.ENABLE)
    if (provider.id == KILO_PROVIDER_ID && configured(provider, state, state.connected.toSet())) return emptyList()
    if (configured(provider, state, state.connected.toSet())) {
        return if (customEditable(provider, state)) {
            listOf(ProviderListAction.EDIT, ProviderListAction.DISCONNECT)
        } else {
            listOf(ProviderListAction.DISCONNECT)
        }
    }
    val methods = providerMethods(provider, state)
    return buildList {
        if (methods.any { it.type == "oauth" }) add(ProviderListAction.OAUTH)
        if (methods.any { it.type == "api" }) add(ProviderListAction.CONNECT)
    }
}
```

### 4. `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/providers/ProvidersSettingsUi.kt`

**4a. Import.** Add to the settings.base imports (near line 7):

```kotlin
import ai.kilocode.client.settings.base.SettingsListSelection
```

**4b. `view` field (line 196).** Pass the new edit callback:

```kotlin
    private val view = ProvidersContent(::connect, ::oauth, ::disconnect, ::enable, ::edit)
```

**4c. Replace `custom()` (lines 314-330)** with add + edit + shared open:

```kotlin
    @RequiresEdt
    private fun custom() {
        checkEdt()
        openCustomDialog(null)
    }

    @RequiresEdt
    private fun edit(provider: ProviderSettingsProviderDto) {
        checkEdt()
        val cfg = state.config[provider.id] ?: return
        openCustomDialog(
            CustomProviderEdit(
                id = provider.id,
                name = cfg.name ?: provider.name,
                baseUrl = cfg.options["baseURL"].orEmpty(),
                envVar = cfg.env.firstOrNull(),
                models = cfg.models.values.map { it.id },
            ),
        )
    }

    // The dialog performs the save itself so failures can be shown inline and the user can
    // correct their input without re-typing. It only closes on a verified success.
    @RequiresEdt
    private fun openCustomDialog(existing: CustomProviderEdit?) {
        checkEdt()
        val dialog = CustomProviderDialog(
            cs,
            directory,
            { service<KiloProviderService>().fetchCustomModels(it) },
            { service<KiloProviderService>().saveCustom(it) },
            existing,
        )
        if (!dialog.showAndGet()) return
        val next = dialog.outcome ?: return
        state = next
        view.update(next, dialog.savedId)
        clearProgress()
    }
```

**4d. `ProvidersContent` (lines 520-591).** Add the `edit` callback and handle EDIT + selection.

Constructor (lines 520-525):

```kotlin
internal class ProvidersContent(
    private val connect: (ProviderSettingsProviderDto) -> Unit,
    private val oauth: (ProviderSettingsProviderDto) -> Unit,
    private val disconnect: (ProviderSettingsProviderDto) -> Unit,
    private val enable: (ProviderSettingsProviderDto) -> Unit,
    private val edit: (ProviderSettingsProviderDto) -> Unit,
) : BaseContentPanel() {
```

`update` (lines 536-545) — add optional `select`:

```kotlin
    @RequiresEdt
    fun update(state: ProviderSettingsDto, select: String? = null) {
        checkEdt()
        val notes = state.providers.count { providerDescription(it).isNotBlank() }
        ProvidersSettingsUi.LOG.info("provider settings content update: start providers=${state.providers.size} connected=${state.connected.size} disabled=${state.disabled.size} descriptions=$notes")
        this.state = state
        val rows = providerListRows(state, "", disabledRows = busy)
        if (select != null) view.update(rows, SettingsListSelection.Key(select)) else view.update(rows)
        ProvidersSettingsUi.LOG.info("provider settings content update: completed rows=${rows.size}")
    }
```

`activate` `when` block (lines 580-585) — add EDIT:

```kotlin
        when (action) {
            ProviderListAction.CONNECT -> connect(row.provider)
            ProviderListAction.OAUTH -> oauth(row.provider)
            ProviderListAction.DISCONNECT -> disconnect(row.provider)
            ProviderListAction.ENABLE -> enable(row.provider)
            ProviderListAction.EDIT -> edit(row.provider)
        }
```

**4e. `CustomProviderDialog`.** Add the edit-prefill data class, constructor param, prefill, `savedId`, edit-aware title/button, and the close fix.

Add near the dialog (e.g. above `internal class CustomProviderDialog`):

```kotlin
internal data class CustomProviderEdit(
    val id: String,
    val name: String,
    val baseUrl: String,
    val envVar: String?,
    val models: List<String>,
)
```

Constructor (lines 645-650) — add `existing` as the last param (keeps existing positional test calls valid):

```kotlin
internal class CustomProviderDialog(
    private val cs: CoroutineScope,
    private val directory: String,
    private val fetch: suspend (CustomModelFetchDto) -> CustomModelFetchResultDto,
    private val save: suspend (CustomProviderSaveDto) -> ProviderActionResultDto,
    private val existing: CustomProviderEdit? = null,
) : DialogWrapper(true) {
```

Add the `savedId` property next to `outcome` (lines 667-669):

```kotlin
    // Set once the save succeeds; the panel reads it after the dialog closes to update the list.
    var outcome: ProviderSettingsDto? = null
        private set

    // Id of the provider the save persisted; used to select the row after the dialog closes.
    var savedId: String? = null
        private set
```

`init` (lines 671-686) — edit-aware title/button and prefill:

```kotlin
    init {
        title = if (existing != null) {
            KiloBundle.message("settings.providers.customEditTitle")
        } else {
            KiloBundle.message("settings.providers.customTitle")
        }
        setOKButtonText(
            if (existing != null) KiloBundle.message("settings.providers.customSave")
            else KiloBundle.message("settings.providers.customAdd"),
        )
        init()
        initValidation()
        existing?.let { prefill(it) }
        models.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                syncActions()
            }
        })
        pick.addActionListener {
            if (fetching) cancelFetch()
            else selectModels()
        }
        syncActions()
    }

    @RequiresEdt
    private fun prefill(edit: CustomProviderEdit) {
        id.text = edit.id
        id.isEditable = false
        name.text = edit.name
        url.text = edit.baseUrl
        env.text = edit.envVar.orEmpty()
        models.text = edit.models.joinToString(", ")
    }
```

Save-success branch in `doOKAction` (lines 767-769) — reset `saving`, re-enable OK, record id, close unconditionally:

```kotlin
                ProvidersSettingsUi.LOG.info("custom provider add: save succeeded id='${input.id}', closing dialog")
                outcome = result.state
                savedId = input.id
                saving = false
                syncActions()
                close(OK_EXIT_CODE)
```

Remove the now-unused `closeOk()` helper (line 966), or replace its body with `close(OK_EXIT_CODE)`; do not leave `super.doOKAction()` in the success path. `OK_EXIT_CODE` is a `DialogWrapper` constant available to the subclass without an import.

## Tests — `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/providers/ProvidersSettingsUiTest.kt`

Run against the real EDT/component tree with `FakeProviderRpcApi` (no mocks).

**Update existing tests broken by the new EDIT action / callback:**

- `content()` helper (line 965): change to `edt { ProvidersContent({}, {}, {}, {}, {}) }` (5 lambdas).
- `test configured custom provider exposes only disconnect` (lines 306-324): rename to reflect edit + disconnect and assert `assertEquals(listOf(ProviderListAction.EDIT, ProviderListAction.DISCONNECT), row.actions)`.
- `test source custom catalog providers remain visible while configured custom providers are connected` (line 412): change the `rows[0].actions` assertion to `listOf(ProviderListAction.EDIT, ProviderListAction.DISCONNECT)`.

**Add new tests:**

- Dialog closes on save success: reuse the `submit` + `flushUntil { edt { dialog.outcome != null } }` pattern; after success assert `dialog.savedId == "my-openai"` and `edt { dialog.isOKActionEnabled }` is `true` (proves the disabled-OK regression is fixed).
- Edit prefill: build `CustomProviderDialog(cs, "/tmp", { CustomModelFetchResultDto(listOf("gpt-4o")) }, { ProviderActionResultDto(...) }, CustomProviderEdit("my-openai", "My OpenAI", "https://example.com/v1", null, listOf("gpt-4o")))`. Assert the text fields (indices 0/1/2/4/5 for id/name/url/env/models) are populated, the key field (index 3) is blank, `id` field `isEditable == false`, and the OK button text equals `KiloBundle.message("settings.providers.customSave")`. (Field order via `filterIsInstance<JTextField>()`: 0=id, 1=name, 2=url, 3=key, 4=env, 5=models — `JBPasswordField` is a `JTextField`.)
- `providerActions` editable: given a provider with `config[id].npm == "@ai-sdk/openai-compatible"` and configured, assert `[EDIT, DISCONNECT]`, and that the EDIT cell has `primary == true` (via `row.cells.first { it.id == "EDIT" }.primary`).
- Non-editable connected provider unchanged: a connected non-custom provider (e.g. `anthropic`, connected) still yields `[DISCONNECT]`.
- Edit callback fires instead of disconnect on primary: construct `ProvidersContent` with recording lambdas (capture which provider each callback got), update with a configured editable provider, trigger the primary path, and assert the edit lambda ran and disconnect did not.
- Selection after update: `content.update(state, select = "local-openai")` then assert the list's selected row key is `"local-openai"`.

## Validation

Run from `packages/kilo-jetbrains/`:

- `bun run typecheck` (or `./gradlew typecheck`).
- `./gradlew test` (target `ProvidersSettingsUiTest` first if iterating).
- Manual smoke via `./gradlew runIde`: add a custom provider → dialog closes and the new row is selected; double-click the row → edit dialog opens prefilled with the id field locked and "Save" button; the connected custom row shows both Edit and Disconnect.

Java 21 is required for Gradle; only check `java -version` if a Gradle command fails with a Java error.

## Notes / risks

- API key is intentionally not prefilled on edit (secret). Blank key preserves the stored key; a new value updates it — matches `saveCustom` behavior.
- The id field is locked on edit because the id is the config key; renaming would create a second provider.
- Double-click on a visible action button (Edit/Disconnect) still routes through the single-cell click path, not `primary`; only double-clicks on the non-button row area trigger the primary (EDIT) action.
- Keep new identifiers single-word where clear (`existing`, `cfg`, `select`, `edit`, `prefill`, `savedId`).

## Out of scope

- Editing headers, per-model capabilities (reasoning), or config scope (global vs workspace) beyond the current add dialog.
- Any changes to shared `packages/opencode/` code, RPC contracts, or DTOs.
