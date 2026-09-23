# Fix the blinking (i) overlay and repeating tooltips in the worktree economics panel

## Diagnosis

The blinking is not a CSS hover problem. It is an **unbounded fetch/render loop** in the
economics controller that destroys and recreates the hovered DOM several times per second.

`packages/kilo-vscode/webview-ui/agent-manager/worktree-economics-controller.ts:114-120`

```ts
createEffect(() => {
  const id = params.selection()
  if (params.panel() !== SidePanel.Economics || !id || id === LOCAL) return
  const current = details()[key(params.project())]?.[id]   // <-- reactive read
  if (current?.loading) return
  request(id)                                              // <-- writes details()
})
```

The effect reads `details()` and `request()` writes `details()`, so it self-retriggers:

1. effect runs -> `request(id)` sets `loading: true` -> effect reruns -> early return (loading)
2. host replies -> `handle()` sets `loading: false` with fresh `detail`/`timeline` objects
3. effect reruns, `loading` is now false -> `request(id)` again -> back to step 1

The panel therefore re-fetches as fast as the extension host can answer. Each response is a
new object graph, so every `<For>` in `WorktreeEconomicsPanel.tsx` (models, agents, sessions,
timeline events) recreates its rows by reference diffing. Consequences the user sees:

- the hovered `.am-economics-explain` element is replaced, so `:hover` is lost and re-acquired
  -> the absolutely positioned `(i)` overlay flashes in and out ("repainting, blinking")
- the Kobalte tooltip trigger unmounts mid-hover, resetting open state, then reopens after
  `openDelay` -> the tooltip re-shows over and over ("behaves like crazy")

Two smaller defects make the hover feel unstable even without the loop:

- `.am-economics-info-popover` sits at `bottom: calc(100% + 6px)` from
  `.am-economics-info-wrap` (`agent-manager.css:6072-6093`). That 6px band belongs to neither
  the icon nor the popover, so moving the pointer from the `(i)` icon onto the popover text
  drops `.am-economics-info-wrap:hover` and closes it. The comment in the CSS claims hover is
  "continuously true", but the gap breaks exactly that invariant.
- every table cell, chip and section title is its own tooltip trigger with `openDelay={120}`
  while the shared wrapper defaults to `skipDelayDuration={300}`
  (`packages/ui/src/components/tooltip.tsx:110-111`). Sweeping the pointer across the table
  pops a rapid chain of tooltips.

## Changes

### 1. `webview-ui/agent-manager/worktree-economics-controller.ts` — break the loop

Make the auto-fetch fire once per "panel became open for this project/worktree" transition and
stop reading `details()` inside the effect.

- Replace the `last` signal (lines 32, 109-110 — it is written and read by its own effect,
  causing a redundant extra pass) with a plain `let last = ""`.
- Rewrite the second effect with a plain `let armed = ""` token:

```ts
let armed = ""

createEffect(() => {
  const id = params.selection()
  if (params.panel() !== SidePanel.Economics || !id || id === LOCAL) {
    armed = ""
    return
  }
  const token = `${key(params.project())}:${id}`
  if (armed === token) return
  armed = token
  request(id)
})
```

Both `let`s are legitimate reassignment per the style guide. Because the effect no longer reads
`details()`, `request()`'s write cannot retrigger it. Clearing `armed` when the panel closes or
selection leaves keeps reopen-refetches working; switching worktree or project while open also
refetches once.

- Drop the now-duplicate `if (opening && id && id !== LOCAL) request(id)` from `toggle()`
  (line 60). `togglePanel` already flips the panel, so the effect owns the fetch; keeping both
  posts two requests per open. `onRefresh` still calls `request` directly and is unaffected.

### 2. `webview-ui/agent-manager/WorktreeEconomicsPanel.tsx` — stop row recreation on refresh

Swap `For` for `Index` on the four positional lists so a manual refresh (or a reopen) updates
text in place instead of tearing down the hovered row and its tooltip trigger:

- `detail().models.slice(0, 6)` (line 250)
- `detail().agents.slice(0, 6)` (line 296)
- `sessions()` (line 330)
- `events()` (line 436)

`Index` yields `(item: Accessor<T>, i: number)`, so each `model`/`agent`/`session`/`event`
reference inside those blocks becomes a call (`model()`, `agent()`, ...). Update the `solid-js`
import: drop `For`, add `Index`. No other JSX changes.

### 3. `webview-ui/agent-manager/agent-manager.css` — bridge the icon-to-popover gap

Add a transparent hit bridge so `.am-economics-info-wrap:hover` stays true while the pointer
crosses the 6px gap, and correct the stale comment at lines 6065-6071 to describe the bridge:

```css
/* Transparent bridge across the 6px offset above the icon. Without it the gap
   belongs to neither the icon nor the popover, so crossing it drops
   `.am-economics-info-wrap:hover` and closes the popover mid-move. */
.am-economics-info-popover::after {
  content: "";
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  height: 8px;
}
```

### 4. `webview-ui/agent-manager/WorktreeEconomicsPanel.tsx` — calm the tooltip chain

On the non-icon `Explain` branch (lines 96-109), use `openDelay={400}` (the wrapper default)
and `skipDelayDuration={0}`, so a pointer merely travelling across the table/chips does not
open anything and each tooltip must earn its own delay rather than opening instantly after a
neighbour closed.

## Test

New `packages/kilo-vscode/tests/unit/worktree-economics-controller.test.ts`, following the
`createRoot` + real-`createSignal` pattern of `tests/unit/project-sessions-live.test.ts` (no
mocks; the controller runs for real and `post` collects the outgoing messages):

1. **requests retained usage once per open** — build the controller with `panel` at
   `SidePanel.Economics` and a selected worktree id; after `createRoot` returns (Solid flushes
   the initial effect then), assert exactly one `agentManager.requestWorktreeUsage`. Feed a
   response through `controller.handle({ type: "agentManager.worktreeUsage", ... })` and assert
   the count is **still one** — this is the regression guard for the loop. Assert
   `controller.selected()` exposes the delivered `detail`/`timeline` with `loading: false`.
2. **refetches after the panel closes and reopens** — flip `panel` to `null`, then back to
   `SidePanel.Economics`, and assert a second request was posted.
3. **refetches when the selected worktree changes while open** — change `selection` and assert
   one additional request for the new id.
4. **requests summaries once per worktree set** — assert a single
   `agentManager.requestWorktreeUsageSummaries` when `worktrees` is re-set to an equal list,
   and a second one after the id set actually changes.

## Verify

From `packages/kilo-vscode/`:

- `bun test tests/unit/worktree-economics-controller.test.ts`
- `bun test tests/unit/agent-manager-arch.test.ts` (the `maxLines` cap covers
  `WorktreeEconomicsPanel.tsx`)
- `bun run typecheck`
- `bun run lint`
- `bun run format` before committing

Manual check in `bun run extension`: open the economics panel, hover a hero card and a model
row. The `(i)` icon must appear once and hold steady, the popover must stay open while the
pointer moves from the icon onto its text, and the Network/console activity must show a single
usage request per open instead of a continuous stream.

No changeset needed: this fixes unreleased work already covered by
`.changeset/worktree-economics-dashboard.md`.
