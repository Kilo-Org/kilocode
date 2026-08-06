# Consolidate JetBrains model pickers into a shared PickerPopup base

## Goal

Remove duplication between the two list-picker popups in the JetBrains frontend by
extracting a generic base, and make both consume it:

1. Prompt model picker — `session/ui/model/ModelPicker.kt` (`showPopup`) — single-select
   commit, search field, expand/collapse details panel, sections, per-row favorite (star)
   toggle.
2. Custom provider model picker — `settings/providers/ProvidersSettingsUi.kt`
   (`showModelPopup` inside `CustomProviderDialog`) — multi-select toggle, no search, no
   details, selection stored in the `models` text field.

The base must expose configurable options; the provider picker enables: multi-select, no
expanded/details view, and extra header toolbar buttons ("Select All" / "Deselect All").

All work is under `packages/kilo-jetbrains/frontend/`. No backend/RPC/DTO changes. Files are
Kilo-owned (no `kilocode_change` markers).

## Resolved decisions

- **Approach**: Extract a generic `PickerPopup<T>` base; both pickers become thin configs.
- **Selection state**: Caller owns it. Base is selection-stateless: it calls `checked(row)`
  to render check state and `onPrimary(row)` on activation. Provider keeps the `models` text
  field as source of truth; prompt keeps its favorites callbacks.
- **Select All / Deselect All**: Two caller-supplied header toolbar buttons. Remove the
  in-list `CustomModelRow.selectAll` row entirely.
- **Renderer**: Extract a base renderer skeleton too; `ModelPickerRenderer` and the provider
  renderer extend it. Generalize the favorite hit-zone into a trailing click-zone helper.
- **Location**: New package `ai/kilocode/client/ui/picker/` with `PickerPopup<T>` and
  `PickerListRenderer<T>`. `PickerRow` and `ModelSearch` stay where they are and are reused.

## Base design

### `ui/picker/PickerPopup.kt` — generic popup

Owns: `JBList<T>` + `CollectionListModel<T>`, `createComponentPopupBuilder` with the shared
flags (requestFocus/focusable/cancelOnClickOutside/cancelKeyEnabled/cancelOnWindowDeactivation/
locateWithinScreenBounds, non-resizable, non-movable), `popupBackground` helper (move the
duplicated `NewUI -> Popup.BACKGROUND else getListBackground()` here), header assembly,
mouse hit-testing, keyboard bindings, auto-select-on-move + scrolling install, and size
computation.

Config (constructor params / vars, defaults match current behavior):

- `anchor: JComponent`, `placement: Placement` (`ABOVE` / `BELOW` / `UNDERNEATH`). Prompt uses
  `PopupShowOptions.aboveComponent` / `showUnderneathOf`; provider uses `showUnderneathOf(pick)`.
- `rows: (query: String) -> List<T>` — rebuilt when the search text changes. Provider passes a
  function that ignores `query`.
- `renderer: PickerListRenderer<T>`.
- `checked: (T) -> Boolean` — drives the row check icon (single: `row.key == active`; multi:
  `isSelected(row)`).
- `sectionTitle: (rows: List<T>, index: Int) -> String?` — optional; prompt supplies
  `modelPickerSectionTitle`, provider passes `{ _, _ -> null }`.
- `mode: Mode` = `Single` | `Multi`.
  - Single: on primary click/ENTER call `onPrimary(row)` then `popup.closeOk(null)`.
  - Multi: on primary click/SPACE/ENTER call `onPrimary(row)`, repaint, stay open.
- `onPrimary: (T) -> Unit`. (Prompt decides activate-vs-clear inside based on `row.item == null`;
  provider toggles membership in the text field.)
- Optional trailing toggle: `trailingHit: (list, bounds, point) -> Boolean` and
  `onTrailing: (T) -> Unit`. Prompt supplies favorite hit-zone + favorite toggle; provider omits.
  Keyboard: in Single mode `Shift+SPACE` triggers trailing when present.
- `search: Boolean` — show `SearchTextField` in header CENTER. Prompt true; provider false.
- `toolbar: List<JComponent>` — extra header buttons placed in header WEST. Provider passes
  Select All / Deselect All; prompt passes empty.
- Optional details/expand: `details: JComponent?` + `onPreview: (T?) -> Unit` +
  `expandStateKey: String?`. When non-null, base shows the expand `HoverIcon`, EAST details
  panel, persists expanded state via `PropertiesComponent`, reserves details width when
  expanded, and `Disposer.register(popup, details)` if `details is Disposable`. Provider passes
  null (no expand toggle, no details).
