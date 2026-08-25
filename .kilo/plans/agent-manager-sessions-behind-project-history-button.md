# Plan: Replace the Agent Manager SESSIONS list with a per-project sessions button

Worktree: `/Users/marius/Documents/git/kilocode/.kilo/worktrees/hill-animal`
All paths below are relative to `packages/kilo-vscode/`.

Related: https://github.com/Kilo-Org/kilocode/issues/12928

## Problem

The Agent Manager sidebar renders an inline `SESSIONS` section in both modes:

- Single project: `SidebarBody.tsx` renders `UnassignedSessionsSection` (bottom of the sidebar).
- Multi project: `ProjectSidebarBody.tsx` renders the same section per expanded project (bottom of each project body).

Limitations:

- The section only lists root sessions (`worktreeId === null`). Sessions that live in a worktree are not reachable from it.
- In multi-project mode every expanded project renders its own unbounded list, pushing other projects out of the viewport.
- The inline list grows without a scroll container (`UnassignedSessionsSection` sets `am-section-grow` but the scroll container is the projects list, so the list can only push).

Goal: remove the inline SESSIONS element from both modes and behind a per-project button. Clicking the button does the same as `/sessions` in the Agent Manager (open the history view), but scoped to that project only, so sessions of other projects never appear.

## Current `/sessions` flow in Agent Manager (reference behavior)

`/sessions` is an action in `useSlashCommand.ts` that posts `{ type: "navigate", view: "history" }`. In the Agent Manager this hits `AgentManagerApp.tsx` handler `setHistory(true)`, which shows `HistoryView`.

`HistoryView` (src/components/history/HistoryView.tsx) has three tabs:

- Local: `SessionList` without a `sessionIds` filter, so it renders `session.sessions()` (the session context store).
- Cloud: unchanged.
- Worktree: only when the sidebar has a worktree selected; `SessionList` filtered to that worktree's session ids (`activeWorktreeSessionIds`).

Picking a session (`HistoryView onSelectSession`, `AgentManagerApp.tsx`):

