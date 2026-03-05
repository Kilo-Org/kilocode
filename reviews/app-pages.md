# Review: App Pages (PR #6622 — OpenCode v1.2.16)

## Files Reviewed

| #   | File                                                                     | +/-         | Status   |
| --- | ------------------------------------------------------------------------ | ----------- | -------- |
| 1   | `packages/app/src/pages/layout.tsx`                                      | +234 / -126 | modified |
| 2   | `packages/app/src/pages/layout/helpers.test.ts`                          | +99 / -1    | modified |
| 3   | `packages/app/src/pages/layout/helpers.ts`                               | +37 / -5    | modified |
| 4   | `packages/app/src/pages/layout/sidebar-items.tsx`                        | +24 / -13   | modified |
| 5   | `packages/app/src/pages/layout/sidebar-project.tsx`                      | +43 / -16   | modified |
| 6   | `packages/app/src/pages/session.tsx`                                     | +381 / -217 | modified |
| 7   | `packages/app/src/pages/session/composer/session-composer-region.tsx`    | +81 / -16   | modified |
| 8   | `packages/app/src/pages/session/composer/session-composer-state.test.ts` | +22 / -0    | modified |
| 9   | `packages/app/src/pages/session/composer/session-composer-state.ts`      | +19 / -4    | modified |
| 10  | `packages/app/src/pages/session/composer/session-request-tree.ts`        | +12 / -5    | modified |
| 11  | `packages/app/src/pages/session/composer/session-todo-dock.tsx`          | +173 / -65  | modified |
| 12  | `packages/app/src/pages/session/file-tabs.tsx`                           | +212 / -310 | modified |
| 13  | `packages/app/src/pages/session/message-timeline.tsx`                    | +262 / -42  | modified |
| 14  | `packages/app/src/pages/session/review-tab.tsx`                          | +81 / -65   | modified |
| 15  | `packages/app/src/pages/session/session-side-panel.tsx`                  | +140 / -121 | modified |
| 16  | `packages/app/src/pages/session/terminal-panel.tsx`                      | +3 / -3     | modified |
| 17  | `packages/app/src/pages/session/use-session-hash-scroll.ts`              | +26 / -16   | modified |

**Total:** +1,816 / -1,024 across 17 files

---

## Summary

This is a substantial UI/UX overhaul of the `packages/app/` pages layer. The changes fall into five major themes:

1. **Session history windowing** — The inline turn-backfill logic (idle-callback batching in `session.tsx`) is replaced by `createSessionHistoryWindow`, a standalone reactive function that manages a bounded render window with scroll-driven progressive reveal and server-side prefetch. A companion `createTimelineStaging` in `message-timeline.tsx` adds staged DOM mounting for initial paint performance.

2. **Project navigation hardening** — `navigateToProject` is now `async` and performs multi-step resolution (last session → local latest → server fetch) with `effectiveWorkspaceOrder` (renaming/rewriting `syncWorkspaceOrder`) using `workspaceKey`-based deduplication. Workspace deletion, project closing, and route-sync effects are refactored for correctness.

3. **Permission-aware filtering** — `sessionTreeRequest`, `hasProjectPermissions`, and all sidebar/composer consumers now accept an `include` filter, allowing auto-responded permissions to be excluded from badge counts and composer block state. This threads through sidebar icons, session items, and composer state.

4. **Spring-based animation system** — The todo dock and composer region replace CSS transition classes with `useSpring`-driven numeric interpolation, `AnimatedNumber`, `TextReveal`, and `TextStrikethrough` components. All animation timing is now prop-configurable.

5. **File tab & review refactoring** — `file-tabs.tsx` delegates to `useFileComponent` (replacing `useCodeComponent`), uses `createLineCommentController` for unified comment management, adds file search (`Cmd+F`), and moves media rendering (image/SVG/binary) into the `<Dynamic>` file component's `media` prop. The review tab and side panel simplify layout branching and add comment edit/delete support.

---

## Detailed Findings

### 1. `packages/app/src/pages/layout.tsx`

