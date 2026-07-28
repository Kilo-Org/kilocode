# Agent Manager Side Terminal — Plan

Goal: the Agent Manager terminal button and `Cmd/Ctrl+/` can either open the VS Code integrated
terminal (today's behavior, default) or an embedded terminal in the **right-hand inspector** that
already hosts Diff and the planned PR panel. The user picks which, and the picker is visible in the
UI, not buried in settings.

## Should we restart from the `opaque-tv` branch?

Restart the **integration and UX layer**, salvage the rest. Conflicts are not the problem.

Measured against current `main` (`d41e0cdc04`):

- `opaque-tv` is based on `fe6f857bbd` (2026-06-26), 2213 commits behind.
- A 3-way apply of its diff onto `main` produces only **6 real conflict hunks**: 3 in
  `AgentManagerApp.tsx`, 2 in `AgentManagerProvider.ts`, 1 in `accessibility.spec.ts`. The other 5
  are in `bun.lock` and `packages/sdk/js/src/v2/gen/types.gen.ts`, which must be dropped anyway.
- The terminal subsystem has not moved in `main` since that base: `terminal/state.ts`,
  `terminal/TerminalTab.tsx`, `terminal-routing.ts`, `terminal-manager.ts`, `terminal-font.ts` are
  untouched; `terminal/render.tsx` is +8 lines.
- Every anchor the change relies on still exists unchanged: `am-detail-stack`, `am-diff-resize`,
  `renderTerminalLayer({ state: terms })`, `createTerminalState(selection)`, the `showTerminal`
  action handler.

So the branch is cheap to port and the design decisions are sound. What must be redone is precisely
what it did wrong: it built a **second, absolutely positioned side panel** next to the existing one
(`position: absolute`, `margin-right` on `am-detail-stack`, hardcoded `top: 36`, its own resize
handle, its own header metrics) instead of extending the existing inspector, and it shipped a hidden
setting with no in-UI affordance.

**Approach:** branch fresh off `main`, hand-port the clean parts, rewrite the layout/UX.

Salvage as-is:

- `package.json` setting + `terminal-font.ts` read/watch helpers + provider plumbing.
- `TerminalPlacement = "tab" | "side"` through `types.ts`, `extension-messages.ts`,
  `webview-messages.ts`, `agent-manager.ts`.
- `terminal-routing.ts` correlation-id + generation guards for creates that land late.
- `terminal/state.ts` side-terminal additions (`sides`, `side`, `sideForContext`, `sideKey`,
  `pendingSide` / `beginSide` / `cancelSide` / `completeSide`) — but keep the existing `createMemo`
  accessors instead of downgrading them to plain functions, and keep the docblocks.
- The three new unit test files, the story, and the changeset.

Discard:

- The whole `SideTerminalPanel` positioning/layout approach and its bespoke CSS metrics.
- `bun.lock` reordering and the `types.gen.ts` regression (`nextBillingAt?: string | null` → `string`).
- The `provider-action.ts` guard (unnecessary once the correlation field is terminal-scoped).
- The pre-existing bug fixes bundled in (`TerminalRouter.dispose` manager re-creation, `onMessage`
  panel-identity guard, strict `resolveCwd`, PTY teardown on panel close). These are real fixes;
  land them as their own PR first so this feature is not blamed for the behavior change.
- The ~15 deleted explanatory comments, including the xterm paint-tree invariant docblock in
  `render.tsx`. They were deleted to stay under the `max-lines: 3210` cap on `AgentManagerApp.tsx`;
  extract side-terminal wiring into `terminal/side.ts` instead.

## Layout: one inspector, three modes

`sidePanel` becomes `"diff" | "pr" | "terminal" | null` and stays **mutually exclusive in the DOM as
well as in the signal**. No second host, no absolute positioning, no `margin-right`, no magic `top`.

Reuse the existing chain exactly as Diff uses it today:

```
.am-detail-content(.am-detail-split)
├─ .am-main-pane            flex: 1        chat + tab terminal layer
└─ .am-diff-resize          flex-shrink: 0, inline width
   ├─ ResizeHandle          edge="start"
   └─ .am-diff-panel-wrapper flex: 1
      ├─ <Show diff>  DiffPanel
      ├─ <Show pr>    PullRequestPanel
      └─ side terminal layer   always mounted, opacity-toggled
```

Constraints this must respect:

- **The host stays mounted while a side terminal is alive.** Gate it on
  `sidePanel() !== null || terms.sides().length > 0`. When `sidePanel() === null` the wrapper gets a
  `hidden` modifier (`width: 0; opacity: 0; pointer-events: none`, resize handle hidden) rather than
  unmounting, because unmounting or `display: none` on any ancestor kills the xterm render loop.
- **Diff/PR stay `<Show>`-mounted.** Only the terminal layer needs the persistent treatment; it uses
  the same `opacity` + `pointer-events` + `inert` pattern as `.am-terminal-layer` /
  `.am-terminal-slot` (verified: `inert` is a real boolean attribute in Solid 1.9.12, so
  `inert={false}` removes it correctly).
- **One width signal.** Rename `diffWidth` → `sideWidth` (JS only, no CSS churn) and share the
  existing rAF-coalesced `onResize`. Keep `min: 200` for diff/PR, but raise the minimum to **360px**
  while in terminal mode so xterm does not reflow into unusable column counts. Max stays `80vw`.
- Switching Diff/PR ↔ terminal hides but never kills the terminal; scrollback survives.

## UX

### Toolbar button

Turn the existing terminal `IconButton` into a **split button**, reusing
`renderNewTabButton`'s markup and classes (`am-split-button`, `am-split-arrow`, `am-split-menu`,
`am-menu-shortcut`, `am-menu-key`, `tab-rendering.tsx:247`). Do not invent new chrome.

