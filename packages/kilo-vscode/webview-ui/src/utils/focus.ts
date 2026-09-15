const nonText = new Set(["button", "checkbox", "file", "hidden", "image", "radio", "range", "reset", "submit"])

export const hasPopup = (root: ParentNode = document): boolean =>
  root.querySelector(".popup-selector[data-expanded]") !== null

/** Keep prompt focus across OS window deactivation without stealing other controls. */
export function createHold(opts: {
  target: () => HTMLElement | undefined
  busy?: () => boolean
  focused?: () => boolean
  active?: () => Element | null
  idle?: (el: Element | null) => boolean
  defer?: (fn: () => void) => void
}) {
  let held = false
  const focused = opts.focused ?? (() => document.hasFocus())
  const active = opts.active ?? (() => document.activeElement)
  const idle = opts.idle ?? ((el) => !el || el === document.body || el === document.documentElement)
  const defer = opts.defer ?? ((fn) => requestAnimationFrame(fn))
  return {
    claim() {
      held = true
    },
    release() {
      defer(() => {
        if (!focused()) return
        if (active() === opts.target()) return
        if (idle(active())) return
        held = false
      })
    },
    reclaim() {
      if (!held || opts.busy?.()) return
      const node = opts.target()
      if (!node) return
      const el = active()
      if (el && !idle(el) && el !== node) return
      node.focus({ preventScroll: true })
    },
  }
}

/**
 * Whether the user holds a text selection outside any text control. Focusing
 * the prompt would move the document selection into the textarea and drop it.
 */
export const hasTextSelection = (doc: Document = document): boolean => {
  const selection = doc.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false
  const node = selection.anchorNode
  const el = node instanceof Element ? node : node?.parentElement
  return !isTextControl(el ?? null)
}

/** Whether an element owns editable text focus that should not be stolen. */
export const isTextControl = (el: Element | null): boolean => {
  if (!el) return false
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true
  if (el.tagName === "INPUT") return !nonText.has((el as HTMLInputElement).type.toLowerCase())
  return ("isContentEditable" in el && (el as HTMLElement).isContentEditable) || el.getAttribute("role") === "textbox"
}
