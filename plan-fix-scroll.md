# Plan: Fix Autoscroll in VS Code Extension

## Problem

Autoscroll frequently disengages silently during normal use — the user never scrolled up, but the chat stops following new content. The root cause is false-positive `userScrolled` detection triggered by layout shifts.

## Root Cause Analysis

The autoscroll hook (`packages/kilo-ui/src/hooks/create-auto-scroll.tsx`) uses time-based heuristics to distinguish programmatic scrolls from user scrolls. The protection has two layers:

1. **`markAuto`/`isAuto`**: After a programmatic `scrollToBottom()`, a 250ms marker suppresses the `handleScroll` handler from treating the resulting scroll event as user-initiated.
2. **100ms debounce on `stop()`**: `handleScroll` debounces the `stop()` call to avoid reacting to transient layout shifts.

These fail when:

- Content arrives in bursts with >250ms gaps (the auto marker expires before the next scroll event)
- DOM layout takes longer than the debounce window (e.g., syntax highlighting, markdown rendering)
- Multiple ResizeObserver callbacks and scroll events interleave in ways the timing can't predict

Once `userScrolled` flips to `true`, autoscroll is silently broken until the user clicks the scroll-to-bottom button.

## Design Insight: Remove `active()` / busy-idle distinction

The current code gates ResizeObserver autoscrolling behind `active()` (`working() || settling`). The rationale was: "when idle, content changes are user-initiated (expanding tool output, toggling diffs), so don't autoscroll." But this is wrong — the same interactions happen during busy too, and the user may expand a tool output while watching a stream. The busy/idle state of the session has nothing to do with whether autoscroll should fire.

The correct signal is **`userScrolled` alone**:

- If the user hasn't scrolled away from the bottom, any content resize should scroll to keep the bottom visible — regardless of busy/idle. This includes tool output expanding, markdown rendering, streaming text, etc.
- If the user has scrolled up (to re-read something, inspect a tool output, etc.), no content resize should yank them back — regardless of busy/idle.

Removing the `active()` gate also eliminates the need for:

- The 300ms `settling` hack (which exists only because idle fires before final content renders)
- The `working()` transition effect that force-scrolls on busy start

The `working()` signal becomes irrelevant to the scroll logic entirely. The hook only needs to know: is the user at the bottom or not?

## Proposed Changes

### 1. Remove `active()`, `settling`, and `working` from scroll logic

**File**: `packages/kilo-ui/src/hooks/create-auto-scroll.tsx`

- Remove the `settling` flag, `settleTimer`, and the `createEffect(on(options.working, ...))` block
- Remove the `active()` function
- In the ResizeObserver callback, remove the `if (!active()) return` guard — only check `userScrolled`
- Keep `working` in the options interface for now (consumers pass it), but don't use it for gating scroll

The ResizeObserver becomes simply:

```ts
createResizeObserver(
  () => store.contentRef,
  () => {
    const el = scroll
    if (el && !canScroll(el)) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }
    if (store.userScrolled) return
    scrollToBottom(false)
  },
)
```

### 2. Replace `markAuto`/`isAuto` with a deterministic flag

Replace the `auto` timestamp + 250ms timer with a `programmatic` boolean that's set before `scrollTo` and cleared after the browser processes the scroll event via `requestAnimationFrame`:

```ts
let programmatic = false

const scrollToBottomNow = (behavior: ScrollBehavior) => {
  const el = scroll
  if (!el) return
  programmatic = true
  if (behavior === "smooth") {
    el.scrollTo({ top: el.scrollHeight, behavior })
  } else {
    el.scrollTop = el.scrollHeight
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      programmatic = false
    })
  })
}
```

In `handleScroll`, replace `isAuto(el)` with `programmatic`:

```ts
if (!store.userScrolled && programmatic) {
  scrollToBottom(false)
  return
}
```

### 3. Remove the 100ms debounce on `stop()`

With the deterministic `programmatic` flag, the debounce is less critical. Replace it with a spatial threshold: during any content resize that isn't user-initiated scrolling, require the scroll to be >50px from bottom before considering it a user scroll. This is more robust than time-based debouncing.

### 4. Add wheel event threshold

In `handleWheel`, ignore tiny upward `deltaY` values (trackpad noise / inertia):

```ts
const handleWheel = (e: WheelEvent) => {
  if (e.deltaY >= -2) return
  // ... rest of handler
}
```

### 5. Clean up unused infrastructure

Remove `auto`, `autoTimer`, `settleTimer`, `settling`, `markAuto()`, `isAuto()`, and the `active()` function.

### 6. Simplify `scrollToBottom`

Without the `active()` gate, `scrollToBottom(force=false)` only checks `userScrolled`:

```ts
const scrollToBottom = (force: boolean) => {
  const el = scroll
  if (!el) return
  if (!force && store.userScrolled) return
  if (force && store.userScrolled) setStore("userScrolled", false)
  if (distanceFromBottom(el) < 2) return
  scrollToBottomNow("auto")
}
```

## What About Idle Interactions?

With `active()` removed, won't expanding a collapsed tool output when idle yank the scroll?

No — if the user is at the bottom when they click to expand, scrolling to bottom is correct (they want to see the expanded content). If they scrolled up to find the tool output, `userScrolled` is `true` and the ResizeObserver won't scroll. The `userScrolled` flag already handles this correctly. The `active()` guard was redundant protection that also caused the settling bug.

The one edge case is: user is at the bottom, expands something mid-page that pushes content below the fold. This would scroll to bottom, hiding the thing they just expanded. But this is also the current behavior during busy — `active()` doesn't protect against it. A proper fix for that (scroll to keep the expanded element in view) is a separate concern.

## Test Plan

1. Stream a long response — verify scroll stays pinned to bottom throughout
2. During streaming, hover cursor over chat and rest hand on trackpad — verify no false disengage
3. During streaming, manually scroll up — verify autoscroll stops and button appears
4. Click scroll-to-bottom button — verify autoscroll re-engages
5. Send a message at the end of a conversation — verify the optimistic message scrolls into view
6. Wait for a response to complete — verify the last content is visible (no more settling cutoff)
7. After completion while at bottom, expand a collapsed tool output — verify scroll follows
8. After completion, scroll up, expand a tool output — verify scroll does NOT yank to bottom
9. Dismiss a permission prompt while agent is busy — verify scroll resumes
10. Switch sessions — verify scroll resets appropriately
