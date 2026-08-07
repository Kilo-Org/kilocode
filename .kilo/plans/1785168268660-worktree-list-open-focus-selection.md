# Plan: Worktree session rows — full visual parity with History rows

## Goal

Make the session list inside a worktree editor (`WorktreeSessionEditorPanel`) render with **full visual parity** to the History list rows:

- Same activity **tags** (`RUNNING`, `PLAN`, `QUESTION`, `PERMISSION`, `LOGIN_REQUIRED`) — identical chip text, style, and glyph.
- Same relative **time ago** on the right (e.g. "3h ago").
- Same **date section headers** (Today / Yesterday / This week / …).
- **Title only** — no leading branch icon, no directory subtitle.
- Keep the recently added open/focus/selection behavior and the delete-on-focused-selection cell (do **not** revert the "no delete icon when unfocused" behavior — that was an intentional divergence from History requested earlier).

Achieve this by **reusing shared helpers** (`SessionActivityKind`, `HistoryTime`, `LocalHistoryItem`) plus one small additive extension to the shared `ActiveList` renderer (a trailing text column). Do **not** duplicate `HistoryRenderer`, and do **not** move the worktree session list onto the History `HistoryModel`/`HistoryRenderer` stack (that would lose the shared `ActiveList` open/focus behavior and add duplication).

## Scope / boundaries

- Kilo-owned code under `packages/kilo-jetbrains/frontend/...`; no upstream opencode presence → **no `kilocode_change` markers**.
- Do not change History behavior. Do not change the Agent Manager **worktree** list (top-level) rows.
- The shared `ActiveList` renderer change must be additive and default-off so settings/history-adjacent lists are visually unchanged.

## Key findings (verified in code)

- History rows: `HistoryRenderer` (`session/history/HistoryListRenderer.kt`) renders `title` + `BadgeLabel(FilledBadgeIcon(kind.label(), kind.style()))` + relative `time` + delete-on-selection, with `GroupHeaderSeparator` date sections. Time color = `if (selected) fg else UIUtil.getContextHelpForeground()`.
- Worktree session rows: shared `ActiveList` with `SessionRow: ActiveListItem` (`agentManager/worktree/WorktreeSessionEditorPanel.kt`) currently sets `icon = WorktreeIcons.branch`, `description = session.directory`, a delete cell, and no badges/time/section.
- Shared `ActiveList` already renders `ActiveListItem.badges` via the **same** `FilledBadgeIcon` History uses (`ui/list/ActiveListRenderer.kt` `syncBadges`), and already supports `ActiveListItem.section` headers (`activeListSectionTitle`). It has **no trailing time column**.
- Reusable, no duplication needed:
  - `SessionActivityKind.label()` / `.style()` (`session/SessionActivityKind.kt`) — identical chips.
  - `HistoryTime.relative/section/title/sorted` (`session/history/HistoryTime.kt`) — `internal`, visible across the frontend module.
  - `LocalHistoryItem(session)` (`session/history/HistoryItem.kt`) — public wrapper turning a `SessionDto` into a `HistoryItem`, so `HistoryTime.*` works directly on worktree sessions.
- `UiStyle.Colors.weak() == UIUtil.getContextHelpForeground()`, so the shared renderer's existing `weak` color matches History's time color exactly.
- Activity plumbing already exists: `WorktreeSessionEditorManager` (a `SessionHost`) exposes `activity(): Map<String, SessionActivityKind>` (base `KiloSessionService` RUNNING + live opened-UI kinds), and `activityChanged()` → `onListChanged` → panel `sync()`. Rebuilding rows in `sync()` refreshes tags/time live.

## Decisions

1. **Full parity via `ActiveList` config + one additive renderer field** (chosen by user). Reuse `SessionActivityKind` for tags and `HistoryTime` (via `LocalHistoryItem`) for time/section/sort. Add a reusable `trailing` text column to `ActiveList`.
2. **Do not unify renderers.** Keep two renderers; parity comes from shared data helpers + identical `FilledBadgeIcon`, so chips/time strings are identical without duplicating rendering logic.
3. **Keep delete-on-focused-selection** (ActiveList behavior). This intentionally differs from History (which shows delete on any selection) per the earlier requirement.

## Implementation tasks (ordered)

### 1. Shared: add a reusable trailing text column to `ActiveList`
Files: `ui/list/ActiveListModel.kt`, `ui/list/ActiveListRenderer.kt`
- `ActiveListModel.kt`: add `val trailing: String? get() = null` to the `ActiveListItem` interface (right-aligned secondary text such as relative time). Document it.
- `ActiveListRenderer.kt`:
  - Add a right-aligned `JBLabel` (call it `trailing`) placed in the EAST region **before** the action cells. Simplest: wrap the existing `cellPane` and the new trailing label in a horizontal `Stack` (e.g. `Stack.horizontal(UiStyle.Gap.md()).next(trailingPane).next(cellPane)`) and put that in `row` `BorderLayout.EAST`; register both with `UiStyle.Components.transparent(...)`.
  - In `getListCellRendererComponent`: set `trailing.text = value.trailing.orEmpty()`, `trailing.isVisible = !value.trailing.isNullOrBlank()`, `trailing.foreground = weak` (matches History; `weak = if (active) fg else UiStyle.Colors.weak()`).
  - The trailing label is a plain `JBLabel`, not an `ActiveListActionCell`, so it does not affect `activeListCellBounds`/hit-testing.
  - Default `trailing = null` → hidden → **no visual change** for existing consumers (settings, top-level worktree list).