**Workspace order: effect → memo conversion**
The `createEffect` that called `syncWorkspaceOrder` and wrote to `store.workspaceOrder` is replaced by `visibleSessionDirs`, a pure `createMemo`. The old effect had three nearly-identical `setStore` branches for different dirty-check conditions — the new memo eliminates that duplication and moves session loading into a separate deferred `on(visibleSessionDirs, ...)` effect. This is a clean improvement.

**`navigateToProject` is now async with multi-step fallback**
The function now does: check `lastProjectSession` → verify workspace exists (may fetch worktree list from server) → try `latestRootSession` from local stores → fetch session lists from server → fallback to bare route. This is significantly more robust for scenarios where a workspace was deleted or sessions haven't been synced yet.

- _Potential concern:_ The `openSession` inner function calls `sdk.client.session.get()` to validate the session before navigating. If the server is slow, the user may perceive a click delay with no visual feedback. No loading state is set before the `await` chain.
- _Potential concern:_ `refreshDirs` catches errors silently (`catch(() => [] as string[])`), which is fine for resilience but means a network failure is invisible.

**Removal of `server.projects.touch` effect**
The standalone `createEffect` that called `server.projects.touch(project.worktree)` on project change is removed. Touch is now called explicitly inside `touchProjectRoute()`, invoked from the route-sync effect. This is more intentional and avoids the old race where the effect could fire before layout was ready.

**Route-sync effect refactor**
The `createEffect(on(...params.dir, params.id...))` now uses a mutable `activeRoute` object for dedup instead of `{ defer: true }` alone. The new logic separates "touch project" from "sync session route" and handles the case where `params.id` is undefined (project-level navigation without a session). The `scrollToSession` call is moved from scattered `queueMicrotask` sites into `syncSessionRoute`, centralizing it.

**`closeProject` edge-case handling**
The function now distinguishes between closing the active project vs. a non-active project and handles the empty-list case. The old code unconditionally closed then navigated, which could flash-navigate to `undefined`.

**`deleteWorkspace` navigation fix**
Adds `leaveDeletedWorkspace` parameter and navigates away _before_ deletion begins if the user is currently viewing the deleted workspace. Previously, the user could remain on a stale route during the async delete.

**Workspace order no longer stores root**
`setStore("workspaceOrder", ...)` now filters out the root workspace key. `effectiveWorkspaceOrder` always prepends `local` first, so persisting it was redundant and could cause stale entries.

**`SidebarPanel` conditional rendering**
Changed from `<SidebarPanel project={currentProject()} />` to `<Show when={currentProject()} keyed>{(project) => ...}`. This prevents rendering when `currentProject()` is undefined and avoids potential null-prop errors.

### 2. `packages/app/src/pages/layout/helpers.test.ts`

New tests for `latestRootSession` (basic, archived/child filtering) and `hasProjectPermissions` (with/without filter). Good coverage of the new helpers. The `session()` factory is well-structured with required `id` + `directory` fields.

No concerns.

### 3. `packages/app/src/pages/layout/helpers.ts`

**`effectiveWorkspaceOrder` replaces `syncWorkspaceOrder`**
The new implementation uses a `Map<string, string>` keyed by `workspaceKey` to deduplicate and match persisted order against live directories. This correctly handles the case where a workspace path changes but its key remains the same.

`syncWorkspaceOrder` is preserved as an alias (`export const syncWorkspaceOrder = effectiveWorkspaceOrder`) to avoid breaking the existing test import. The test file still imports `syncWorkspaceOrder`, confirming backward compatibility.

**`latestRootSession`**
FlatMaps across stores, filters by `isRootVisibleSession`, sorts by `sortSessions`, returns `[0]`. Clean and correct.

**`hasProjectPermissions`**
Generic helper with optional `include` filter. Simple, well-typed.

### 4. `packages/app/src/pages/layout/sidebar-items.tsx`

**Permission-aware badge in `ProjectIcon`**
Adds `hasPermissions` memo that checks all project directories for non-auto-responded permissions. The badge now shows a warning color (`bg-surface-warning-strong`) when permissions are pending, overriding the error/interactive colors.

- _Behavioral change:_ Previously, badges only showed for unseen message counts. Now a project icon can show a badge dot with zero unseen messages if there are pending permissions. This is intentionally more informative.

