# JetBrains session transcript scrolling performance — Findings + Plan (A + B + C)

## Goal

Restore smooth scrolling / streaming in the JetBrains chat session UI as the transcript grows large, by eliminating redundant full-transcript re-measurement. Scope is limited to three low/medium-risk changes:

- **A** — Cache width-aware preferred-size measurement in `SessionLayout` (per-child, invalidation-driven).
- **B** — Confine `revalidate()` blast radius by making *settled* turns validate roots.
- **C** — Stop redundant work per event/scroll settle (conditional refresh + narrowed scroll validate).

Out of scope: virtualization/windowing (option E), swapping code-block editors for lighter components (option F), broad disposal-on-collapse changes (option D). These may follow if A+B+C prove insufficient.

All work is in `packages/kilo-jetbrains/frontend/` (Kilo-owned; no `kilocode_change` markers needed).

---

## Findings (root cause + audit)

### Component structure

The transcript is three nested levels of the custom width-measuring layout `SessionLayout`:

```
JBScrollPane / JViewport  ← the validate root (SessionScroll.component)
└─ SessionMessageListPanel   (SessionLayout)   ← contains TurnViews + footer views
   └─ TurnView               (SessionLayout)   ← contains MessageViews
      └─ MessageView          (SessionLayout)  ← contains PartViews
         └─ ToolView / TextView / ReasoningView / ...
            └─ MdViewHybrid: JBHtmlPane blocks + EditorTextField code blocks (EditorFactory-backed)
```

### Root cause of jank

`SessionLayout.preferredLayoutSize()` / `layoutContainer()` (`session/ui/SessionLayout.kt:39-77`) re-measure **every visible child on every pass** via:

```kotlin
comp.setSize(child.width, …)     // force width so HTML reflows
h += comp.preferredSize.height   // read height → expensive JBHtmlPane / editor reflow
```

There is **no caching and no dirty flag**. Because each child is itself a `SessionLayoutPanel`, one top-level measure recurses down to every `JBHtmlPane` and every code-block editor and reflows them — even for turns that finished long ago.

This full re-measure is triggered constantly:

- `SessionMessageListPanel.refresh()` → `revalidate()+repaint()` runs on `ContentAdded`, `ContentUpdated`, `ContentRemoved`, `StateChanged`, `RevertChanged`, `DiffUpdated` (`SessionMessageListPanel.kt:98-160,411-414`).
- Leaf mutations call `revalidate()` on themselves (`TextView.kt:72-78,129-132`; `MdViewHybrid.kt:163-178,242-260`). Swing bubbles `revalidate()` to the nearest **validate root**, which is the scroll pane's `JViewport` (no transcript panel overrides `isValidateRoot`). Validating the viewport re-lays its view = **whole transcript re-measured** — so even the streaming-delta path re-measures everything.
- Follow-tail machinery calls `root.validate()` (full synchronous layout of root incl. header/prompt/overlays) up to 6–12 times per settle cycle via chained `invokeLater` (`SessionScroll.kt:257-350`).

Cost scales with total parts × HTML/editor reflow → linearly worse as the session grows. This matches the reported "scrolling not smooth / delays that worsen with size."

### Answers to the audit questions