- Sizing: `minWidth`, `maxWidth`, `maxVisibleRows`, `emptyListHeight` (defaults = current
  ModelPicker constants 420/760/10/120). Provider passes `minWidth = 320` and a `maxWidth`
  that preserves today's look. Reuse the existing `computeInitialPopupSize` /
  `computeListPreferredWidth` / `computeListPreferredHeight` logic, moved into the base and
  parameterized by these constants + optional details width.

Header layout: `BorderLayout` with `toolbar` row WEST, `search` CENTER (empty when
`search=false`), expand `HoverIcon` EAST (only when details present). Preserve
`AbstractPopup.customizeSearchFieldLook` and background wiring.

Keyboard (registered on both the list and, when present, the search editor):

- `UP`/`DOWN` → move selection (search field only; list uses `ScrollingUtil`).
- `ENTER` → primary on selected row.
- `ESC` → `popup.cancel()`.
- Single + trailing present → `Shift+SPACE` → trailing on selected row.
- Multi → `SPACE` → primary (toggle) on selected row.

Mouse (`mouseReleased`, `UIUtil.isActionClick`): resolve row via `locationToIndex` +
`getCellBounds`/`contains`; if trailing present and `trailingHit` → `onTrailing` + consume;
else `onPrimary` (Single closes, Multi consumes + repaints).

### `ui/picker/PickerListRenderer.kt` — renderer skeleton

Abstract `ListCellRenderer<T>` base: `PickerRow` wrap + optional top `GroupHeaderSeparator`
(driven by `sectionTitle`) + `[check icon | content | trailing]` layout with the shared
transparent row + `UiStyle.Gap.md/lg/md/pad` insets. Provides:

- `check` icon column (`AllIcons.Actions.Checked` / `EmptyIcon`), set from `checked(row)`.
- protected `content: JComponent` slot and optional `trailing: JComponent` slot.
- section separator top panel wiring (`top`/`sep` from `ModelPickerRenderer`).
- a companion `trailingClickZone(list, bounds, point, width)` generalizing
  `ModelPickerRenderer.isFavoriteClick` (keep `FAVORITE_CLICK_AREA_WIDTH` behavior).

## Ordered implementation tasks

1. **Create `ui/picker/PickerListRenderer.kt`**: base renderer skeleton with check column,
   `PickerRow` wrap, top section separator, content/trailing slots, transparent row + insets,
   and the `trailingClickZone` helper (moved/generalized from `ModelPickerRenderer.isFavoriteClick`
   / `favoriteInset`).
2. **Create `ui/picker/PickerPopup.kt`**: generic popup per the design above, including the
   moved `popupBackground` helper and the sizing helpers (parameterized).
3. **Refactor `ModelPickerRenderer`** to extend `PickerListRenderer`: content = title
   (`SimpleColoredComponent`) + warn + free/BYOK badges + provider label; trailing = favorite
   star; check via `checked`. Keep existing internal test accessors (`starIcon`,
   `badgeVisible`, `badgeText`, `byokVisible`, `warningVisible`, `warningTooltip`) and the
   `DATA_COLLECTED`/`checked`/`empty` companion members so `ModelPickerTest` compiles unchanged.
4. **Refactor `ModelPicker.showPopup`** to build a `PickerPopup<ModelPickerRow>` configured
   as: Single mode; `rows = { q -> modelPickerRows(items, favorites(), q, allowEmpty, emptyText, includeSmall) }`;
   `checked = { it.key == selected?.key }`; `sectionTitle = ::modelPickerSectionTitle`;
   `onPrimary = { row -> row.item?.let(::activate) ?: clear() }`; trailing = favorite hit-zone +
   `onFavoriteToggle`; `search = true`; details = `ModelDetailsPanel` with `expandStateKey =
   MODEL_PICKER_EXPANDED_KEY`; placement from `placement`; sizing constants = current values.
   Keep `ModelPicker`'s public API (`setItems`, `select`, `clearSelection`, `open`, callbacks,
   `Placement`, `Item`) and test hooks (`selectedForTest`, `selectionKeyForTest`,
   `expandedForTest`) unchanged so `PromptPanel`, `settings/models`, and `settings/agents`
   consumers are unaffected.
5. **Add provider picker renderer** (small subclass of `PickerListRenderer<String>` in
   `settings/providers/`, or a shared simple text renderer): content = a `JBLabel` showing the
   model id; no trailing; check via `checked`.
