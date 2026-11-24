// Tracks whether the enclosing SessionView / DiffPanel is the currently visible slot.
// Defaults to true for single-view surfaces (sidebar, subagent inspector, tests);
// Agent Manager caches provide a reactive accessor so inactive cached slots ignore
// global keyboard/window listeners and pause layout observers.
import { createComputed, createContext, createMemo, on, useContext, type Accessor, type JSX } from "solid-js"

const ALWAYS_ACTIVE: Accessor<boolean> = () => true

const ViewActiveContext = createContext<Accessor<boolean>>(ALWAYS_ACTIVE)

export function ViewActiveProvider(props: { active: Accessor<boolean>; children: JSX.Element }) {
  return <ViewActiveContext.Provider value={props.active}>{props.children}</ViewActiveContext.Provider>
}

export function useViewActive(): Accessor<boolean> {
  return useContext(ViewActiveContext)
}

function sameValue<T>(a: T, b: T): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b) && a.length === 0 && b.length === 0) return true
  if (a instanceof Set && b instanceof Set && a.size === 0 && b.size === 0) return true
  return false
}

/** Shallow element-wise reference equality for frozen array memos. */
export function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}

/** Freeze a reactive computation while `active()` is false, with custom equality for catch-up on reveal. */
export function freezeMemo<T>(
  active: Accessor<boolean>,
  read: (previous: T | undefined) => T,
  equals: (previous: T, next: T) => boolean = sameValue,
): Accessor<T> {
  const held = createMemo<{ value: T } | undefined>(
    (previous) => (active() || !previous ? { value: read(previous?.value) } : previous),
    undefined,
    { equals: (previous, next) => previous !== undefined && next !== undefined && equals(previous.value, next.value) },
  )
  return () => held()!.value
}

/** Freeze a reactive read while `active()` is false so hidden cached views do zero reactive work. */
export function freezeValue<T>(active: Accessor<boolean>, read: Accessor<T>): Accessor<T> {
  return freezeMemo(active, () => read(), sameValue)
}

const INACTIVE_CONTAINER =
  "[inert], .am-chat-wrapper-hidden, .am-side-host-hidden, .am-diff-panel-cache:not(.am-diff-panel-cache-active), .am-browser-cache:not(.am-browser-cache-active)"
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

let shiftTab = false
let tabTracked = false

function trackTabDirection() {
  if (tabTracked || typeof document === "undefined") return
  tabTracked = true
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Tab") shiftTab = event.shiftKey
    },
    true,
  )
}

/**
 * Redirect focus cleanly past an inactive keep-alive cache container when a user
 * presses Tab / Shift+Tab, instead of blurring to `document.body` or toggling `inert`.
 */
export function skipInactiveFocus(event: FocusEvent, container: HTMLElement): void {
  trackTabDirection()
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const doc = container.ownerDocument
  const candidates = [...doc.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest(INACTIVE_CONTAINER) && el.offsetParent !== null,
  )
  if (candidates.length === 0) {
    target.blur()
    return
  }
  const next = shiftTab
    ? candidates.findLast((el) => Boolean(el.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING)) ??
      candidates.at(-1)
    : candidates.find((el) => Boolean(container.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) ??
      candidates[0]
  if (next && next !== target) next.focus()
  else target.blur()
}

/**
 * Blur any focused descendant inside `el` when `visible()` transitions to false.
 * Runs in `createComputed` before render effects mutate DOM classes/styles so
 * Chromium does not force a synchronous style recalc inside `blur()`.
 */
export function blurOnHide(visible: Accessor<boolean>, el: () => HTMLElement | undefined): void {
  createComputed(
    on(
      visible,
      (shown) => {
        if (shown) return
        const node = el()
        const focused = document.activeElement
        if (node && focused instanceof HTMLElement && node.contains(focused)) focused.blur()
      },
      { defer: true },
    ),
  )
}