**`SessionItem.hasPermissions` refactored**
Previously manually iterated child session permissions. Now delegates to `sessionPermissionRequest` with the `include` filter. Functionally equivalent but uses the shared tree-walk logic, which is more maintainable and consistent with the composer.

### 5. `packages/app/src/pages/layout/sidebar-project.tsx`

**`createSignal` → `createStore` for project tile state**
Consolidates `open`, `menu`, and new `suppressHover` into a single store. The `suppressHover` mechanism prevents the hover card from immediately reopening after the user clicks the already-selected project (which now toggles the sidebar).

**Click-on-selected-project toggles sidebar**
New behavior: clicking the selected project icon in the collapsed sidebar toggles the sidebar open/closed instead of re-navigating. `suppressHover` ensures the hover card doesn't fight with this interaction.

**HoverCard disabled when selected**
`<Show when={preview() && !selected()}>` — the hover card is completely unmounted for the selected project in preview mode, falling back to the plain tile. This prevents a flash of the hover card when the sidebar toggles.

### 6. `packages/app/src/pages/session.tsx`

This is the largest change in the group (+381/-217).

**`createSessionHistoryWindow`**
Extracted outside the component as a standalone reactive function. Key design:

- `turnInit=10`: initial paint shows last 10 turns.
- `turnBatch=8`: scrolling up reveals 8 more turns per batch.
- `turnScrollThreshold=200px`: triggers backfill when scrollTop < 200px.
- `prefetchCooldownMs=400` / `prefetchNoGrowthLimit=2`: rate-limits server prefetch.
- `preserveScroll`: captures `scrollHeight` before mutation, adjusts `scrollTop` in `requestAnimationFrame`. This is the standard technique but note that there's a single-frame gap where scroll position may be wrong.
- `loadAndReveal`: used by the "Load earlier" button — reveals all cached, fetches more, reveals one batch.
- Session switch resets prefetch counters via `on(input.sessionID, ...)`.

The old implementation used `requestIdleCallback` with `cancelIdleCallback` and a recursive `scheduleTurnBackfill` pattern. The new implementation is scroll-event-driven (`onScrollerScroll`) and does not auto-backfill in the background, which is simpler but means users with very long sessions must scroll to reveal history. The old behavior would eventually reveal everything; the new behavior stops at the visible window. This is likely intentional for performance.

**`deferRender` state**
A new `createComputed` sets `deferRender=true` on session key change, then clears it after `requestAnimationFrame + setTimeout(0)`. The review panel `Switch/Match` is wrapped in `<Show when={!store.deferRender}>`, causing a one-frame blank during session switches. This prevents stale diff data from flashing.

**Tab normalization effect removed**
The `createEffect` that called `normalizeTabs` and `setAll` is removed. Unclear where this normalization now happens — it may have been moved to a context or is handled by the file component changes.

**Session sync effect wrapped in `untrack`**
`sync.session.sync(id)` and `sync.session.todo(id)` are now inside `untrack()` to prevent reactive loops. Good defensive measure.

**Comment edit/delete support added**
New `updateCommentInContext` and `removeCommentFromContext` functions. `reviewCommentActions` memo provides i18n labels. These are passed to all three `SessionReviewTab` instances.

**Keyboard handler hardening**
`handleKeyDown` now uses `event.composedPath()` to walk the event path and `deepActiveElement()` to traverse shadow DOM boundaries. The `protectedTarget` check walks `composedPath` for `[data-prevent-autofocus]`. This fixes edge cases where keyboard shortcuts could fire inside shadow DOM input elements (e.g., web components in the code viewer).

**`reviewTab` condition simplified**
Both `session.tsx` and `session-side-panel.tsx` change from `isDesktop() && !layout.fileTree.opened()` to just `isDesktop()`. The review tab is now always available on desktop regardless of file tree state. This is a layout behavior change.

**Changes select `size` changed**
The changes dropdown changed from `size="large"` to `size="small"` with explicit `valueClass="text-14-medium"`.

**`centered` condition changed**
From `!desktopSidePanelOpen()` to `!desktopReviewOpen()`. The main session content now centers when the review panel is closed, even if the file tree is open. This is a layout behavior change.