6. **Rewrite `CustomProviderDialog.showModelPopup(ids)`** to build a `PickerPopup<String>`:
   Multi mode; `rows = { _ -> ids }` (raw model ids, no select-all row); `checked = { it in modelIds().toSet() }`;
   `onPrimary = { toggleModel(it) }`; `sectionTitle = { _, _ -> null }`; `search = false`;
   `toolbar = listOf(selectAllButton, deselectAllButton)`; details = null; `minWidth = 320`;
   anchor = `pick`, placement `UNDERNEATH`.
7. **Extract provider selection mutations into testable helpers** on/near `CustomProviderDialog`
   operating on the `models` text field: `toggleModel(id)`, `selectAllModels(ids)`,
   `clearModels()` (reuse existing `modelIds()` / `setModelIds()`). Wire the two toolbar buttons
   to `selectAllModels(ids)` and `clearModels()`.
8. **Remove dead code**: `CustomModelRow`, `customModelRows`, `CustomModelRowRenderer`,
   `CUSTOM_MODEL_POPUP_MIN_WIDTH`/`CUSTOM_MODEL_POPUP_MAX_ROWS` (fold into base config), and the
   now-duplicated inline `popupBackground` in `ProvidersSettingsUi.kt`.
9. **Strings**: add a "Deselect All" key to `KiloBundle.properties` (e.g.
   `settings.providers.customModelsDeselectAll=Deselect All`); reuse existing
   `settings.providers.customModelsSelectAll` for "Select All".

## Tests

- **Keep passing unchanged**: `ModelPickerTest.kt` (row builder + renderer + `ModelSearch` +
  favorite hit-zone). Because `ModelPickerRenderer` keeps its accessors and companion members and
  `modelPickerRows`/`ModelPickerRow` are untouched, these should compile and pass as-is. Verify
  the favorite hit-zone tests still reference a working symbol (either keep
  `ModelPickerRenderer.isFavoriteClick` delegating to `PickerListRenderer.trailingClickZone`, or
  update the 3 call sites in `ModelPickerTest.kt` to the new helper).
- **Update** `ProvidersSettingsUiTest.kt`:
  - Replace `test custom model rows start with select all` (there is no select-all row anymore)
    with tests for the extracted helpers: `toggleModel` adds/removes an id in the text field;
    `selectAllModels(ids)` sets all; `clearModels()` empties it.
  - Keep existing add/edit/delete and dialog-close tests working.
- **New**: a small `PickerListRenderer`/`PickerPopup` unit test where feasible without a live
  popup — e.g. `trailingClickZone` geometry (mirroring the current `isFavoriteClick` tests) and
  the provider text renderer check-state. Avoid asserting live-popup internals; follow the
  existing pattern of testing renderers/row-builders/pure helpers directly (per package AGENTS
  "test the real implementation, no mocks").

## Validation

From `packages/kilo-jetbrains/`:

- `./gradlew typecheck`
- `./gradlew test` (iterate with `--tests ai.kilocode.client.session.ui.model.ModelPickerTest`
  and `--tests ai.kilocode.client.settings.providers.ProvidersSettingsUiTest`).
- Manual smoke via `./gradlew runIde`:
  - Prompt model picker: search, arrow/enter select, favorite star toggle, expand/collapse
    details, placement — all unchanged.
  - Add custom provider → fetch models → popup shows model list with "Select All"/"Deselect All"
    toolbar buttons, per-row multi-select toggles, no details/expand, selection reflected in the
    Model IDs field; Save persists selected models.

## Risks / notes

- `ModelPicker`'s public API and test hooks must stay stable — several settings screens depend on
  it. Only the popup internals move.
- The details/expand panel is `Disposable`; the base must register it with the popup exactly as
  today to avoid leaks.
- Sizing differs (prompt 420/760 dynamic + details; provider fixed 320). Parameterize rather than
  hard-code; keep provider width visually equivalent to current.
- Popups are hard to unit test; keep coverage on pure helpers/renderers, not live-popup behavior.
- Keyboard/mouse semantics differ by mode (single-commit-close vs multi-toggle-stay-open) and by
  presence of a trailing toggle — encode these in the base mode, don't special-case callers.

## Out of scope

- The other picker popups (`ModePicker`, `ReasoningPicker`, `SessionAccountOverlay`) — not part
  of this consolidation.
- Adding search to the provider picker (kept off to match current behavior; base supports it).
- Any backend/RPC/DTO or CLI changes.
