# JetBrains Settings List Action Hit Targets

Fix inconsistent clicks on inline settings-list actions such as **Edit** in Agents and **Connect/OAuth/Disconnect** in Providers by making rendering and hit testing share one action-cell implementation.

## Current Findings

- Production Agents use `SettingsListView` + `SettingsListRenderer` from `settings/base/`.
- Production Providers also now use `SettingsListView` through `ProvidersContent`.
- `ProviderListRenderer` is no longer used by production code, but provider tests still depend on its provider-specific wrappers around shared hit-testing.
- The visible action label is rendered by private `SettingsListRenderer.CellLabel`, while click geometry is estimated separately in `SettingsListModel.settingsListCellWidth/settingsListCellHeight`.
- This split can make the sensitive area differ from the painted button area.
- `SettingsListView` already centralizes click dispatch through `settingsListCellAt`, so the fix should stay there and in shared base helpers, not in agents/providers.

## Implementation Plan

1. Add a shared action-cell component in `settings/base/`, for example `SettingsListActionCell`.
   - Use it from `SettingsListRenderer.syncCells(...)` instead of the private `CellLabel`.
   - Keep current visual behavior: text actions get `UiStyle.Components.actionLabel(...)`; icon-only actions keep their current icon-only appearance.
   - Provide a small shared sizing helper, for example `settingsListCellSize(list, cell)`, that builds/configures the same component with the list font and returns its preferred size.

2. Update shared hit testing in `SettingsListModel.kt`.
   - Make `settingsListCellBounds(...)` use the shared sizing helper rather than duplicating font/border math.
   - Keep right alignment and gap behavior the same.
   - Keep disabled-cell filtering in `settingsListCellAt(...)` so disabled env-provider disconnect remains visible but not actionable.
   - For icon-only actions, preserve or slightly expand the clickable target so delete remains easy to click even if the icon has no visible button border.

3. Make action-click dispatch fully shared and button-like in `SettingsListView.kt`.
   - Track the action cell resolved on `mousePressed` using `settingsListCellAt(...)`.
   - On `mouseReleased`, invoke only when the same row/cell is still under the pointer and enabled.
   - This makes the whole shared action-cell rectangle clickable and avoids inconsistent press/release behavior.
   - Keep double-click-to-primary-row behavior, but ignore double-clicks that start on an action cell.
   - Preserve the existing uncommitted double-click change already in this file.

4. Remove provider-specific action hit-test/render wrappers.
   - Delete `settings/providers/ProviderListRenderer.kt` if production remains free of references.
   - Keep provider domain mapping in `ProviderListRows.kt` (`ProviderListAction`, labels, enabled rules, `alwaysVisible`).
   - Keep `ProvidersContent.activate(...)` as the only provider-specific action dispatcher.

5. Update tests to target shared behavior.
   - Move action-bounds/action-at assertions from `ProvidersSettingsUiTest` to generic `SettingsListViewTest` or shared helper tests.
   - Add coverage that clicking near the edges of the rendered action bounds invokes the action.
   - Add coverage that disabled cells do not invoke actions.
   - Add coverage that always-visible provider disconnect remains hit-testable while unselected.
   - Update provider renderer tests to instantiate `SettingsListRenderer` directly where they verify labels, icon visibility, descriptions, foregrounds, and painting.
   - Remove remaining `ProviderListRenderer` imports/usages.

6. Add a patch changeset for the user-facing JetBrains settings bug fix.
   - Suggested file: `.changeset/jetbrains-settings-action-clicks.md`.
   - Suggested text: `Make JetBrains settings list actions easier and more reliable to click.`

## Files To Change

- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/base/SettingsListRenderer.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/base/SettingsListModel.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/base/SettingsListView.kt`
- `packages/kilo-jetbrains/frontend/src/main/kotlin/ai/kilocode/client/settings/providers/ProviderListRenderer.kt` (delete if unused)
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/base/SettingsListViewTest.kt`
- `packages/kilo-jetbrains/frontend/src/test/kotlin/ai/kilocode/client/settings/providers/ProvidersSettingsUiTest.kt`
- `.changeset/jetbrains-settings-action-clicks.md`

## Validation

Run from `packages/kilo-jetbrains/`:

- `./gradlew :frontend:test --tests ai.kilocode.client.settings.base.SettingsListViewTest --tests ai.kilocode.client.settings.providers.ProvidersSettingsUiTest`
- `./gradlew typecheck`

## Notes

- Do not touch unrelated untracked `.kilo/plans/*` files.
- Preserve the current uncommitted agent edit dialog polish and existing `SettingsListView` double-click behavior while modifying shared click handling.
- All touched source paths are Kilo-owned JetBrains files; no `kilocode_change` markers are needed.