### 7. `packages/app/src/pages/session/composer/session-composer-region.tsx`

**Spring-based dock animation**
Replaces CSS transition classes (`transition-[max-height,opacity,transform] duration-[400ms]`) with `useSpring` driving a `value` 0→1. The dock tray height is now `full() * value()` pixels, and the prompt's negative margin is `-36 * value()` pixels. All timing parameters are exposed as optional props.

- `pointer-events-none` when `value < 0.98` — prevents interaction during animation.
- `ResizeObserver` on the content ref updates the `height` signal for accurate spring targets.

**Prop surface area**
17 new optional props for animation tuning. These are pass-through to `SessionTodoDock`. This is a wide prop interface but reasonable for a component designed to be animation-tunable.

### 8. `packages/app/src/pages/session/composer/session-composer-state.test.ts`

Two new tests for the `include` filter parameter on `sessionPermissionRequest`:

- "skips filtered permissions in the current tree"
- "returns undefined when all tree permissions are filtered out"

Correct and targeted.

### 9. `packages/app/src/pages/session/composer/session-composer-state.ts`

**Permission filtering in composer**
Both `createSessionComposerBlocked` and `createSessionComposerState` now pass `(item) => !permission.autoResponds(item, sdk.directory)` as the include filter. Auto-responded permissions no longer block the composer input.

**`createSessionComposerState` accepts `options`**
New `closeMs` option (number or function) replaces the hardcoded `400ms` timeout for closing the dock. This enables animation-duration coordination from the parent.

### 10. `packages/app/src/pages/session/composer/session-request-tree.ts`

**`include` filter added to `sessionTreeRequest`**
The core tree-walk now uses `request[id]?.some(include)` and `request[id]?.find(include)` instead of `!!request[id]?.[0]` and `request[id]?.[0]`. Both `sessionPermissionRequest` and `sessionQuestionRequest` expose the optional `include` parameter.

This is a backward-compatible change (default `include` returns `true`).

### 11. `packages/app/src/pages/session/composer/session-todo-dock.tsx`

**Major animation overhaul**

- `For` → `Index` for todo items (preserves DOM nodes on reorder, important for animations).
- `TextStrikethrough` replaces inline `text-decoration: line-through`.
- `AnimatedNumber` for done/total counts with rolling-digit animation.
- `TextReveal` for the collapsed preview text.
- `useSpring` drives the collapse/expand and dock-open animations.
- `ResizeObserver` on `contentRef` for accurate height targets.
- Inline styles for `opacity`, `filter: blur()`, and `max-height` driven by spring values.

**Behavioral note:** The `hidden` attribute on the todo list is replaced by `visibility: hidden` + opacity/blur animation, which means the list is always in the DOM (not display:none). This is necessary for the spring animation to work but may have minor performance implications for very long todo lists.

**17 new animation props** mirror those on `session-composer-region.tsx`.

### 12. `packages/app/src/pages/session/file-tabs.tsx`

This is the second-largest change in the group (+212/-310, net -98 lines).

**`useCodeComponent` → `useFileComponent`**
The rendering pipeline switches from a code-only component to a file component that handles media rendering internally. All image/SVG/binary detection logic (`isImage`, `isSvg`, `isBinary`, `svgContent`, `svgDecodeFailed`, `svgPreviewUrl`, `imageDataUrl`) is removed — the `<Dynamic>` component now receives a `media` prop with `mode: "auto"`, `path`, `current` (content), `onLoad`, and `onError` callbacks.

**Line comment controller extraction**
The manual `note` state, `findMarker`, `markerTop`, `updateComments`, `scheduleComments`, and inline `<LineCommentView>`/`<LineCommentEditor>` JSX are replaced by `createLineCommentController` from `@opencode-ai/ui/line-comment-annotations`. This controller provides `annotations()`, `renderAnnotation`, `renderHoverUtility`, and event handlers (`onLineSelected`, `onLineSelectionEnd`, `onLineNumberSelectionEnd`).

- Comment edit/delete: `updateCommentInContext` and `removeCommentFromContext` are wired via the controller's `onUpdate`/`onDelete` callbacks.
- `FileCommentMenu` component provides the dropdown for edit/delete actions.

