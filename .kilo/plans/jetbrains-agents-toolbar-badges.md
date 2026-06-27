# JetBrains Agents settings toolbar and badges

Update the JetBrains **Agent Behavior → Agents** settings list so it matches the requested toolbar layout and VS Code badge behavior while keeping the implementation in the shared settings-list architecture.

All implementation paths are under `packages/kilo-jetbrains/`. This is Kilo-owned code, so no `kilocode_change` markers are needed.

## Goals

- Put the Agents toolbar on one horizontal row:
  - left: `+ | Refresh | -`
  - right: `Default Agent: <picker>`
- Make the right-side toolbar content a reusable optional feature of `SettingsListPanel`, not a one-off in `AgentsConfigurable`.
- Make `+` a popup action group with placeholder actions for **Import Agent** and **Create New Agent**, matching VS Code concepts but without implementing handlers in this pass.
- Move agent-mode/config string constants out of frontend UI code into shared CLI parsing/constants code.
- Match VS Code-style agent badge behavior:
  - do not render a `primary` badge
  - render `subagent` only for subagents
  - use the same subtle/warning badge color intent as VS Code
- Stop using the new `BadgeLabel` wrapper in the shared renderer; use `FilledBadgeIcon` directly.

## Current Findings

- `AgentsConfigurable.kt` currently returns a `headerExtras()` `SettingsRow` for the default-agent picker, so it appears below the toolbar instead of right-aligned in the toolbar.
- `SettingsListPanel.kt` currently builds a single left toolbar from `extraActions()` plus optional refresh; it has no right-side content hook and no way to put actions after Refresh.
- `AgentsConfigurable.kt` currently hardcodes `"subagent"` when filtering default-agent options and currently renders `SettingsBadge(item.mode)`, which displays `primary`.
- `KiloCliParser` already exists in `shared/src/main/kotlin/ai/kilocode/cli/KiloCliParser.kt`, so shared CLI constants can live there without adding a frontend-only constant holder.
- VS Code agent settings render `custom`, `subagent`, and `hidden` with subtle badge colors and `deprecated` with warning colors. They do not display a primary badge.
- `FilledBadgeIcon` already provides the pill renderer. The newly added `BadgeLabel` is just a wrapper around it.
- JetBrains currently has no agent create/import implementation. The requested `+` menu should therefore be UI-only placeholders for now.

## Implementation Plan

### 1. Extend `SettingsListPanel` toolbar composition

In `frontend/src/main/kotlin/ai/kilocode/client/settings/base/SettingsListPanel.kt`:

- Keep the existing header structure with toolbar first and search below.
- Add optional hooks for toolbar layout:
  - left actions before Refresh, defaulting to existing `extraActions()` behavior
  - actions after Refresh, defaulting to empty
  - right toolbar content, defaulting to `null`
- Build the toolbar row with a `BorderLayout` or equivalent Swing layout:
  - WEST: IntelliJ `ActionToolbar` for actions
  - EAST: optional right content
- Insert separators only when adjacent action groups exist, so Agents can render `+ | Refresh | -` while Rules can still render `Add | Refresh` and other pages remain unchanged.
- Preserve existing keyboard behavior for search Enter/Up/Down and existing refresh shortcut registration.
- Keep all Swing-touching methods annotated/guarded with `@RequiresEdt` and `checkEdt()`.

### 2. Expose selected row state for toolbar actions

In `SettingsListView.kt`:

- Add an EDT-only way to read the selected `SettingsListItem` or selected key.
- Add an optional selection listener or callback so a parent panel can request toolbar updates when selection changes.
- Keep selection preservation by key when lists reload or filter.

This enables an Agents `-` toolbar action that is disabled unless the selected row is removable.

### 3. Move Agents default picker into the toolbar right side

In `AgentsConfigurable.kt`:

- Replace `headerExtras()` with the new right-toolbar hook.
- Render a compact horizontal control: `Default Agent:` label plus `JComboBox<String>`.
- Keep existing draft/base behavior:
  - `modified()` remains `draft != base`
  - `applyDraft()` still writes `default_agent`
  - `resetDraft()` restores the picker
  - `afterApply()` repopulates picker options after reload
- Use shared CLI constants for the `default_agent` config key and agent-mode comparisons.

### 4. Add Agents left toolbar actions

In `AgentsConfigurable.kt`:

- Add a `+` popup `ActionGroup` with two child actions:
  - `Import Agent`
  - `Create New Agent`
- Do not implement import/create behavior in this pass. The child actions should be explicit placeholders with no config mutation, RPC call, file picker, or dialog flow.
- Add `Refresh` through the shared panel refresh hook.
- Add a `-` action after Refresh:
  - enabled only when the selected row is a custom/removable agent and the panel is not busy
  - invokes existing `KiloAgentBehaviorService.removeAgent(dir, key)` and reloads
- Remove Agents row-level `Remove` cells to avoid duplicate deletion affordances. Other list pages keep their selected-row remove cells.
- Add i18n keys for the add group and placeholder child actions.

### 5. Centralize CLI constants

In `shared/src/main/kotlin/ai/kilocode/cli/KiloCliParser.kt`:

- Add shared constants for agent modes:
  - `primary`
  - `subagent`
  - `all`
- Add a shared constant for the `default_agent` config key used by Agents settings.
- Add small helper predicates if they keep UI code free of literals, for example:
  - `isSubagent(mode)`
  - `defaultAgentCandidate(mode, hidden)`
- Update touched frontend code to use these constants/helpers instead of hardcoded mode/config strings.
- Do not move user-visible badge labels into these constants; those stay in `KiloBundle.properties`.

### 6. Update badge rendering and colors

In `SettingsListRenderer.kt` and `UiStyle.kt`:

- Replace `BadgeLabel` usage with direct `JBLabel` instances whose `icon` is a `FilledBadgeIcon`.
- Delete `BadgeLabel.kt` if no longer used.
- Adjust badge tone mapping to match VS Code intent:
  - neutral/subtle badges use theme-derived subtle badge background and weak/badge foreground
  - warning badges use theme-derived warning color for the badge surface and a readable contrast foreground
  - avoid raw color literals in runtime UI code
- Keep the renderer test accessors by reading `FilledBadgeIcon.text` from label icons.

In `AgentsConfigurable.kt`:

- Replace `SettingsBadge(item.mode)` with mode-specific logic:
  - add localized `Subagent` badge only when the agent mode is shared `subagent`
  - never add `Primary` for `primary`
  - do not add a badge for `all` unless explicitly requested later
- Use neutral/subtle tone for `Custom`, `Hidden`, and `Subagent` to match VS Code.
- Use warning tone for `Deprecated`.
- Add `settings.agentBehavior.badge.subagent=Subagent` to `KiloBundle.properties`.

### 7. Tests

Add focused tests under `frontend/src/test/kotlin/ai/kilocode/client/settings/agentbehavior/`:

- Add `FakeAgentBehaviorRpcApi` in `client/testing` if needed, mirroring the existing provider/app fake pattern.
- Add `AgentsSettingsUiTest` covering:
  - toolbar has add group, refresh, and remove on the left
  - default-agent label/picker is in right toolbar content, not below the toolbar
  - add group exposes `Import Agent` and `Create New Agent` placeholder actions
  - placeholder add/import actions do not mutate config or call agent RPC
  - remove toolbar action is disabled for native agents and enabled for custom selected agents
  - remove action calls `removeAgent` and reloads
  - primary agents do not render a `primary` badge
  - subagent agents render only the localized `Subagent` mode badge
  - custom/hidden/deprecated badges remain present with expected labels
- Update any renderer test helpers affected by removing `BadgeLabel`.

### 8. Verification

Run from `packages/kilo-jetbrains/`:

- `./gradlew :frontend:test --tests ai.kilocode.client.settings.agentbehavior.AgentsSettingsUiTest`
- `./gradlew :frontend:test --tests ai.kilocode.client.settings.providers.ProvidersSettingsUiTest`
- `./gradlew typecheck`
- `./gradlew test`

## Non-Goals

- Do not implement real agent import behavior.
- Do not implement real custom agent creation/editing behavior.
- Do not change MCP settings.
- Do not change Providers behavior beyond whatever shared renderer updates require.
- Do not modify unrelated dirty worktree files except where the implementation directly touches them.

## Risks

- Toolbar action updates may not refresh automatically after list selection changes; mitigate by wiring a selection callback and explicitly updating the toolbar presentation.
- Badge color changes are shared renderer behavior, so provider/skills/workflow badge snapshots or tests may need small expectation updates.
- Empty add/import actions can look functional even though they are placeholders; mitigate with clear i18n labels and no side effects, matching the requested scope.