1. `addSessionToCurrentWorktree(sid)`: when a worktree is selected and the session is not owned by any worktree, the session is attached to the selected worktree (`agentManager.addSessionToWorktree`).
2. When the session is already owned by a worktree: navigate to its owning worktree (`worktreeSessionIds().has(id)`).
3. When it is in the project's local tabs: select it in the local context.
4. Otherwise: `openLocally(id)` (adds it to the project's local tabs, replacing a pending New Session draft).

`session.sessions()` is populated by `loadSessions`, which the extension scopes to a single project (the active project's `projectQualifier`). It structurally cannot contain another project's sessions. Per-project session data arrives over a separate pipeline: `agentManager.projectSessions` -> `createProjectSessionsLive()` in the webview, which contains every session of a project (root and worktree sessions, tagged with `worktreeId: string | null`).

## Design

### 1. Button per project, same behavior as `/sessions`

- Single project: add a history `IconButton` to the WORKTREES header actions (`WorktreeSectionActions.tsx`, next to search / new worktree). Click -> `setHistory(true)` (identical to `/sessions`).
- Multi project: add a history `IconButton` to each project row header in `ProjectsSection.tsx` (next to the remove X), so every project has exactly one button, also when the project is collapsed. Click -> activate that project via `agentManager.activateSelection` with target `{ projectId, kind: "local" }` (no restore), then `setHistory(true)` with the project-scoped filter.

Reason for activating the project first: `HistoryView`/`SessionList` render `session.sessions()`, which is only populated for the active project. Activating the target project first is the only way to reuse the existing `/sessions` machinery without writing a bespoke list. When the user clicks back, they are in that project, which matches clicking the project row today.

Icon: `Icon name="history"` (kilo-ui falls back to the upstream icon set; already used by `WelcomeEmptyState.tsx`). Label: reuse the existing `session.showHistory` key, already translated in every locale.

### 2. Project-scoped filtering

Track `historyProject` (signal, `string | undefined`) in `AgentManagerContent`:

- `undefined` = legacy `/sessions` flow (unchanged behavior, Worktree tab stays).
- project id = project-scoped history:
  - Local tab: `HistoryView` gets a new optional `sessionIds` prop; `SessionList` already accepts `sessionIds`, so the Local tab renders only the filter set.
  - Filter set = ids of `projectSessionsLive()[pid]` (all root + worktree sessions of that project, including live-store overlays once the project is active), filtered by `isKnownRootSession`.
  - Worktree tab: hidden while `historyProject` is set. All project sessions are already in the Local tab; a Worktree tab could show a different project's selected worktree and pollute the scope.
  - Cloud tab: unchanged.
- `historyProject` resets when history closes (Back button, session picked, `onBack`).

Session list membership uses `projectSessionsLive()[pid]`, which the extension pushes per project at project init. If it is missing, the filter set is empty (no other project's sessions can bleed in).

### 3. Where a picked session starts, and the start-location choice

When `historyProject` is set, picking a session uses the same routing as `/sessions` in that project (the project is active after step 1, so the existing `onSelectSession` handler in `AgentManagerApp.tsx` operates on the right project):

- Row click (default, same action as the old SESSIONS row click): session owned by a worktree stays bound to that worktree and jumps to it; root sessions open in the project's local tabs (`openLocally`), replacing a pending New Session draft.
- Row menu (three-dot, avatar/hover): each row also offers a start-location choice, shown in the sessions view:
  - **Start in a new worktree**: the existing promote pipeline (`agentManager.promoteSession`), which creates a fresh worktree in the project, runs its setup script, moves the session into it, and opens it there.
  - **Open in project local tabs** (worktree-bound rows only; root rows just open locally): new message `agentManager.openSessionLocally` moves the session back to the project root (state `moveSession(sessionId, null)` + root route registration + state push) and activates it in the project's local tabs.
- Attach-to-selected-worktree (`addSessionToCurrentWorktree`) only applies in the legacy `/sessions` flow, where the user opened history while a worktree was selected. Because the button activates the project with a `local` target first, the project-scoped flow never rebinds a root session to a worktree.

This is the deliberate behavior difference: the button's list is project-scoped and origin-driven; the in-chat `/sessions` keeps the continue-in-worktree semantics.

#### Removed worktree edge case

When a worktree is deleted, the flow in `provider-lifecycle.ts` already de-syncs its sessions: `state.removeWorktree(worktreeId)` deletes the worktree and every session bound to it from the managed state (`WorktreeStateManager.removeWorktree` removes `sessions[worktreeId]` entries and returns them as orphaned), and the caller runs `host.sessions.clearDirectory(sessionId)` for each orphaned session. `collectProjectSessions` lists only the project root plus directories of worktrees that still exist in state, so a deleted worktree's sessions are no longer listed in any project list. The backend session records stay on disk (keyed to the removed directory) but are unreachable from the Agent Manager lists.

Consequences for the new flow:

- The project-scoped history cannot show a dangling "session in removed worktree" row: `projectSessionsLive()` only contains sessions found under root or live worktree directories, and the persisted managed list prunes them on removal. End-to-end: delete worktree -> button -> history -> the session is not listed, so "selecting" it is impossible. It reappears only when the worktree is re-created and `restoreWorktrees` re-attaches it.
- Defensive guard in the picker: if a picked session claims a `worktreeId` that no longer resolves in the current project state (race between webview state push and removal), fall back to `openLocally` instead of `selectWorktree`. This mirrors the extension-side fallback in `project/messages.ts` `activateSelection` ("worktree is gone, falling back to local").
- Open-tab nuance (not reachable through the history, no change planned): a still-open chat tab for the pruned session keeps working after removal. Message load falls back to the session record's stored directory (the deleted path); prompt-send falls through `resolveNewSessionDirectory` to the project root. So such a tab continues against the project root, not the deleted worktree.

### 4. Sidebar cleanup

- Remove `UnassignedSessionsSection` from `SidebarBody.tsx` and `ProjectSidebarBody.tsx`; delete `UnassignedSessionsSection.tsx`.
- Remove `sessionsCollapsed` / `toggleSessions` webview plumbing: props in `SidebarBody`, `ProjectSidebarBody`, `AgentManagerApp` signals, the registry store field (`project/store.ts`), and the `agentManager.setSessionsCollapsed` post (keep the extension-side state field and message handler inert, so existing `.kilo/agent-manager.json` files and `worktree-state-manager.test.ts` stay valid).
- WORKTREES section always grows (`am-section-grow`) and scrolls; the old grow-toggle tied to `sessionsCollapsed` (`SidebarBody.tsx` line 187) is replaced by always-grow. In single mode this removes the `max-height: 50vh` cap because `.am-section-grow .am-worktree-list` already sets `max-height: none; flex: 1`.
- Remove unassigned session rows from keyboard navigation and jump shortcuts: `buildSidebarOrder` (drop the `sessions` param), `projectSidebarOrder` (`project-local-navigation.ts`, drop the localSessions param), `buildProjectNavEntries` (`project-nav.ts`, drop the `unassigned`/`sessionsCollapsed` mapping). Invisible rows must not receive Cmd+Alt+arrow or Cmd+1-9 jumps (this also resolves the known issue documented in `agent-manager-multi-project-sidebar-density.md`).
- Remove now-dead helpers and props: `filterUnassignedSessions` (and its tests), `unassignedSessions` memo, `selectUnassigned`, `SidebarBody` props `unassignedSessions`/`selectUnassigned`/`sessionsCollapsed`/`toggleSessions`, `ProjectSidebarBody` prop `onSelectSession`, `SidebarBody` prop `onShowHistory` wiring stays for `ChatView`.
- Session search palette (Cmd+F) keeps its "sessions" group; it is not the tree list and stays.
- Agent manager `.am-list` / `.am-item` CSS used only by `UnassignedSessionsSection` can be deleted after the section is gone; other `.am-item`-style classes used by edit preview etc. stay.
- `agent-manager-arch.test.ts` references `UnassignedSessionsSection.tsx` in the file list and in a test; remove those references.
- Stories (`webview-ui/src/stories/agent-manager.stories.tsx`) remove the sessions fixtures in multi-project/sidebar stories and the `sessionsCollapsed: false` state fixture.

## Implementation tasks

Order matters: the section removal first, then the button, then the nav/CSS cleanup, then tests.

### Task 1: Remove the inline SESSIONS section

- `SidebarBody.tsx`: delete the `UnassignedSessionsSection` usage at the bottom; remove the import and the props `sessionsCollapsed`, `toggleSessions`, `unassignedSessions`, `selectUnassigned` from `SidebarBodyProps`; make the WORKTREES div always `am-section-grow`.
- `ProjectSidebarBody.tsx`: delete the `UnassignedSessionsSection` usage; remove the import and the `onSelectSession` prop; remove the `localSessions` memo if unused (still used by `projectSidebarOrder`, removed in task 3).
- Delete `UnassignedSessionsSection.tsx`.
- `AgentManagerApp.tsx`: remove `sessionsCollapsed`, `setSessionsCollapsed`, `toggleSessions` and the `unassignedSessions` memo; remove the corresponding props passed to `SidebarBody`; remove `filterUnassignedSessions` import.
- `project/store.ts`: remove the `sessionsCollapsed` field; `ProjectList.tsx` stops passing `onSelectSession` into the body.

### Task 2: Add the per-project history button

- `WorktreeSectionActions.tsx`: add `onHistory: () => void` prop and a `Tooltip`-wrapped history `IconButton` (`session.showHistory`).
- `SidebarBody.tsx`: pass-through `onHistory` prop.
- `ProjectsSection.tsx`: add `onHistory: (projectId: string) => void` prop; in the project row header actions add the history `IconButton` before the remove X (with `stopPropagation`).
- `ProjectList.tsx`: wire `onHistory`.
- `AgentManagerApp.tsx`:
  - Add `historyProject` signal and `openHistory(pid?: string)`: `pid` undefined -> `setHistory(true)`; `pid` set -> post `agentManager.activateSelection` `{ target: { projectId: pid, kind: "local" } }`, then `setHistoryProject(pid)`, `setHistory(true)`.
  - Pass `onHistory` to `SidebarBody` and `ProjectList`.
  - Reset `historyProject` in the close-history paths (Back, session picked, `setHistory(false)` calls for history).

### Task 3: Project-scoped history filter + start-location choice

- `src/components/history/HistoryView.tsx`: add optional `sessionIds?: Accessor<ReadonlySet<string>>` for the Local tab `SessionList`, and optional `rowActions?: (session: SessionInfo) => JSX.Element` rendered per row.
- `src/components/history/SessionList.tsx`: forward `rowActions` into `wrapItem` (after rename/delete buttons).
- `webview-ui/agent-manager/SessionRowActions.tsx` (new): per-row three-dot menu with `agentManager.session.openInWorktree` ("Start in a new worktree") and `agentManager.session.openLocally` ("Open in project local tabs", worktree-bound rows only).
- `AgentManagerApp.tsx`:
  - Memo `historySessionIds` from `projectSessionsLive()[historyProject()]` filtered by `isKnownRootSession`.
  - Pass `sessionIds={historySessionIds}` and `rowActions` to `HistoryView` only when `historyProject` is set.
  - Pass `worktreeSessionIds` to `HistoryView` only when `historyProject` is unset (legacy flow unchanged).
  - Row actions: "Start in a new worktree" posts `agentManager.promoteSession` (project already active); "Open in local tabs" posts `agentManager.openSessionLocally` (with `projectId` in multi mode), then closes history.
- New extension message `agentManager.openSessionLocally { projectId?, sessionId }`:
  - Multi project (`projectId` set): `project/messages.ts` handler moves the session to local (state `moveSession(id, null)`, `routeSession` root registration, `push()`), then `finish` with a session target so the webview's `applyProjectSelection` opens it via `focusLocalSession`.
  - Legacy (no `projectId`): provider dispatch moves the session with `moveSession(id, null)` + `registerWorktreeSession(id, root)` + `pushState()`; the webview then opens it locally.
  - `ProjectMessageDeps` gains optional `routeSession` wired in `project/wiring.ts` from `host.sessions` (`setSessionDirectory` + `registerSessionRoute`); add the type to `agent-manager/types.ts` and to the `state-gate.ts` list.

### Task 4: Navigation and CSS cleanup

- `section-helpers.ts`: remove the `sessions` parameter from `buildSidebarOrder`; update call sites and `tests/unit/section-helpers.test.ts`.
- `project-local-navigation.ts`: remove the `localSessions` parameter from `projectSidebarOrder`; drop session nav entries.
- `project-nav.ts`: remove `unassigned`/`sessionsCollapsed` mapping from `buildProjectNavEntries`; drop session nav entries; remove `sessionNavId` if unused.
- `navigate.ts`: remove `filterUnassignedSessions`; remove the `selectUnassigned` glue in `AgentManagerApp` (`focusSidebarItem` else-branch, `SidebarBody` prop).
- `agent-manager.css`: remove dead session-list rules if no longer used after task 1 (verify `am-list`, `am-item` usages first).
- `agent-manager-arch.test.ts`: drop `UnassignedSessionsSection.tsx` references.
- `tests/unit/navigate.test.ts`: drop the `filterUnassignedSessions` describe block.
- `webview-ui/src/stories/agent-manager.stories.tsx`: update stories to the button-driven UI.

## Verification

From `packages/kilo-vscode`:

```bash
bun run format
bun run typecheck
bun run lint
bun run test:unit
bun run check-kilocode-change
bun run compile
```

## Changeset

`.changeset/agent-manager-sessions-button.md`:

```md
---
"kilo-code": patch
---

Replace the Agent Manager sidebar sessions list with a per-project history button that opens all sessions of that project, including sessions running in its worktrees.
```

## Manual test

Open Agent Manager (`Cmd+Shift+M`). Single project:

1. The SESSIONS section at the bottom is gone; the WORKTREES list fills the sidebar and scrolls.
2. Click the history icon in the WORKTREES header: the history view opens (Local/Cloud tabs); the Local list matches the current project's sessions.
3. Type `/sessions` in the chat: behavior unchanged (history opens).

Multi project (`kilo-code.new.experimental.multiProject` on, add a second project):

4. Each project row has exactly one history icon; collapsed projects too.
5. Click project B's button: history opens, even when project A was active; the Local list shows only B's sessions (root and worktree sessions).
6. Pick a worktree-bound session of B: jumps to B's worktree, session selected.
7. Pick a root session of B: opens in B's local tabs; switch back to project A: A's sessions are untouched.
8. While project B is active and a worktree of B is selected, `Cmd`+click `/sessions` in chat: continue-in-worktree behavior preserved.
9. Cmd+Alt+Up/Down and Cmd+1-9 no longer land on invisible session rows.

## Out of scope / rejected options

- A bespoke project-session list rendering `ProjectSessionInfo` directly (per issue #12928's out-of-scope note): rename/export/delete and session selection all require the active-project session context. Activating the project and reusing `HistoryView` is the lower-risk path.
- Bounding the inline list to N rows with a "Show all" row (issue #12928 proposal): superseded by this design, which removes the list entirely.
- Keeping `sessionsCollapsed` persistence on the extension side: kept inert to avoid touching `WorktreeStateManager` and its tests; can be removed in a follow-up once no webview writes to it.
