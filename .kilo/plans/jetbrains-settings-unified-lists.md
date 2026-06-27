# JetBrains settings — unified list architecture (agents / rules / skills / workflows + providers)

Make the **Agents**, **Rules**, **Skills**, and **Workflows** settings pages render as real
`JBList`-based lists like the **Providers** page, with a filter field, a refresh toolbar, inline
remove buttons that appear only on the selected row, and theme-aware badge pills. Extract the
shared list machinery into common classes and **adopt them in Providers too** so there is one
list implementation, not two.

This is an architecture-first pass: **no new create/edit** of agents/rules/skills/workflows.
Existing config controls are handled per the decisions below.

All paths are under `packages/kilo-jetbrains/`. Everything here is Kilo-owned (no `kilocode_change`
markers needed).

---

## Decisions (from clarification)

1. **Edit controls:** keep simple config controls (Agents *default-agent* combo, Rules *Claude Code
   compat* toggle) in a header area; **drop the string add-editors** for skill paths / skill URLs
   (those become remove-only lists). **Rules instructions keep an Add affordance** (toolbar `+`).
2. **Rules page:** convert config `instructions` into the unified list with remove-on-select, and
   **retain Add** (no discovered "rules" exist in the CLI — rules are purely `config.instructions`).
3. **Providers:** extract shared classes and **refactor Providers onto them too** (max dedup).
   Provider-specific behavior (OAuth, dialogs, custom-provider, section bucketing, connected-row
   action rules) must be preserved; provider tests are updated to the shared APIs.

Deliberate interim UX: skill **paths/urls** become remove-only (you can remove, not add) until the
edit story is rebuilt. This is intentional per decision 1.

---

## Current state (reference)

- **Providers** (`settings/providers/`) already uses the target pattern:
  `JBList` + `CollectionListModel<ProviderListRow>` + custom `ProviderListRenderer` (panel renderer
  with `SimpleColoredComponent` title, inline action labels, hit-testing) + `ActionToolbar`
  (Add/Refresh `DumbAwareAction`) + `SearchTextField` filter + request-guarded async load with a
  loading/error overlay (`SettingsPanel`/`SettingsOverlayPanel`). Inline actions are shown only when
  the row is selected, except a connected row keeps **Disconnect** visible (`visibleActions`).
- **Agents/Rules/Skills/Workflows** (`settings/agentbehavior/`) use `BaseContentPanel` + `SettingsRow`
  + always-visible `JButton` removes, no filter, no toolbar, no badges.
- **Badges**: `FilledBadgeIcon` (`client/ui/FilledBadgeIcon.kt`) draws a rounded pill; the model
  picker and history list each wrap it in a private `BadgeLabel`. Colors come from `UiStyle.Colors`
  badge tokens.
- **Data** (`KiloAgentBehaviorService` → `KiloAgentBehaviorRpcApi`):
  - Agents `AgentDetailDto`: `name, displayName, description, mode (subagent|primary|all), native,
    hidden, deprecated`. Custom = `native != true`; remove only for custom (`removeAgent`).
  - Skills `SkillDto`: `name, description, location`. Built-in = `location == "builtin"`; remove only
    for custom (`removeSkill`).
  - Workflows `CommandDto`: `name, description, source (command|mcp|skill), template`. Read-only.
  - Rules: `config.instructions: List<String>` + `claudeCodeCompat()` toggle. No discovered list.
- **MCP** (`McpConfigurable`) is a sibling list but **out of scope** here (not requested).

---

## Shared classes to extract

New common code in `frontend/.../settings/base/` (UI tokens in `client/ui/`).

### 1. Render model — `settings/base/SettingsListModel.kt`

```kotlin
enum class SettingsBadgeTone { NEUTRAL, ACCENT, WARNING }
data class SettingsBadge(val text: String, val tone: SettingsBadgeTone = SettingsBadgeTone.NEUTRAL)

// one inline action button drawn in the renderer (e.g. "Remove", "Connect")
data class SettingsListCell(
    val id: String,
    val label: String,
    val enabled: Boolean = true,
    val alwaysVisible: Boolean = false,   // visible even when the row is not selected
)

interface SettingsListItem {
    val key: String
    val title: String
    val description: String? get() = null
    val icon: Icon? get() = null
    val section: String? get() = null
    val badges: List<SettingsBadge> get() = emptyList()
    val cells: List<SettingsListCell> get() = emptyList()
    val disabled: Boolean get() = false
}
```