### 2. Worktree session rows: configure like History
File: `agentManager/worktree/WorktreeSessionEditorPanel.kt`
- List `cfg`: set `description = false` (hide the directory subtitle). Keep `ActiveListRowHeight.EQUAL` and `MULTIPLE_INTERVAL_SELECTION`.
- `SessionRow` (`data class`) changes:
  - Remove leading icon: drop `override val icon = WorktreeIcons.branch` (leave null → no glyph).
  - Remove `description` override (directory) — no longer shown.
  - Add `kind: SessionActivityKind?` field (passed in from `sync()`).
  - `override val badges` = `listOfNotNull(kind?.let { ActiveListBadge(it.label(), it.style()) })`.
  - `override val trailing` = `HistoryTime.relative(LocalHistoryItem(session))`.
  - `override val section` = `HistoryTime.title(HistoryTime.section(LocalHistoryItem(session)))`.
  - Keep `title`, `tooltip`, `search`, and the delete `cells` as-is.
- `sync()`:
  - Sort the sessions the same way History does: `HistoryTime.sorted(sessions.map { LocalHistoryItem(it) })` then map back to `SessionDto`, or sort `SessionDto`s by `time.updated` desc with the same tiebreakers.
  - Read the activity map once: `val kinds = manager.activity()` and build each `SessionRow(session, kinds[session.id])`.
  - Keep `NewRow` pinned at index 0 when pending/new; `NewRow` keeps defaults (`badges` empty, `trailing`/`section` null) so it renders as a plain top row with no date header.
- `NewRow`: leave as a plain title row (defaults). Since its `section` is null and the first real row's section differs, the first date header renders directly under the New row (acceptable).

### 3. Reuse check (no new logic)
- Confirm `HistoryTime` (`internal`) and `LocalHistoryItem` (public) are importable from `ai.kilocode.client.agentManager.worktree` (same `frontend` module → yes).
- Confirm `SessionActivityKind.style()` maps `RUNNING → Alert`, others `Primary` (identical chips to History).

## Tests

File: `frontend/src/test/.../agentManager/worktree/WorktreeSessionEditorPanelTest.kt`
- Have `FakeManager` override `activity()` to return a controlled map (e.g. `mapOf("ses_1" to SessionActivityKind.RUNNING)`); this avoids depending on the project `KiloSessionService` instance.
- Assert for a rendered `SessionRow`:
  - `badges` == `listOf(ActiveListBadge(SessionActivityKind.RUNNING.label(), SessionActivityKind.RUNNING.style()))`.
  - `icon == null` and `description == null` (no branch glyph, no directory subtitle).
  - `trailing == HistoryTime.relative(LocalHistoryItem(session))`.
  - `section == HistoryTime.title(HistoryTime.section(LocalHistoryItem(session)))`.
- Assert rows are ordered by updated-desc (same as `HistoryTime.sorted`) and the `NewRow` stays at index 0 when pending.
- Keep existing tests green (single/double click, Enter/F4 focus, delete).

File: `frontend/src/test/.../settings/base/SettingsListViewTest.kt`
- Add: a row with `trailing = "3h ago"` renders a visible right-aligned label with that text; a row with `trailing = null` hides it. (Locks the additive shared-renderer behavior and guards other consumers.)

## Risks / edge cases

- **Shared renderer blast radius**: `trailing` defaults null → existing lists unchanged; verify `SettingsListViewTest` and any history-adjacent tests stay green.
- **Section headers now appear** in the worktree session list (new). This is intended for full parity; if undesired later, return `section = null` from `SessionRow`.
- **Row inset differences**: `ActiveListRenderer` uses `empty(md, 0, md, pad)`; `HistoryRenderer` uses `empty(lg, lg, lg, lg)`. Chips and time strings are identical, but padding differs slightly. If exact padding parity is required, align `ActiveListRenderer.row.border` for this list — treat as optional polish, and confirm it doesn't regress other `ActiveList` consumers (prefer leaving shared insets unchanged).
- **Live time refresh**: relative time is recomputed on `sync()` (activity/list changes), same as History recomputes on repaint; it won't tick every minute on its own. Acceptable / matches History.
- **Delete visibility** stays gated on focused selection (ActiveList) — intentionally different from History; do not change.

## Validation

From `packages/kilo-jetbrains/`:
- `./gradlew :frontend:test --tests ai.kilocode.client.agentManager.worktree.WorktreeSessionEditorPanelTest --tests ai.kilocode.client.settings.base.SettingsListViewTest`
- `./gradlew typecheck`
- Optional `./gradlew runIde`: worktree session rows show the same tag chips, "time ago", and date sections as History; single word title only, no branch icon/subtitle.

## Out of scope

- Migrating the worktree session list onto the History renderer/model stack.
- Changing History rows or the top-level worktree list.
- Auto-ticking relative time.