**File search (Cmd+F)**
New `search` object with `register` callback passed to the file component. A `keydown` listener on `window` (capture phase) intercepts `Cmd+F`/`Ctrl+F` and calls `find?.focus()`.

**Scroll restore consolidation**
Three separate `createEffect(on(...))` for `state()?.loaded`, `file.ready()`, and `tabs().active()` are merged into a single `createEffect` with a `prev` state tracker. `queueRestore` debounces via `requestAnimationFrame`.

**Selection handling**
`activeSelection` now returns `note.selected ?? selectedLines()`, and the controller's `syncSelected` clones the range before passing to `file.setSelectedLines`. This prevents shared-reference mutation bugs.

### 13. `packages/app/src/pages/session/message-timeline.tsx`

**`createTimelineStaging`**
A staged DOM mounting system for initial session loads. When `turnStart > 0` (windowed), it mounts only `init=1` turns first, then reveals `batch=3` per animation frame using `startTransition`. Once all rendered messages are staged, it marks the session as completed and never re-stages.

- `isStaging()` suppresses the "scroll to bottom" button during staging to prevent jarring jumps.

**Scroll event forwarding**
`onTurnBackfillScroll` is called on every scroll event to let the history window's `onScrollerScroll` detect when to backfill.

**Turn rendering refactored**

- `For each={props.renderedUserMessages}` → `For each={rendered()}` where `rendered` is a memo of message IDs only.
- Each turn now computes `active` (is this the turn being processed?), `queued` (is this after the active turn?), and `comments` (extracted from message parts).
- `lastUserMessageID` prop removed — active turn detection is now done locally via `activeMessageID()` which inspects `pending()` assistant messages and `sessionStatus`.
- Comment cards are rendered above each user turn showing file path, line range, and comment text.

**"Render earlier" / "Load earlier" buttons merged**
Previously two separate buttons. Now a single "Load earlier" button that calls `historyWindow.loadAndReveal()`, which handles both revealing cached turns and fetching from server.

### 14. `packages/app/src/pages/session/review-tab.tsx`

**`StickyAddButton` simplified**
The scroll-position tracking (`IntersectionObserver` + `ResizeObserver` + scroll handler to detect "stuck" state) is completely removed. The button now always uses `bg-background-stronger` with no conditional border. This is a visual simplification.

**Scroll restore rewrite**

- `userInteracted` flag: once the user scrolls, touches, or clicks in the review tab, automatic scroll restoration stops. This prevents the common bug where saved scroll position fights with user intent.
- Event listeners for `wheel`, `pointerdown`, `touchstart`, `keydown` mark interaction.
- `restored` object tracks the last programmatic scroll position to filter out the scroll event it causes.
- `queueRestore` debounces with `requestAnimationFrame` and checks `layout.ready()`.
- `doRestore` validates element dimensions are non-zero before restoring.

**Comment edit/delete props**
`onLineCommentUpdate`, `onLineCommentDelete`, and `lineCommentActions` are threaded through to `SessionReview`.

**Layout class changes**

- Root class: `pb-6 pr-3` → `pr-3` (bottom padding removed).
- Review trigger: removed `!pl-6` class override.
- Review count badge: removed the pill-style container div.

### 15. `packages/app/src/pages/session/session-side-panel.tsx`

**Review tab always shown**
`reviewTab` condition changes from `isDesktop() && !layout.fileTree.opened()` to `isDesktop()`. The tab bar now always includes the review tab, and the file-tree "changes" view no longer replaces it.

**Layout branch simplification**
The `<Show when={fileTreeTab() === "changes"} fallback={...}>` wrapper that swapped the entire tab bar for the review panel is removed. The `DragDropProvider` and full tab system is now always rendered when `reviewOpen()`. This eliminates the jarring layout swap when toggling the file tree.

**Two removed effects**

- The effect that auto-switched to the review tab when file tree tab was "changes" is removed.
- The effect that auto-switched to the first file tab or context tab when file tree was "all" is removed.
  These auto-tab-switching behaviors are no longer needed since the review tab is always present.

