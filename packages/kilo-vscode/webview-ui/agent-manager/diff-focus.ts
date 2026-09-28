type DiffToggleIntent = "open" | "focus" | "close"

/** Decide what the Changes toggle does for the current diff focus state. */
export function diffToggleIntent(open: boolean, ownsFocus: boolean): DiffToggleIntent {
  if (!open) return "open"
  return ownsFocus ? "close" : "focus"
}

export const DIFF_PANEL_SCROLLER = ".am-diff-panel-cache-active .am-diff-content"
export const REVIEW_SCROLLER = ".am-review-host .am-review-diff"

/** Focus the first matching diff viewport; report whether it now holds focus. */
export function focusDiffScroller(selector: string, doc: Document = document): boolean {
  const el = doc.querySelector<HTMLElement>(selector)
  if (!el) return false
  el.focus({ preventScroll: true })
  return doc.activeElement === el
}