1. **Lazy inner content of expandable views?** Yes. `AbstractSessionPartView.body()` builds lazily (`AbstractSessionPartView.kt:154-158`); tool/reasoning bodies are created on first `expand()`.
2. **Disposed after collapse?** Mostly no — retained for reuse. `collapse()` only detaches (`AbstractSessionPartView.kt:84-89`). Only `ReasoningView.releaseBody()` (`ReasoningView.kt:120-137`, on finish) and `EditToolView.swapBody()` (`EditToolView.kt:97-109`, on single/multi boundary) free editors. Not a scroll-perf issue (detached bodies aren't measured); it's a memory/editor-count issue — addressed by option D, out of scope here.
3. **Popovers disposed properly?** Yes. `HeaderPopupController.hideAll()` disposes content + guard and hides the balloon; torn down on scroll/hide/dispose (`HeaderPopupController.kt:66-82`, `SessionUi.kt:377-380,604-612`). No change needed.
4. **Preferred size recomputed for static views? cache + mod-count?** Yes, recomputed every pass with zero caching — this is **option A**, the primary fix. Heavy leaf `getPreferredSize()` overrides (`ToolView.kt:54-60`, `ReadToolView`, `ShellToolView`, `EditToolView`, `TaskToolView`, `BaseSearchToolView`) also recompute per call but are only invoked on cache-miss once A lands.
5. **Virtualization?** Not implemented (option E) — out of scope.

---

## Design decisions

### A — `SessionLayout` measurement cache (invalidation-driven)

**Mechanism: cache keyed by `(child, availableWidth)`, reused only when `child.isValid()`.** Rationale:

- Leans on Swing's existing invalidation graph. A content mutation calls `revalidate()` → `invalidate()` bubbles **only along the path** from the changed leaf to the viewport; sibling subtrees stay valid. So each `SessionLayout` re-measures only children that are invalid (on the change path) and reuses cached heights for the rest. Net cost per update ≈ O(tree depth + changed leaves) instead of O(all parts).
- **Zero leaf changes** — the cache lives entirely in `SessionLayout` (+ minor `SessionLayoutPanel` hook). Minimal merge surface, no new interface threaded through every view.
- **Transparent to existing tests** — cache-hit requires `child.isValid()`; in `SessionLayoutTest` children are never validated, so they always re-measure and produce identical results. Safe by construction: when in doubt, measure.

Cache is correct because `setBounds`/`setSize` with unchanged width+height does not invalidate, so cached children converge to `valid` after one pass and only re-measure when their content or the panel width actually changes.

Rejected alternative: explicit `measureRevision(): Int` interface bumped by every leaf on mutation. More deterministic to unit-test but far larger merge surface and easy to get wrong (every mutation path must bump). Not worth it given the isValid approach.

### B — validate-root isolation for settled turns

Override `isValidateRoot()` on `TurnView` to return `true` only when the turn is **settled** (not the actively streaming turn). Effect: a `revalidate()` inside a completed turn stops at the turn instead of bubbling to the viewport, so hover/repaint/no-op churn in old turns never schedules a viewport relayout.

**Correctness rule (must hold):** a turn may be a validate root only while its own height cannot change via a self-initiated `revalidate()` that relies on bubbling. All height-affecting flows must remain top-down from the panel:

- Theme/style change: `SessionMessageListPanel.applyStyle()` already calls panel-level `refresh()` after per-turn `applyStyle` (`SessionMessageListPanel.kt:437-447`) — top-down, safe.
- Panel width change (viewport resize): handled top-down by `layoutContainer`, independent of validate-root — safe.
- Reverted-visibility toggles and structural add/remove already go through panel-level handlers that call `refresh()` — safe.

**Active-turn tracking:** `SessionMessageListPanel` marks exactly one turn active (the last turn while `state.isBusy()`), all others settled; on transition to Idle, mark all settled. Toggling a turn's settled flag calls one panel-level `revalidate()` so any pending height delta propagates.

Because A already makes a full-panel revalidate cheap, B's incremental benefit is modest; its value is avoiding scheduling viewport relayouts at all from old-turn repaints. Given its correctness subtlety, **B ships behind Registry flag `kilo.session.validateRoots` (default on)** and must pass the propagation tests below before merge. The flag allows disabling B in the field without touching A/C.

### C — stop redundant work

- **C1 (conditional refresh):** thread a `changed: Boolean` return out of `MessageView.upsertPart/removePart/appendDelta` and the `TurnView` structural methods so `SessionMessageListPanel` handlers skip `refresh()` + `syncCopyToolbars()` when a delegated mutation was a no-op (idempotent SSE re-delivery, identical `ContentUpdated`, empty delta). Preserves existing early-returns; adds the boolean plumbing.
- **C2 (narrow scroll validate):** in `SessionScroll.layoutScroll()` (`SessionScroll.kt:347-350`) validate the transcript subtree (`messages`/`component`) instead of the whole `root` (which drags in header, prompt, overlays each pass). Keep the existing `stable`-based early termination; consider reducing `FOLLOW_PASSES`/`OPEN_PASSES` only after A/B land and heights settle in fewer passes.

---

## Implementation tasks (ordered)

### Task 0 — Rollout flag

- [ ] Add `Registry.is("kilo.session.validateRoots", true)` gating **B only** (default on). **A and C are unconditional / default-on** (no flag). Read the flag where `TurnView.isValidateRoot` decides. Follow the existing pattern (`Registry.is("kilo.session.condense", true)` in `SessionUi.kt:148`). No new `Config.Info` key needed (Registry only). Rationale: A is transparent to tests and safe-by-construction; C only removes no-op work; B is the sole change with a height-propagation risk, so it gets the revert switch.

### Task A — measurement cache in `SessionLayout`

- [ ] In `SessionLayout` add an instance field `private val cache = IdentityHashMap<Component, LongArray?>()` (or a small `data class Measured(val width: Int, val height: Int)`), scoped per panel since each `SessionLayoutPanel` constructs its own `SessionLayout`.
- [ ] Extract a `measure(comp, width): Int` helper used by both `preferredLayoutSize` and `layoutContainer`:
  - if `comp.isValid()` **and** `cache[comp]?.width == width` → return cached height (skip `setSize` + `preferredSize`).
  - else → `comp.setSize(width, comp.height.coerceAtLeast(1))`, read `comp.preferredSize.height`, store `Measured(width, h)`, return `h`.
- [ ] `layoutContainer` cache-hit path must still `setBounds(child.left, y, width, h)` (position update; no-op size = no invalidate).
- [ ] Evict on removal: implement `removeLayoutComponent(comp)` to `cache.remove(comp)` (currently a no-op at `SessionLayout.kt:37`).
- [ ] A is unconditional. The `isValid()` gate keeps behavior identical for invalid children, so `SessionLayoutTest` (children are never validated) stays green with no flag involved.

### Task B — settled-turn validate roots

- [ ] `TurnView`: add `private var settled = true`, `fun setSettled(value: Boolean)` (revalidate on change), and `override fun isValidateRoot() = Registry.is("kilo.session.validateRoots", true) && settled`.
- [ ] `SessionMessageListPanel`: compute the active turn (last turn while `model.state.isBusy()`); call `setSettled(false)` on it and `setSettled(true)` on all others. Recompute on `TurnAdded`, `TurnRemoved`, `StateChanged`, and full `rebuild()`. On Idle, all settled.
- [ ] Verify no code path mutates a settled turn's height via a local `revalidate()` without a panel-level refresh (see Correctness rule). If any is found (audit `syncCopyToolbars`, `setReverting`, `PromptWrap`), route it through a panel refresh or exclude that turn from settled.

### Task C — redundant work removal

- [ ] C1: change `MessageView.upsertPart`, `removePart`, `appendDelta` (and any `TurnView` add/remove used by the panel) to return `Boolean` (`true` when something actually changed). Keep their internal subtree `refresh()` but let the panel decide its own refresh. Update `SessionMessageListPanel` handlers (`SessionMessageListPanel.kt:98-160`) to call `refresh()`/`syncCopyToolbars()` only when `changed`.
- [ ] C2: `SessionScroll.layoutScroll()` → validate `component` (the `JBScrollPane`) or `messages` view instead of `root`. Confirm `SessionScroll.preserve()` (`SessionScroll.kt:164-193`) still restores the anchor correctly with the narrowed validate.

---

## Risks & mitigations

- **Stale/incorrect cached heights (A):** only reuse when `child.isValid()`; measure otherwise. Worst case is a missed optimization, never a wrong size. Add stress test asserting heights match a from-scratch measure after churn.
- **Height fails to propagate from a settled turn (B):** enforce the top-down correctness rule; gate behind the flag; add explicit propagation tests (theme change, late width change, revert toggle). If any regression, disable B via flag without touching A/C.
- **`IdentityHashMap` growth (A):** bounded by a panel's own child count and evicted in `removeLayoutComponent`; entries GC with the panel. Add a leak test asserting cache size returns to baseline after clear/rebuild.
- **Interaction with `SessionScroll` anchoring (C2):** validate the correct subtree so `viewPosition`/`bar.value` math in `preserve`/`followPass` still holds; covered by scroll tests.
- **Merge conflicts:** all edits are in Kilo-owned `packages/kilo-jetbrains/frontend/` — no upstream `kilocode_change` markers required.

---

## Test plan

Run from `packages/kilo-jetbrains/`: `./gradlew typecheck` then `./gradlew test`. Requires Java 21 (only diagnose Java if Gradle reports a Java error).

- [ ] **`SessionLayoutTest` additions:** with a realized/validated container, assert a valid child is not re-measured (e.g., a probe child that counts `getPreferredSize` calls, or asserting cached-height reuse) and that a width change or `invalidate()` forces re-measure. Confirm all existing cases still pass unchanged (children are never validated there, so they always re-measure).
- [ ] **New `SessionMessageListPanel` stress test** (mirror `MdViewHybridStressTest`): drive hundreds of `ContentDelta`/`ContentUpdated`/`TurnAdded` events across many turns via the public event flow; assert (a) retained view instances stay identical (`assertSame`), (b) component counts stay bounded, (c) `EditorFactory.getInstance().allEditors.size` returns to baseline after clear/dispose, (d) measurement cache reuse — measured child count per streamed delta stays roughly constant instead of scaling with transcript size.
- [ ] **B propagation tests:** after streaming completes (all turns settled), assert a theme/style change and a width change still reflow the transcript to correct heights; assert a settled turn is a validate root and the streaming turn is not.
- [ ] **C1 no-op tests:** re-delivering an identical `ContentUpdated`/empty delta does not `revalidate()` the panel (assert via a revalidate probe or unchanged layout counters). Aligns with existing AGENTS.md guidance ("no-op updates … should not repaint/revalidate the whole view").
- [ ] **C2 scroll tests:** follow-tail and `scrollMessageBottom` still land at the correct position with the narrowed validate.

Tests must exercise the real implementation on the real EDT (extend `BasePlatformTestCase` / `SessionControllerTestBase`); do not mock EDT or threading.

---

## Validation / done criteria

- `./gradlew typecheck` and `./gradlew test` pass from `packages/kilo-jetbrains/`.
- Manual check under `./gradlew --no-configuration-cache runIdeSplitMode` with a large session: scrolling and streaming stay smooth; measured-child work per delta does not grow with transcript length (profile time in `SessionLayout.layoutContainer` / `JBHtmlPane` reflow before vs after).
- A changeset added (`.changeset/*.md`, `patch`) describing the user-facing fix ("Improve chat scrolling performance in large sessions").

---

## Resolved decisions

- **Rollout (resolved):** A and C ship unconditionally, default-on (low risk, transparent to tests). B ships behind Registry flag `kilo.session.validateRoots`, **default on**, and must pass the B propagation tests before merge; the flag is the field revert switch if a rendering artifact appears.
- **Cache mechanism (resolved):** `isValid()`-gated per-child cache in `SessionLayout` (no leaf-level `measureRevision` interface).

## Assumptions

- Marking the streaming turn as the single non-settled turn is sufficient to keep height propagation correct; the implementer must audit `syncCopyToolbars`, `setReverting`, and `PromptWrap` for any settled-turn height change that relies on `revalidate()` bubbling and route it through a panel-level refresh (or exclude that turn from settled).