Top-level helpers generalized from `ProviderListRenderer` companion + `ProviderListRows`:

- `settingsListSectionTitle(items, index): String?` — section caption when the section changes.
- `settingsListVisibleCells(item, selected): List<SettingsListCell>` — `disabled → empty`, else
  `cells.filter { selected || it.alwaysVisible }`. This single rule covers both the generic
  "remove only when selected" requirement and the provider "connected keeps Disconnect"
  (`alwaysVisible = true` on that cell).
- `settingsListCellBounds(list, bounds, item, selected): Map<String, Rectangle>` and
  `settingsListCellAt(list, bounds, point, item, selected): String?` — geometry + hit-testing
  (returns the cell id only when `cell.enabled`), ported from `ProviderListRenderer`.

### 2. `client/ui/BadgeLabel.kt` (shared)

Promote the model picker's private `BadgeLabel` to a shared class next to `FilledBadgeIcon`:

```kotlin
internal class BadgeLabel : JBLabel() {
    init { border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap()) }
    fun set(text: String?, bg: Color, fg: Color) {
        isVisible = text != null
        icon = text?.let { FilledBadgeIcon(it, bg, fg) }
    }
}
```

`ModelPickerRenderer` and `HistoryListRenderer` may later drop their private copies in favor of this
(optional cleanup; not required for the feature).

### 3. `settings/base/SettingsListRenderer.kt`

`JPanel(BorderLayout), ListCellRenderer<SettingsListItem>` — the generic version of
`ProviderListRenderer`:

- `GroupHeaderSeparator` top (caption from `settingsListSectionTitle`, hide line at index 0).
- Left icon (`JBLabel`, hidden when `icon == null`).
- Title `SimpleColoredComponent` (bold, `UIUtil.getListForeground(selected, focus)`).
- Badges: a horizontal `Stack` of `BadgeLabel`s rebuilt per row from `item.badges` (tone → colors:
  `NEUTRAL → Colors.badgeBg/badgeFg`, `ACCENT → Colors.activityBadgeBg/activityBadgeFg`,
  `WARNING → Colors.warningLabelForeground`-derived). Title + badges share a head row; description
  sits below.
- Description `JBLabel` (weak, hidden when blank).
- Cells: right-aligned horizontal `Stack` of action labels via `settingsListVisibleCells`, styled
  with `UiStyle.Components.actionLabel`.
- `PickerRow` selection wrapper + `UiStyle.Components.transparent(...)` (same as providers/model
  picker).
- Test accessors: `cellTexts()`, `badgeTexts()`, `descriptionText()`, `iconVisible()`, `iconSize()`.

### 4. `settings/base/SettingsListView.kt`

`BaseContentPanel` holding the list (generalized `ProvidersContent`):

- `JBList<SettingsListItem>` + `CollectionListModel` + `SettingsListRenderer`.
- Mouse hit-testing via `settingsListCellAt` → `onCell(key, cellId)`; Enter triggers the first
  visible cell of the selected row; `ScrollingUtil.installActions`.
- `update(items)`, `filter(query)` (client-side via `ModelSearch.matches(query, title)`),
  `setBusy(b)` (disables the list; renderer drops cells while `!list.isEnabled`), `move(step)`,
  `primary()`, selection preserved by `key`, configurable `emptyText`.

### 5. `settings/base/SettingsListPanel.kt`

`SettingsPanel(), Disposable` — the generic page shell (generalized `ProvidersSettingsUi` minus
OAuth/dialogs):

- Header (`content` NORTH): an `ActionToolbar` (optional `Refresh` + `extraActions()`), an optional
  `headerExtras()` component (combo/toggle), and a `SearchTextField`; list hosted via `setContent`.
- Request-guarded async (`request`/`active(id)`/`busy`, ported verbatim from providers):
  `reload()` → `fetch()` → `view.update(...)` on EDT, with `showProgress`/`showError`/`clearProgress`.
- Open/abstract hooks:
  - `suspend fun fetch(): List<SettingsListItem>`
  - `fun onCell(key: String, cellId: String)`
  - `open fun extraActions(): List<AnAction> = emptyList()`
  - `open fun headerExtras(): JComponent? = null`
  - `open fun searchPlaceholder(): String`, `open fun emptyText(): String`
  - `open fun showRefresh(): Boolean = true`