**File tree scroll shadow**
New `fileTreeScrolled` state driven by `syncFileTreeScrolled` on scroll events. The `<Tabs.List>` receives `data-scrolled` attribute when the tree is scrolled, enabling CSS-based shadow effects.

**Drag overlay cleanup**
The drag preview changes from a hardcoded styled div to `data-component="tabs-drag-preview"`, delegating styling to CSS.

### 16. `packages/app/src/pages/session/terminal-panel.tsx`

Refactors the terminal auto-close logic from nested `if` statements to early returns. Functionally identical — when all terminals are removed, the panel closes. The `close()` function is called instead of `view().terminal.toggle()`, but this appears to be a direct equivalent.

### 17. `packages/app/src/pages/session/use-session-hash-scroll.ts`

**Pending message consumption inlined**
The `createEffect(on(input.sessionKey, ...))` that consumed pending messages is removed. The consumption now happens inline during the main sync effect, using a `pendingKey` variable to track the last-processed session key. This avoids a separate reactive chain and ensures the pending message is consumed in the same tick as the scroll resolution.

**`scheduleTurnBackfill` removed from interface**
The hash-scroll hook no longer calls `scheduleTurnBackfill` after adjusting `turnStart`. The history window's `onScrollerScroll` handler now handles backfill when the scroll position is near the top.

**`onMount` for scroll restoration**
`window.history.scrollRestoration = "manual"` is set on mount, and the `hashchange` listener is registered unconditionally rather than inside a reactive effect. The handler still guards on `sessionID` and `messagesReady`.

---

## Risk to VS Code Extension

**Medium risk.** The VS Code extension webview uses the same `packages/app/` SolidJS frontend but communicates through the `@kilocode/sdk`. Key risk areas:

1. **Review tab always visible (`reviewTab` condition change):** The review tab no longer hides when the file tree is open. The extension's sidebar panel may have different layout expectations. If the extension manages file tree state differently, the tab bar could show tabs that don't make sense in the extension context. Need to verify the extension's `isDesktop()` and `layout.fileTree` behavior.

2. **`navigateToProject` is now async:** The extension may call `navigateToProject` from webview message handlers. If the extension expects synchronous navigation completion (e.g., checking the route immediately after calling it), this could cause race conditions. The extension should be tested for project-switch flows.

3. **Spring animations and `useSpring` dependency:** The new animation system pulls in `@opencode-ai/ui/motion-spring`, `@opencode-ai/ui/animated-number`, `@opencode-ai/ui/text-reveal`, and `@opencode-ai/ui/text-strikethrough`. If the extension bundles `packages/app/` differently or these UI packages are not included in the build, there could be runtime errors.

4. **`useFileComponent` replacing `useCodeComponent`:** The file tab renderer changed its context provider. If the extension provides `useCodeComponent` but not `useFileComponent`, file viewing will break. This requires the extension's webview setup to be updated in tandem.

5. **Permission-aware badge and `usePermission` context:** Sidebar items now call `usePermission()`. If the extension's webview doesn't provide this context, it will throw. This context needs to be available in the extension's provider tree.

6. **Keyboard handler using `composedPath` and shadow DOM traversal:** The VS Code extension runs in a webview which may have different shadow DOM boundaries. The `deepActiveElement` shadow DOM walk should be safe, but worth testing in the extension webview specifically.

---

## Overall Risk

**Medium-High.** This is a large, well-structured refactor that touches critical user flows: session navigation, history rendering, project switching, file viewing, and review commenting. The individual changes are generally improvements (better state management, unified permission filtering, extracted utilities with tests). However:

- The sheer breadth of changes (17 files, ~2,800 changed lines) across layout, routing, state management, and rendering makes it difficult to fully verify correctness without integration testing.
- The `navigateToProject` async conversion with multi-step fallback is the highest-risk individual change — it introduces multiple `await` points with error swallowing and no loading state.
- The removal of auto-tab-switching effects in the side panel could cause user-visible behavior changes that may be perceived as regressions.
- The animation system overhaul is low-risk functionally but adds complexity and new component dependencies.

Testing should focus on: project switching with deleted workspaces, long session history scrolling, file tab rendering of different media types, and review tab scroll restoration after session changes.
