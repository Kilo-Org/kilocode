# Plan: Fix silent failure when adding a Custom OpenAI-Compatible Provider (JetBrains)

## Problem

In the JetBrains plugin, adding a "Custom OpenAI-Compatible Provider" can silently
fail: the dialog closes with no error, the provider never appears in the list, and
the user's typed inputs are gone. Reported against plugin 7.0.2.

## Root causes

1. **Zero-model providers are silently dropped by the CLI.** The dialog only
   requires `id` and `baseUrl`; the models field is optional
   (`ProvidersSettingsUi.kt:585` `doValidate`). The save really does write a
   `provider.<id>` block to config, but when the UI re-reads the provider list the
   CLI deletes any provider with no models
   (`packages/opencode/src/provider/provider.ts:1667`), and
   `@ai-sdk/openai-compatible` has no automatic model discovery. The provider is on
   disk but never rendered.

2. **Errors are surfaced after the dialog is already closed.** `custom()`
   (`ProvidersSettingsUi.kt:216-227`) calls `dialog.showAndGet()` (which closes the
   dialog), *then* runs the save and routes any error to the settings-panel overlay
   behind the closed dialog via `apply()`. On success with a dropped provider,
   `saveCustom` returns `error = null`, so even that overlay stays silent. Either
   way the typed inputs are lost and the user cannot correct and retry.

## Goal

When saving a custom provider fails or the saved provider would not be usable, show
the message **inside the dialog**, keep the dialog open with all inputs intact, and
let the user fix and retry without re-typing. Prevent the zero-model silent-drop
path entirely.

## Design

Move the save into the dialog so it runs **before** the dialog closes:

- The dialog owns the save. It runs the RPC on the frontend coroutine scope, keeps
  itself open on failure, and shows the error via `setErrorText(...)`. It only
  closes on a verified success.
- The settings panel consumes the final `ProviderSettingsDto` the dialog produced,
  so there is no second save.
- Require at least one model client-side and server-side, closing the zero-model
  drop path. Keep a post-save verification as a safety net for other silent drops.

RPC must never run on the EDT (`doOKAction` runs on EDT). The dialog launches on the
existing `cs` scope and switches back to the EDT with `ModalityState.any()` for UI
updates, matching the `edt` dispatcher already defined at
`ProvidersSettingsUi.kt:72`.

## Changes

### 1. `frontend/.../settings/providers/ProvidersSettingsUi.kt`

**`CustomProviderDialog` (currently `ProvidersSettingsUi.kt:542-590`)**

- Change the constructor to accept what it needs to save and report progress:
  `CustomProviderDialog(cs: CoroutineScope, directory: String, save: suspend (CustomProviderSaveDto) -> ProviderActionResultDto)`.
  Pass `save = { service<KiloProviderService>().saveCustom(it) }` from `custom()` so
  the existing workspace-reload + profile-refresh side effects in
  `KiloProviderService.action` still run.
- Add a `var outcome: ProviderSettingsDto? = null` the panel reads after a
  successful close, and a `saving` guard to block double-submit (Enter while
  in-flight).
- Extend `doValidate()` to require at least one model:
  ```kotlin
  if (models.text.split(',').none { it.isNotBlank() })
      return ValidationInfo(KiloBundle.message("settings.providers.customModelsRequired"), models)
  ```
- Override `doOKAction()` instead of letting the platform close on OK:
  - Return early if `saving`. Run `doValidate()`; if non-null, let the platform show
    it (do not close).
  - Set `saving = true`, disable the OK action (`isOKActionEnabled = false`), clear
    any previous error text.
  - `cs.launch { val result = save(input(directory)); withContext(edt) { ... } }`.
  - On the EDT, compute the inline error text (see helper below). If there is an
    error: `setErrorText(text)`, `isOKActionEnabled = true`, `saving = false`, keep
    the dialog open. If success: store `outcome = result.state`, then
    `super.doOKAction()` to close.
  - Wrap the RPC in the same `try/catch` shape as `launch()`
    (`ProvidersSettingsUi.kt:264-297`): map `TimeoutCancellationException` and
    generic `Exception` to inline error text, rethrow `CancellationException`. No
    empty catch blocks.

**Inline error helper (pure, testable)**

Add a top-level `internal fun customSaveError(id: String, result: ProviderActionResultDto): String?`:
```kotlin
result.error?.let { return it }
val present = result.state.providers.any { it.id == id }
if (!present) return KiloBundle.message("settings.providers.customNotUsable")
return null
```
This is the safety net: even if validation passes, a provider that came back only in
`config` but not in `providers` (the zero-model drop or an unreachable base URL)
produces an inline message rather than a silent close.

**`custom()` (`ProvidersSettingsUi.kt:216-227`)**

Simplify to construct the dialog with the save lambda, and after a successful close
apply the dialog's `outcome` to the panel (update `state`, `view.update(next)`,
`clearProgress()`), reusing the tail of `apply()`. The save no longer goes through
`launch()`, which also removes the `busy`-gated silent `return` at
`ProvidersSettingsUi.kt:222`/`266`.

### 2. `backend/.../provider/KiloBackendProviderSettingsManager.kt`

Extend `validate()` (`:279-287`) to reject empty models so the API is safe even when
called outside the JetBrains dialog:
```kotlin
if (input.models.isEmpty()) return "At least one model ID is required."
```
This runs before any `patch`, so nothing is written to config on the empty-models
path. No change needed to `buildCustomProviderPatch`.

### 3. `frontend/.../resources/messages/KiloBundle.properties`

Add message keys near the existing custom-provider strings (`:470-477`):
```
settings.providers.customModelsRequired=Add at least one model ID.
settings.providers.customNotUsable=Provider saved but has no usable models. Check the Base URL, API key, and model IDs, then try again.
```

## Tests

Follow the JetBrains settings test pattern (fake-RPC frontend test + MockCliServer
backend test). Do not mock the EDT or add test-only accessors.

### Backend — `backend/.../provider/KiloBackendProviderSettingsManagerTest.kt`

- `saveCustom` with empty `models` returns a non-null `error` and issues **no**
  `PATCH /global/config` (assert against `MockCliServer` recorded requests).
- `saveCustom` with one model PATCHes the expected body, then a subsequent reload
  observes the provider in `state`.

### Frontend — `frontend/.../settings/providers/ProvidersSettingsUiTest.kt`

- Unit-test the pure `customSaveError` helper: returns `result.error` when set;
  returns the not-usable message when the saved id is absent from
  `state.providers`; returns `null` when present.
- Extend `FakeProviderRpcApi.saveCustom` (already records `custom`) so a test can
  drive a configured `ProviderActionResultDto` (with/without the provider present)
  and assert the panel applies the returned state on success.

## Verification

From `packages/kilo-jetbrains/`:
- `./gradlew typecheck`
- `./gradlew test`

## Out of scope / follow-ups

- Wiring the already-implemented `fetchCustomModels` RPC
  (`KiloProviderService.fetchCustomModels`) into the dialog as a "Fetch models"
  button. This would improve UX further but is not required to fix the silent
  failure; track separately.
- Changing the CLI's zero-model drop in `packages/opencode/src/provider/provider.ts`
  is intentionally avoided — it is shared upstream code, and the fix above prevents
  the JetBrains client from ever reaching that path.