- `@RequiresEdt` everywhere that touches Swing; `checkEdt()` guard (same discipline as providers).

A small `SettingsToolbarAction(text, description, icon, enabled, action)` (generalized
`ProviderToolbarAction`) backs toolbar buttons.

---

## Providers refactor (adopt shared)

- `ProviderListRow : SettingsListItem`:
  - `title = provider.name`, `description = providerDescription(provider)`,
    `icon = providerIcon(provider)`, `section` (existing), `disabled` (existing).
  - `cells` mapped from `ProviderListAction`: label via existing `text(action)`,
    `enabled = enabled(action)` (env source can't disconnect → `enabled=false`),
    `alwaysVisible = (action == DISCONNECT && connected)`.
  - Optional badges: `Custom` when `source == "custom"`, `Env` when `source == "env"` (nice-to-have;
    can ship empty initially).
  - Keep `ProviderListAction` enum + `providerListRows`/`providerActions`/section bucketing in the
    providers package (provider domain logic stays).
- `ProvidersContent` → use `SettingsListView` (`onCell` maps cellId → `ProviderListAction` →
  connect/oauth/disconnect/enable). Section bucketing stays at fetch time; client-side filter applies
  on top and section titles recompute from the filtered list.
- `ProvidersSettingsUi` → extend `SettingsListPanel`:
  - `fetch()` calls `KiloProviderService.state(dir)`, stores `state` (needed for dialogs/auth), maps to
    rows.
  - `extraActions()` = the `Add custom provider` action; `onCell` dispatches provider actions.
  - Keep all provider-specific overlay logic (OAuth device panel, countdown timer, `ApiKeyDialog`,
    `CustomProviderDialog`, cancel) — these already live on `SettingsOverlayPanel`/`SettingsPanel`.
- Renderer/hit-testing: delete `ProviderListRenderer` and use `SettingsListRenderer` +
  `settingsListCellAt/Bounds/VisibleCells`.
- **Behavior to preserve** (and assert in tests): connected row shows Disconnect even when not
  selected; unselected unconnected rows show no actions; env disconnect is disabled and not
  hit-testable; disabled rows show nothing; section ordering Connected→Popular→All; reload request
  guard; dispose cancels.
- **Test migration:** `ProvidersSettingsUiTest` calls `ProviderListRenderer.actionAt/actionBounds/
  visibleActions` and asserts `ProviderListRow.actions`. Update these to the shared
  `settingsListCellAt/...` functions and `SettingsListCell`s, keeping every behavioral assertion.
- **Fallback (if full-shell adoption risks provider behavior):** keep `ProvidersSettingsUi`/
  `ProvidersContent` bespoke but adopt the shared **renderer + row interface + hit-testing + badge**
  only. Documented as the lower-risk fallback; prefer full adoption.

---

## Per-page refactor (agent-behavior)

Each page becomes a thin `SettingsListPanel` subclass. The configurable bases switch to the
providers-style shell (own scroll), so update `AgentBehaviorConfigurableBase` to dispose the panel
when it is `Disposable` and let converted children return `scrollReadyShell() = false` (MCP, still
`BaseContentPanel`, keeps the default scroll shell).

### A. Agents — `AgentsConfigurable` / `AgentsSettingsUi`
- `headerExtras()` = a `SettingsRow` with the **Default Agent** combo (existing `default_agent`
  config via `AgentBehaviorPage.modified/applyDraft/resetDraft`).
- `fetch()` = `agents(dir)` → rows: `title = displayName ?: name`, `description`, badges
  `[mode]` + `Custom` (when `native != true`) + `Hidden` (when `hidden`) + `Deprecated` (when
  `deprecated`); `cells = [Remove]` only when custom.
- `onCell("remove")` → `removeAgent(dir, name)` then `reload()`.
- `extraActions()` empty; `showRefresh() = true`; filter by title.

### B. Rules — `RulesConfigurable` / `RulesSettingsUi`
- `headerExtras()` = `SettingsRow` with the **Claude Code compat** `SettingsToggle`
  (`claudeCodeCompat()`/`setClaudeCodeCompat()`), kept as today.
- `fetch()` = map `config.instructions` (draft) to rows: `title = instruction`, no badges,
  `cells = [Remove]` (selected-only). Filter by text.
- `extraActions()` = an **Add** toolbar action (input dialog → append to draft → `reload()`), since
  Rules retains Add (decision 2). `showRefresh()` optional (config-only); include reset via the
  standard Reset.
- `AgentBehaviorPage`: `modified/applyDraft/resetDraft` persist `instructions` via `ConfigPatchDto`
  (unchanged).

### C. Skills — `SkillsConfigurable` / `SkillsSettingsUi`
- One unified list with three sections (via `section` on each row):
  - **Skill Folder Paths** — rows from `config.skills.paths` (draft), `cells = [Remove]`
    (selected-only). No Add (decision 1).
  - **Skill URLs** — rows from `config.skills.urls` (draft), `cells = [Remove]`. No Add.
  - **Discovered Skills** — `fetch()` = `skills(dir)`; badge `Built-in` (`location == "builtin"`)
    else `Custom`; `cells = [Remove]` only for custom → `removeSkill(dir, location)` + `reload()`.
- `onCell` routes by section/key: path/url removes mutate the draft and re-sync; discovered remove
  calls the service. `AgentBehaviorPage` persists `SkillsPatchDto(paths, urls)`.
- `showRefresh() = true` (reloads discovered + re-reads config draft baseline).

### D. Workflows — `WorkflowsConfigurable` / `WorkflowsSettingsUi`
- Read-only. `fetch()` = `commands(dir)` → rows: `title = "/" + name`, `description`, badge `[source]`,
  no cells. `showRefresh() = true`; filter by title; empty state via `settings.agentBehavior.empty`.
- No `AgentBehaviorPage` (nothing to apply).

---

## Badges

| Page | Badge(s) | Source field | Tone |
|---|---|---|---|
| Agents | mode (`primary`/`subagent`/`all`) | `mode` | NEUTRAL |
| Agents | `Custom` | `native != true` | ACCENT |
| Agents | `Hidden` | `hidden == true` | NEUTRAL |
| Agents | `Deprecated` | `deprecated == true` | WARNING |
| Skills | `Built-in` / `Custom` | `location == "builtin"` | NEUTRAL / ACCENT |
| Workflows | source (`command`/`mcp`/`skill`) | `source` | NEUTRAL |
| Providers (optional) | `Custom` / `Env` | `source` | ACCENT / NEUTRAL |

Badge text comes from new bundle keys; colors are theme-derived (`UiStyle.Colors`), never hardcoded.

---

## Configurable wiring

- `AgentBehaviorConfigurableBase`: keep `AgentBehaviorPage` delegation; add disposal of the panel when
  it implements `Disposable`; converted children override `scrollReadyShell() = false`.
- XML registration in `kilo.jetbrains.frontend.xml` is unchanged (same five children).

---

## i18n

Add to `frontend/src/main/resources/messages/KiloBundle.properties` (English; locales fall back):

- Filter placeholders: `settings.agentBehavior.agents.search`, `.skills.search`, `.workflows.search`,
  `.rules.search`.
- Toolbar: `settings.agentBehavior.refresh` / `.refresh.description`; `settings.agentBehavior.rules.add`
  (+ add-dialog title/prompt). Reuse `settings.agentBehavior.remove`, `settings.agentBehavior.empty`.
- Badges: `settings.agentBehavior.badge.custom`, `.builtin`, `.hidden`, `.deprecated`; agent mode and
  workflow source can reuse the raw value or add `settings.agentBehavior.badge.mode.*` /
  `.source.*` keys.
- Keep existing section titles (`agents.available`, `skills.paths`, `skills.urls`, `skills.discovered`,
  `rules.*`). Add a workflows section title if needed.

(Confirm whether CI requires the new keys in every `KiloBundle_<locale>.properties`; if so, mirror the
English value as the fallback. Otherwise English-only is fine.)

---

## Testing

- New fake `frontend/src/test/.../testing/FakeAgentBehaviorRpcApi.kt` (implements
  `KiloAgentBehaviorRpcApi`), injected via `KiloAgentBehaviorService(cs, fake)` + `replaceService`
  (mirrors `FakeProviderRpcApi`). Seed `KiloAppService` state for config-backed values (default agent,
  instructions, skills config) following the existing settings-test setup.
- Shared component tests (mirror `ProvidersSettingsUiTest` helpers — `edt {}`, `flushUntil`, component
  walk):
  - `SettingsListRendererTest`: badges render per `item.badges`; cells visible only when selected;
    `alwaysVisible` cell visible unselected; disabled rows show no cells; `enabled=false` cell not
    hit-testable; section titles; icon hidden when null.
  - `SettingsListViewTest` / `SettingsListPanelTest`: client-side filter, selection preserved by key,
    Enter triggers primary cell, `onCell` dispatch, refresh reload, busy disables.
- Page tests: `AgentsSettingsUiTest`, `SkillsSettingsUiTest`, `WorkflowsSettingsUiTest`,
  `RulesSettingsUiTest` — rows + badges, remove only when selected, remove calls the service/mutates
  draft + reloads, filter, refresh, default-agent apply, Claude toggle, rules Add.
- Update `ProvidersSettingsUiTest` to the shared renderer/hit-testing/cell APIs, preserving every
  behavioral assertion (connected-disconnect-always-visible, env-disabled, sections, reload guard,
  dispose).

---

## File-by-file / task checklist

**New shared (`frontend/.../settings/base/`)**
- [ ] `SettingsListModel.kt` (interface, `SettingsBadge`, `SettingsListCell`, helpers).
- [ ] `SettingsListRenderer.kt`.
- [ ] `SettingsListView.kt`.
- [ ] `SettingsListPanel.kt` (+ `SettingsToolbarAction`).
- [ ] `client/ui/BadgeLabel.kt` (shared).

**Providers (adopt shared)**
- [ ] `ProviderListRows.kt`: `ProviderListRow : SettingsListItem` (+ cell/badge mapping).
- [ ] Replace `ProviderListRenderer.kt` usage with `SettingsListRenderer` + shared hit-testing
      (delete the file or keep a thin façade only if needed for tests).
- [ ] `ProvidersSettingsUi.kt`/`ProvidersContent`: build on `SettingsListPanel`/`SettingsListView`;
      keep OAuth/dialog/custom-provider logic.
- [ ] Update `ProvidersSettingsUiTest.kt` to shared APIs.

**Agent-behavior pages (`frontend/.../settings/agentbehavior/`)**
- [ ] `AgentBehaviorConfigurableBase.kt`: dispose `Disposable` panels; allow `scrollReadyShell=false`.
- [ ] `AgentsConfigurable.kt` / `AgentsSettingsUi` → `SettingsListPanel` (default-agent header + list).
- [ ] `RulesConfigurable.kt` / `RulesSettingsUi` → `SettingsListPanel` (Claude toggle header +
      instructions list + Add).
- [ ] `SkillsConfigurable.kt` / `SkillsSettingsUi` → `SettingsListPanel` (paths/urls/discovered
      sections, remove-only).
- [ ] `WorkflowsConfigurable.kt` / `WorkflowsSettingsUi` → `SettingsListPanel` (read-only).
- [ ] Remove now-unused `SettingsListEditor` usages where add-editors are dropped (keep the class if
      still used elsewhere; otherwise delete).

**i18n & tests**
- [ ] New `settings.agentBehavior.*` keys in `KiloBundle.properties` (+ locale fallbacks if CI requires).
- [ ] `FakeAgentBehaviorRpcApi.kt` + the renderer/view/panel/page tests listed above.

**Out of scope**
- MCP page conversion (sibling list; not requested) — note as optional follow-up using the same
  shared classes.
- Any new create/edit of agents/rules/skills/workflows; re-adding skill paths/urls Add.

---

## Verification

From `packages/kilo-jetbrains/` (Java 21 required):

- `./gradlew typecheck` (or `bun run typecheck`).
- `./gradlew test` (or target the new/updated tests).
- Manual: `./gradlew runIde` → Settings → Tools → Kilo Code → Agent Behavior. Confirm each page shows a
  filter field + refresh toolbar, inline Remove appears only on the selected row, badges render
  (custom/built-in/mode/source), and Providers still behaves identically (OAuth, custom provider,
  connected-disconnect).

## Risks / notes

- **Provider adoption is the highest-risk step** (large test suite, OAuth/dialog overlays, busy/section
  logic). Do it last; if behavior can't be cleanly preserved on the full generic shell, fall back to
  adopting only the shared renderer + row interface + hit-testing + badge in Providers.
- **Skills three-section list** + remove-only paths/urls is an intentional interim state; flag in the
  PR description.
- **EDT discipline**: port the providers `@RequiresEdt`/`checkEdt`/request-guard patterns exactly into
  the shared panel to avoid threading regressions.
