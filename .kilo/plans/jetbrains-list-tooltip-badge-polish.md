# JetBrains List Badge And Tooltip Polish

## Goal
Apply the requested visual polish to the JetBrains settings list implementation without adding any new action behavior.

## Scope
- Package: `packages/kilo-jetbrains/`.
- Affects shared list primitives plus Providers and Agents settings rows.
- No action implementation for Agents edit/delete/import/create.
- Follow `packages/kilo-jetbrains/AGENTS.md`: Swing only, theme-derived colors/icons, EDT-safe UI code, no Kotlin UI DSL.

## Implementation Plan
1. Remove provider `custom` badges.
   - Update `ProviderListRow.badges` so `provider.source == "custom"` no longer emits a badge.
   - Keep any existing non-custom provider badges that are intentional, such as `env`.
   - Add or update provider regression coverage to assert custom providers have no badges.

2. Keep/restore Agents `subagent` badge.
   - Confirm `AgentsSettingsUi.fetch()` emits `settings.agentBehavior.badge.subagent` for rows where `KiloCliParser.isSubagent(item.mode)` is true.
   - Keep the label lower-case `subagent` per the prior request.
   - Keep primary agents badge-free.
   - Update the focused Agents test so this is explicitly protected.

3. Capitalize the Agents row edit action.
   - Change `settings.agentBehavior.edit` from `edit` to `Edit`.
   - Keep the internal cell id as `edit`.
   - Update focused Agents tests to expect visible text `Edit`.

4. Make the Agents delete icon bare.
   - Keep the delete cell icon-only and layout-only.
   - Use the platform delete icon (`AllIcons.Actions.GC`) so light/dark variants follow the current IDE theme.
   - Do not draw the action-label background or border for icon-only delete cells.
   - Prefer a minimal shared cell flag such as `chromed: Boolean = true` or a renderer branch for `iconOnly` cells; leave provider text action cells unchanged.
   - Keep tooltip/accessibility text for the icon-only delete cell as `delete`.
   - Update Agents tests to assert the delete cell has the icon but no visible text and uses bare styling/no action-label background.

5. Disable IntelliJ expanded-row tooltip behavior for all shared settings lists.
   - In `SettingsListView`, call `list.setExpandableItemsEnabled(false)` on the shared `JBList`.
   - This removes the row-expanded hover rendering from all list-based settings pages using `SettingsListView`.

6. Add a regular formatted tooltip for list row descriptions.
   - Implement row tooltip behavior on the shared settings list only.
   - Override `getToolTipText(MouseEvent)` for the `JBList` in `SettingsListView`.
   - Resolve the hovered index with `locationToIndex`, verify the point is inside that row's bounds, and return `null` when no row or no description is present.
   - Format `SettingsListItem.description` as safe HTML so longer descriptions wrap/read cleanly rather than showing a raw one-line tooltip.
   - Escape description text before inserting it into HTML; preserve line breaks using `<br>` or an IntelliJ HTML helper.
   - Do not set tooltips on renderer row components; the list should own the regular tooltip.

7. Update tests.
   - Agents focused tests:
     - `Edit` visible text.
     - delete icon remains icon-only and bare.
     - `subagent` badge appears for subagents.
   - Provider focused tests:
     - custom provider rows have no `custom` badge.
   - Shared list tooltip test:
     - expandable row tooltips are disabled on the shared `JBList` if accessible through the public API.
     - hovering a row with a description returns formatted escaped HTML.
     - hovering a row without description or outside a row returns `null`.

## Validation
Run from `packages/kilo-jetbrains/`:
- `./gradlew :frontend:test --tests ai.kilocode.client.settings.agentbehavior.AgentsSettingsUiTest`
- `./gradlew :frontend:test --tests ai.kilocode.client.settings.providers.ProvidersSettingsUiTest`
- If shared tooltip behavior gets its own test class, run that focused test too.
- `./gradlew typecheck`
- `./gradlew test`

## Notes
- Do not edit VS Code files for this pass.
- Keep the provider list action cells visually unchanged.
- Keep Agents edit/delete cells layout-only; no dialogs, config patches, RPC calls, or deletion confirmation.
