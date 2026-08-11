# Plan: Agent Manager sidebar — shortcut badge fix + reclaim title width

Worktree: `/Users/marius/Documents/git/kilocode/.kilo/worktrees/mewing-profit`
All paths below are relative to `packages/kilo-vscode/`.

Rules:

- Do exactly these edits. Do not refactor anything else.
- Solid.js, not React: `class=`, not `className=`.
- Do **not** add `kilocode_change` markers. This package is Kilo-owned and CI fails if you do.
- Do **not** add new i18n strings. None are needed.
- Out of scope: the per-project `SESSIONS` list in the tree (tracked in
  https://github.com/Kilo-Org/kilocode/issues/12928). Do not touch `UnassignedSessionsSection.tsx`.

Do task A, verify, then task B, verify, then task C.

## Task A — Shortcut badge on the right, hidden until hover or ⌘ held

The `⌘1` badge on "local" rows is always visible, and in multi-project mode it renders on the
*left*, between the icon and the label. Worktree rows already behave correctly. Cause:
`.am-shortcut-badge` has no default `opacity: 0` — worktree badges are only hidden because their
container `.am-wt-hover-actions` is hidden, and local rows never got that container.

### A1 — `webview-ui/agent-manager/ProjectSidebarBody.tsx`

Replace the whole `<button class="am-local-item">` block (lines **301-348**) with this. The badge
`<Show>` moves from before `am-local-text` to the end, and stats + badge get wrapped:

```tsx
        <button
          class="am-local-item"
          classList={{ "am-local-item-active": active() && props.selection === "local" }}
          data-sidebar-id={`${props.project.id}:local`}
          onClick={() => props.onSelectLocal(props.project.id)}
        >
          <Show when={!props.localBusy?.()} fallback={<Spinner class="am-worktree-spinner" />}>
            <svg class="am-local-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2.5" y="3.5" width="15" height="10" rx="1" stroke="currentColor" />
              <path d="M6 16.5H14" stroke="currentColor" stroke-linecap="square" />
              <path d="M10 13.5V16.5" stroke="currentColor" />
            </svg>
          </Show>
          <div class="am-local-text">
            <span class="am-local-label">{props.t("agentManager.local")}</span>
            <Show when={props.local?.branch}>
              <span class="am-local-branch">{props.local!.branch}</span>
            </Show>
          </div>
          <div class="am-wt-actions-cell">
            <Show
              when={
                props.local &&
                (props.local.additions || props.local.deletions || props.local.ahead || props.local.behind)
              }
            >
              <div class="am-worktree-stats">
                <Show when={props.local!.behind}>
                  <span class="am-worktree-behind">↓{props.local!.behind}</span>
                </Show>
                <Show when={props.local!.ahead}>
                  <span class="am-worktree-commits">↑{props.local!.ahead}</span>
                </Show>
                <Show when={props.local!.additions}>
                  <span class="am-stat-additions">+{props.local!.additions}</span>
                </Show>
                <Show when={props.local!.deletions}>
                  <span class="am-stat-deletions">−{props.local!.deletions}</span>
                </Show>
              </div>
            </Show>
            <div class="am-wt-hover-actions">
              <Show when={props.shortcutMap?.().get(`${props.project.id}:local`)}>
                {(shortcut) => (
                  <span class="am-shortcut-badge">
                    {isMac ? "⌘" : "Ctrl+"}
                    {shortcut()}
                  </span>
                )}
              </Show>
            </div>
          </div>
        </button>
```

The `−` in `am-stat-deletions` is U+2212 MINUS SIGN, not a hyphen. Copy it verbatim.

### A2 — `webview-ui/agent-manager/SidebarBody.tsx`

Same bug in legacy single-project mode, but the badge is already last, so only the wrapper is
missing.

Insert **before** line **127** (`<Show when={props.localStats() === undefined}>`):

```tsx
        <div class="am-wt-actions-cell">
```

Replace line **182**:

```tsx
        <span class="am-shortcut-badge">{isMac ? "⌘" : "Ctrl+"}1</span>
```

with:

```tsx
          <div class="am-wt-hover-actions">
            <span class="am-shortcut-badge">{isMac ? "⌘" : "Ctrl+"}1</span>
          </div>
        </div>
```

Result: one `am-wt-actions-cell` div containing the skeleton `<Show>`, the stats `<Show>`, and the
hover-actions div, closing before `</button>`. Prettier fixes indentation in task D.

### A3 — `webview-ui/agent-manager/agent-manager.css`

Delete lines **569-575** and replace with the rule that actually works:

```css
.am-local-item .am-shortcut-badge {
  right: 8px;
}

.am-local-item:hover .am-shortcut-badge {
  opacity: 1;
}
```

becomes:

```css
.am-local-item:hover .am-wt-hover-actions {
  opacity: 1;
  visibility: visible;
}
```

(`right: 8px` never applied — the badge is `position: static`. The `opacity: 1` never did anything
because nothing set `opacity: 0` first.)

### A4 — same file, delete lines **609-611** entirely, add nothing:

```css
.am-show-shortcuts .am-local-item .am-shortcut-badge {
  opacity: 1;
}
```

The rule at lines 597-600 is not scoped to worktree items, so after A1/A2 it already covers local
rows.

### A5 — same file, lines **986-989**, add `visibility: hidden` to match worktree behaviour:

```css
.am-local-item:hover .am-worktree-stats,
.am-local-item:hover .am-worktree-stats-skeleton {
  opacity: 0;
  visibility: hidden;
}
```

### Verify A

```bash
cd packages/kilo-vscode && bun run typecheck && bun run lint
```

## Task B — Stop reserving width for invisible content

`.am-wt-actions-cell` is a grid whose children all stack in cell 1/1, so the cell is permanently as
wide as its widest child. `visibility: hidden` does not remove layout, so the invisible hover
actions (~42px) and the loading skeleton (~48px) reserve width on every row forever. That is why
titles truncate ~40px before the right edge.

All edits in `webview-ui/agent-manager/agent-manager.css`.

### B1 — Take hover actions out of grid flow

Lines **475-482**. Add the four `position` lines at the top, keep everything else:

```css
.am-wt-hover-actions {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  opacity: 0;
  visibility: hidden;
}
```

Absolutely positioned children never size grid tracks. `.am-wt-actions-cell` is already
`position: relative` (line 464). Do not edit the `.am-wt-actions-cell > *` rule at lines 469-472.

### B2 — Same for the loading skeleton

Add immediately after the rule from B1:

```css
/* Skeleton is a placeholder, not real content — it must not reserve title width. */
.am-wt-actions-cell > .am-worktree-stats-skeleton {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
}
```

Do not edit the base `.am-worktree-stats-skeleton` rule (lines 744-748) or `.am-pr-badge-skeleton`.

After B1+B2 the cell is sized only by `.am-worktree-stats` and `.am-worktree-delete-hint`, which
are the only things that should reserve space.

### B3 — Fade the title under the overlaying actions

The actions now overlay the row instead of sitting in reserved space, so a long title would render
behind them. Same fix the codebase already uses for the local branch at lines 577-580. Add after
B2:

```css
.am-worktree-item:hover .am-worktree-branch {
  mask-image: linear-gradient(to right, black calc(100% - 48px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, black calc(100% - 48px), transparent 100%);
}
```

### B4 — Remove one layer of nested padding

Lines **365-370**, change `padding: 0 6px;` to `padding: 0;`:

```css
.am-project-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}
```

Gains 6px per side on every row in a project. Rows keep their own 10px inset
(`.am-local-item` line 106, `.am-worktree-item` line 425) so they stay indented under the project
header. Do not change those, and leave `.am-project-body .am-section-header` (lines 273-275) alone.

### B5 — Remove the remaining outer list gutters in multi-project mode

The sidebar keeps 8px horizontal padding for the header controls, but the project list should use
the full width up to its scrollbar. In the same CSS file, extend `.am-projects-list` with:

```css
.am-projects-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  margin-inline: -8px;
}
```

Do not remove padding from `.am-sidebar` itself. This makes project cards and rows reach the
scrollbar without moving the `PROJECTS` header and its controls to the edge.

### Verify B

```bash
cd packages/kilo-vscode && bun run typecheck && bun run lint
```

## Task C — Show where a palette session lives

In the ⌘F search palette, multi-project session results show only the project name, so you cannot
tell whether a session is in a worktree or at the project root.

File: `webview-ui/agent-manager/ProjectList.tsx`. In the session loop (lines **90-106**), add the
two `const` lines and change `meta` and `search`:

```tsx
      for (const session of props.sessions[project.id] ?? []) {
        const wt = session.worktreeId ? state.worktrees.find((item) => item.id === session.worktreeId) : undefined
        const where = wt ? wt.label || wt.branch : props.t("agentManager.local")
        items.push({
          key: `${project.id}:session:${session.id}`,
          projectId: project.id,
          kind: "session",
          group: "sessions",
          title: session.title || props.t("agentManager.session.untitled"),
          meta: [project.label, where],
          search: [project.label, where, wt?.branch, session.title, session.id].filter(Boolean).join(" "),
          updatedAt: session.updatedAt,
          state: "idle",
          visible: project.expanded,
          sessionId: session.id,
          location: session.worktreeId ? "worktree" : "local",
          worktreeId: session.worktreeId ?? undefined,
        })
      }
```

`state` is already in scope (line 55) and already null-checked (line 56). `meta` is joined with
` · ` by the renderer (`SidebarSearchMenu.tsx:143`), so no separator work is needed.

## Task E — Align the project heading with the row icons

Every row in the projects tree used a different left inset, which made the sidebar look busy and
indented for no reason. Measured against a full-bleed `.am-projects-list` (starting at x=0):

| Element | Before | After |
|---|---|---|
| `PROJECTS` label | 16px | 10px |
| Project chevron | 12px | 10px |
| `WORKTREES` / `SESSIONS` label | 6px | 10px |
| `.am-local-item` icon | 10px | 10px |
| `.am-worktree-item` icon | 10px | 10px |

Changes in `agent-manager.css`:

- `.am-local-item` padding `8px 10px` → `8px 6px`
- `.am-worktree-item` padding `6px 10px` → `6px 6px`
- `.am-project-item` padding `6px 8px 6px 12px` → `6px 6px`
- `.am-project-body .am-section-header` padding-left `6px` → unchanged at `6px`
- `.am-projects > .am-section-header` gets `padding-left: 2px`, because that heading sits inside
  `.am-sidebar`'s own 8px padding rather than in the pulled-out list

The leading columns carry no padding of their own (`.am-sidebar-header-toggle` and
`.am-sidebar-header-chevron` are bare 16px boxes), so row padding is the only lever.

### Symmetric gutter

`.am-projects-list` uses `margin-left: -4px; margin-right: -4px`, pulling out of `.am-sidebar`'s
8px padding to an even 4px gutter. An earlier attempt used `-8px` on the left for true full bleed,
but that is wrong twice over: the resize handle's inner half then covered every card, so card
clicks started a resize, and a selected row's `border-radius: var(--radius-sm)` background clipped
flat against the window edge while still being inset on the right, which read as a bar bleeding off
the sidebar rather than a card.

4px is also the most reclaimable on the right. The handle's hit area is 8px wide centered on the
border, reaching 5px back into the content area (255-263 in a 260px sidebar). At this gutter the
row's hover actions end at 249, leaving 6px of clearance; anything tighter puts row buttons under
the handle and turns clicks into resize drags.

### Two tab stops

Reducing the insets exposed that labels sat at four different offsets: the non-collapsible
`WORKTREES` heading at 6px (it passes no `onToggle`, so `SidebarSectionHeader` renders no chevron),
collapsible headings at 28px, worktree card text at 30px, and local card text at 32px because
`.am-local-icon` was 18px wide while `.am-wt-icon` held a 16px glyph.

Normalized to one 16px leading column with an 8px gap, giving exactly two tab stops:

- `.am-sidebar-header-main` gap `6px` → `8px`, matching the card icon gap
- new `.am-project-body .am-sidebar-header:not(.am-sidebar-header-toggleable) .am-sidebar-header-main { padding-left: 24px }`
  so a heading with no chevron still reserves the column
- `.am-local-icon` `18px` → `16px`
- `.am-wt-icon` gains `width: 16px` and `justify-content: center`

Measured result at 260px:

| Tab stop | Elements |
|---|---|
| 10px | `PROJECTS` label, project chevron, local icon, worktree icon, `SESSIONS` chevron |
| 34px | project name, `WORKTREES` label, `SESSIONS` label, local text, worktree text |

```
cardLeftGap=4 | cardRightGap=4 | actionsRight=249 | handleZoneFrom=255
```

`PROJECTS` intentionally stays at the 10px glyph stop rather than being pushed to 34px: it is the
root heading, so indenting it further than the projects beneath it would invert the hierarchy.

### Rejected: a per-project icon in the heading

Superset shows a GitHub **owner** avatar per project (`https://github.com/{owner}.png?size=64`,
falling back to the project's initial). Our webview CSP already allows `https:` images, so it was
feasible, but it does not fit this repo set: of the local projects, ~17 are `Kilo-Org` remotes and
would share one identical Kilo logo, and ~20 have no git remote at all and would show nothing.
An owner avatar answers "who owns this", which is not the question the sidebar needs answered.
Superset's repo-file scanner (`favicon-discovery.ts`) is dead code there, so it was not an option
worth copying either. Left out entirely as out of scope.

## Task D — Final checks

From `packages/kilo-vscode`:

```bash
bun run format
bun run typecheck
bun run lint
bun run test:unit
bun run check-kilocode-change
bun run compile
```

Then create `.changeset/agent-manager-sidebar-density.md`:

```md
---
"kilo-code": patch
---

Fix the Agent Manager sidebar keyboard shortcut badge so it appears on the right edge of local rows and only while hovered or holding the jump modifier, give worktree titles more room by no longer reserving space for hidden row actions, and show which worktree a session belongs to in the search palette.
```

## Visual regression baselines

Task A and B change existing snapshots: `WorktreeItemDefault`, `WorktreeItemActive`,
`WorktreeItemPendingDelete`, `WorktreeItemStale`, `WorktreeItemWithStats`, `WorktreeItemGrouped`,
`SidebarSearchOpen`, `MultiProjectSidebar` in `webview-ui/src/stories/agent-manager.stories.tsx`.

**Do not run or update visual regression tests.** `tests/visual-regression.spec.ts` is skipped on
macOS, so you cannot produce valid Linux baselines locally. CI regenerates them and may push a
baseline commit. If a push is then rejected, do **not** `git pull --rebase`; run
`git fetch && git push --force-with-lease`.

## Manual test

Enable `kilo-code.new.experimental.multiProject` in Kilo Settings → Experimental, add a second
project, open Agent Manager (`Cmd+Shift+M`).

1. Nothing hovered: no `⌘N` badge visible anywhere.
2. Hover a `local` row: badge appears at the **right** edge, git stats fade out.
3. Hold ⌘: badges appear on all local and worktree rows, all right-aligned. Release: all gone.
4. Worktree rows with no git changes show noticeably longer titles than before. Hover one with a
   long title: it fades under the badge and trash button instead of colliding.
5. ⌘F: session results read `<project> · <worktree or local>`.
6. Turn the experimental setting off: the `local` row's `⌘1` badge is hidden until hover.

## Known issue, not fixed here

`⌘1`–`⌘9` index the full nav order, which includes session rows that render no badge
(`navigate.ts:214-218` + `section-helpers.ts:147-153`). So with 4 worktrees you see `⌘1`–`⌘5` and
`⌘6`–`⌘9` silently land on unlabelled session rows. Deliberately left alone: fixing it means
changing jump semantics and rewriting `tests/unit/navigate.test.ts:745-757`, and it becomes moot
once #12928 moves sessions out of the tree.
