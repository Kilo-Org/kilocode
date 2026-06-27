# JetBrains Agents Layout Adjustments

## Goal
Update the JetBrains Agents settings list layout to match the requested visual behavior without wiring edit/import/create/delete handlers yet.

## Scope
- Package: `packages/kilo-jetbrains/`.
- UI only, plus focused tests.
- Do not change VS Code sources.
- Preserve Swing-only implementation, theme-derived colors, `JBUI`/`UiStyle` spacing, and EDT requirements from `packages/kilo-jetbrains/AGENTS.md`.

## Implementation Plan
1. Adjust neutral badge styling to match VS Code's subtle badge intent.
   - Update `UiStyle.Colors.badgeBg()` so neutral badges do not use the platform blue `Badge.background` when available.
   - Use a subtle theme-derived background comparable to VS Code's `bg-subtle-base` fallback behavior.
   - Keep neutral badge text on `UiStyle.Colors.weak()` or equivalent theme-derived weak foreground.
   - Keep warning badges for deprecated agents unchanged.

2. Lower-case badge labels.
   - Update `KiloBundle.properties` badge strings to lower-case: `custom`, `hidden`, `deprecated`, `subagent`, and any currently defined badge labels such as `built-in` and provider `env`.
   - Keep all user-visible labels localized through bundle keys.

3. Remove the Agents toolbar remove action.
   - Delete the `AgentsSettingsUi.trailingActions()` override.
   - Remove the Agents toolbar `Remove` action helper and its selected-row enablement logic.
   - Keep the shared `SettingsListPanel.trailingActions()` hook only if another current or near-term consumer still needs it; otherwise prune it to avoid an unused abstraction.

4. Update the `+` popup labels.
   - Keep the toolbar `+` as a popup action group with no handlers.
   - Change popup child labels to `New Agent...` and `Import Agent...`.
   - Prefer the order requested by the user: `New Agent...`, then `Import Agent...`.
   - Keep action bodies as no-ops.

5. Add list-element buttons for Agents using the provider-style cell mechanism.
   - Reuse `SettingsListItem.cells` so buttons appear on the selected row like provider list actions.
   - Add an `edit` text cell for each agent row.
   - Add a delete icon cell only for custom/removable agents.
   - Do not implement any edit/delete behavior yet; `onCell` should ignore these cells or no-op.
   - Remove the old row-level removal behavior from Agents if any remains.

6. Extend shared list cells to support icon-only cells.
   - Add optional icon support to `SettingsListCell` with defaults that leave provider text cells unchanged.
   - Render icon-only cells as the same styled action cell chrome used by provider actions.
   - Use `AllIcons.Actions.GC`, matching existing JetBrains history delete UI.
   - Keep the text label as accessibility/tooltip text for the icon-only delete cell.
   - Update hit testing width calculation to account for icon-only and icon-plus-text cells.

7. Update focused tests.
   - Update `AgentsSettingsUiTest` toolbar expectations to `Add agent`/`Refresh` plus the right-side default picker, with no toolbar `Remove`.
   - Update popup expectations to `New Agent...` and `Import Agent...`, and assert no side effects.
   - Replace the toolbar remove behavior test with selected-row cell layout assertions: native row has `edit`, custom row has `edit` plus delete icon.
   - Assert clicking/triggering edit/delete cells does not call removal or config patch APIs yet.
   - Update badge assertions to lower-case strings and confirm primary remains omitted.
   - Keep provider tests passing to protect shared cell rendering changes.

## Validation
Run from `packages/kilo-jetbrains/`:
- `./gradlew :frontend:test --tests ai.kilocode.client.settings.agentbehavior.AgentsSettingsUiTest`
- `./gradlew :frontend:test --tests ai.kilocode.client.settings.providers.ProvidersSettingsUiTest`
- `./gradlew typecheck`
- `./gradlew test`

## Notes
- This is layout-only for Agents edit/delete/import/create. No dialogs, config patches, RPC calls, or deletion confirmation should be added in this pass.
- Shared renderer changes must be backward-compatible for Providers, Rules, Skills, and Workflows.
