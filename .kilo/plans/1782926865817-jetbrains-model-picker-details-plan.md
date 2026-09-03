# JetBrains Model Picker Details Plan

## Goal
Add a JetBrains model picker maximize/minimize affordance that expands the popup to roughly double width and shows model details comparable to VS Code's `ModelPreview`. Persist the last expanded/collapsed state in IntelliJ `PropertiesComponent`. First-time default is collapsed.

## Decisions
- Scope is full VS Code parity where JetBrains can receive the same model metadata: pricing, release date, descriptions, modalities/capabilities, terminal-bench, auto-routing details, context limits, badges, and provider/model identity.
- Default state is collapsed for users without a saved property.
- Expanded state is app-level UI state stored in `PropertiesComponent`, not backend/session state.
- Use Swing/IntelliJ platform components only. Do not introduce Compose, JCEF, or UI DSL.
- Keep existing compact list behavior when collapsed. In expanded mode, show a retained details panel beside the list.

## Affected Areas
- `packages/kilo-jetbrains/shared/src/main/kotlin/ai/kilocode/rpc/dto/ProviderDto.kt`
- `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/workspace/KiloWorkspaceState.kt`
- `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/cli/KiloCliDataParser.kt`
- `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/rpc/KiloWorkspaceDtoMapper.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/model/SessionModel.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/SessionUi.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/models/ModelsSettingsUi.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/session/ui/model/ModelPicker*.kt`
- `packages/kilo-jetbrains/frontend/src/main/resources/messages/KiloBundle*.properties`
- Existing tests under `packages/kilo-jetbrains/frontend/src/test/...` and `backend/src/test/...`

## Implementation Steps
1. Extend model metadata DTOs.
   - Add serializable nested DTOs to `ProviderDto.kt` for preview metadata matching VS Code provider types where practical: cost/cache cost, capabilities/input modalities, options/description, auto-routing model ids, terminal-bench score/cost.
   - Extend `ModelDto` with nullable fields such as `inputPrice`, `outputPrice`, `contextLength`, `releaseDate`, `latest`, `cost`, `capabilities`, `options`, `autoRouting`, and `terminalBench`.
   - Preserve existing fields (`limit`, `variants`, `free`, `byok`, `mayTrainOnYourPrompts`) to avoid breaking callers.

2. Parse and map the extra metadata in the JetBrains backend.
   - Extend `ModelInfo` in `KiloWorkspaceState.kt` with matching nullable metadata fields.
   - Update `KiloCliDataParser.parseModel` and `parseModelDto` to read the fields currently used by VS Code: `inputPrice`, `outputPrice`, `contextLength`, `releaseDate`, `latest`, `cost`, `capabilities.input`, `options.description`, `autoRouting.models`, and `terminalBench`.
   - Keep permissive parsing: missing or malformed optional fields should result in `null` or empty data, not provider load failure.
   - Update `KiloWorkspaceDtoMapper.model` to copy all new fields to `ModelDto`.

3. Carry metadata through the frontend session/settings model flow.
   - Extend session `ModelItem` and picker `ModelPicker.Item` to hold the preview metadata.
   - Update `SessionController` -> `SessionModel`, `SessionUi`, and `ModelsSettingsUi.items()` mappings so metadata survives into the picker.
   - Pass `limit` through to `ModelPicker.Item`; it is already available in `ModelItem` but currently dropped in `SessionUi`.

4. Add a retained Swing details panel.
   - Create a small `ModelDetailsPanel` near `session/ui/model/` or inside `ModelPicker.kt` if compact enough.
   - Use `JBLabel`, `SimpleColoredComponent`, `JBHtmlPane` or safe HTML helpers, `Stack`, and `JBUI` spacing.
   - Render VS Code-equivalent sections where data exists: header name/provider/star, free/BYOK/training badges, pricing, context window, release date, capabilities/modalities, terminal-bench, description, auto-routing candidates, and ids.
   - Sanitize/escape model descriptions. Use `HtmlChunk`/`HtmlBuilder` or platform escaping helpers; do not concatenate unescaped HTML.
   - Details panel should update from the currently previewed row in expanded mode and fall back to the active selected model when no preview row is set.

5. Rework popup layout and size behavior.
   - Add an expand/minimize button to the search/header row in `ModelPicker.showPopup()`.
   - Use pointer cursor on the button and localized tooltips/accessibility names: `Maximize model details` and `Minimize model details` or equivalent.
   - Persist state under a key such as `kilo.model.picker.expanded` using `PropertiesComponent.getInstance().getBoolean(key, false)` and `setValue(key, value.toString())`.
   - Collapsed mode keeps the current list-only width behavior.
   - Expanded mode lays out list and details side-by-side with a splitter/separator and sets preferred width to approximately double the collapsed width, clamped to available screen bounds. Keep `setLocateWithinScreenBounds(true)`.
   - Make `JBPopup` resizable only if the implementation can keep the retained layout stable; otherwise keep non-resizable and compute deterministic sizes.

6. Match VS Code interaction semantics where useful.
   - Collapsed mode: clicking a model selects it immediately, preserving current behavior.
   - Expanded mode: clicking/hovering or keyboard navigation updates the preview; Enter selects; double-click selects; Escape closes.
   - Favorite star behavior remains unchanged and updates the details panel favorite state when toggled.
   - When collapsing from expanded, clear transient preview state and show selected/active model on next expansion.

7. Add localization strings.
   - Add base `KiloBundle.properties` entries for maximize/minimize tooltips, detail labels, pricing labels, context, capabilities, terminal-bench, description, auto-routing choices, and unavailable values.
   - If existing localized files require key completeness, add English fallback values there too; otherwise rely on base bundle fallback consistent with project practice.

8. Add tests.
   - Backend parser tests: ensure all new metadata fields parse from representative provider JSON and missing optional fields are tolerated.
   - Mapper/serialization tests: ensure new DTO fields survive backend -> shared DTO serialization.
   - `ModelPickerTest`: verify expanded property default is collapsed, toggle persists true/false, tooltip/icon state switches maximize/minimize, expanded width is greater than collapsed width, preview panel displays selected/hovered model metadata, and pointer cursor is set on the expand control.
   - Renderer/details tests should exercise actual Swing components on the EDT using existing `BasePlatformTestCase` patterns.
   - Update existing tests/helpers that construct `ModelPicker.Item`, `ModelItem`, or `ModelDto` as needed using default values to keep changes minimal.

## Risks And Constraints
- Full parity depends on metadata already present in CLI provider JSON. If a field is absent from the backend response for a provider, the details panel should omit that row rather than showing placeholders everywhere.
- Adding fields to shared serializable DTOs affects split-mode RPC compatibility. Keep new fields nullable/defaulted for safe deserialization.
- Avoid making provider loading fragile: optional preview metadata parsing must not throw on unexpected types.
- The popup is a lightweight `JBPopup`; changing size after showing may require recreating/repacking carefully. Prefer computing expanded/collapsed preferred size before show and updating the content with `revalidate()`/`repaint()` on toggle.
- Keep all Swing mutation on the EDT.

## Validation
- From `packages/kilo-jetbrains/`: run `./gradlew typecheck` or `bun run typecheck`.
- From `packages/kilo-jetbrains/`: run targeted tests for backend parser/serialization and frontend model picker tests, or `./gradlew test` if targeted Gradle filters are not straightforward.
- Manually verify in sandbox if feasible: `./gradlew runIde`, open model picker, confirm first open is collapsed, maximize doubles width and shows details, minimize returns to compact width, tooltip/cursor are correct, and the last state persists after closing/reopening the popup.