- Primary click → `openPreferredTerminal()`, which **toggles**. `opaque-tv` only ever opened, so
  neither the button nor `Cmd+/` could close the panel, while the button still rendered an active
  state. Diff toggles; terminal must behave the same.
- Dropdown → two mutually exclusive items with a check mark on the active one:
  `Open in VS Code terminal` / `Open in Agent Manager panel`. Selecting one writes the setting, so
  the next primary click follows it immediately. Show the `Cmd/Ctrl+/` hint via
  `parseBindingTokens` in the primary item, matching the existing menu items.
- Active styling: reuse the existing toolbar toggle style (`am-tab-diff-btn-active`), the same one
  Diff/PR use. Only show it in `agentManager` mode; in `vscode` mode the button never latches.
- `Cmd/Ctrl+Shift+T` (new terminal **tab**) is unchanged. `Cmd/Ctrl+W` closes the side terminal when
  it holds focus, then falls through to the existing tab/worktree chain.

### Panel header

Reuse the Diff panel header structure and metrics so the header does not jump when the user switches
modes. `opaque-tv` invented `.am-side-terminal-header` with `height: 36px` and
`padding: 0 4px 0 12px`, which does not line up with `.am-diff-header`.

- Structure: `.am-diff-header` → `.am-diff-header-main` (icon `console` + title) +
  `.am-diff-header-actions`. If a shared class is wanted, extract `.am-side-header` and have both
  panels use it; do not fork the metrics.
- Metrics to match: `padding: 4px 4px 4px 12px`, `border-bottom: 1px solid var(--border-weak-base)`,
  `background: var(--surface-base)`, `z-index: 20`.
- Title typography: `.am-diff-header-title` (`font-size: var(--font-size-small)`, `font-weight: 500`,
  `color: var(--text-weak)`), ellipsis on overflow.
- Actions, right-aligned, `size="small" variant="ghost"` with tooltips: hide (`chevron-right`), close
  (`close`). Leave room for a later `+` (second side terminal) but do not build it now.
- Body background: `var(--vscode-terminal-background, #1e1e1e)`, matching `.am-terminal-layer`.

### States

- **Loading** (create in flight): centered spinner over the terminal background, styled like
  `.am-diff-loading` rather than a new bespoke class.
- **Empty** (context has no side terminal yet): do **not** close the panel. `opaque-tv` closes it on
  every context switch, which is jarming when hopping worktrees. Keep the panel open and show a
  small centered "Start a terminal in <context>" state with a primary button, or auto-create when
  the user explicitly triggered the action. Closing the panel is only for explicit close.
- **Error**: keep the existing toast (`agentManager.terminal.errorTitle`) and revert the panel to its
  previous mode rather than leaving an empty shell.
- **Exited PTY**: show the existing `agentManager.terminal.ended` copy inline in the panel header
  area; the close button is right there, so no tab-close affordance is needed.

### Focus and a11y

- Revealing focuses xterm; hiding blurs it and returns focus to the chat input.
- Keep the `opaque-tv` fix that stops repaints from stealing focus, but consume
  `state.focusRequest()` inside `TerminalTab` instead of threading a numeric `focusSerial` prop, and
  cover it with a test since it changes existing tab-terminal behavior.
- Hidden panel is `inert` **and** `aria-hidden`; visible panel is a `<section aria-label>`.
- Add the Storybook story plus the `accessibility.spec.ts` entry (`opaque-tv` already did both).

## Scope

One side terminal per context: worktree id, or the workspace root for Local and unassigned sessions.
Not persisted across Agent Manager reopen. No split, no tab strip inside the panel — those are
follow-ups the header layout leaves room for.

## Sequence

1. PR 1: the four pre-existing terminal fixes from `opaque-tv`, with tests, on their own.
2. PR 2, step 1: setting + provider plumbing + `placement` types (terminal-scoped correlation id).
3. PR 2, step 2: `terminal/state.ts` side state, memos intact, docblocks intact.
4. PR 2, step 3: unify the inspector host (`diff | pr | terminal`, shared `sideWidth`, persistent
   terminal layer, hidden-but-mounted host).
5. PR 2, step 4: split-button destination picker + toggle semantics + shared header.
6. PR 2, step 5: states, focus, a11y, story, i18n for the new strings, `minor` changeset.
7. Extract side wiring into `terminal/side.ts` so `AgentManagerApp.tsx` does not fight
   `max-lines: 3210`.

## Manual checks

Both destinations via button and `Cmd/Ctrl+/`; second press closes; dropdown switch takes effect
immediately; worktree vs Local vs unassigned cwd; switching worktree with the panel open; Diff/PR ↔
terminal round trip with scrollback intact; resize down to the terminal minimum; header alignment
against the Diff header; `Cmd+W` with the terminal focused; reopening Agent Manager after closing it.
