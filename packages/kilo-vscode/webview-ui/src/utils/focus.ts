const nonText = new Set(["button", "checkbox", "file", "hidden", "image", "radio", "range", "reset", "submit"])

export const hasPopup = (root: ParentNode = document): boolean =>
  root.querySelector(".popup-selector[data-expanded]") !== null

/**
 * Marker for a scroll region that owns keyboard focus, such as the diff
 * viewport. Delayed prompt focus recovery must not steal focus from it.
 */
export const FOCUS_REGION_ATTRIBUTE = "data-focus-region"

/** Whether the element sits inside a keyboard focus region. */
export const ownsFocusRegion = (el: Element | null | undefined = document.activeElement): boolean =>
  !!el && typeof el.closest === "function" && el.closest(`[${FOCUS_REGION_ATTRIBUTE}]`) !== null

/** Whether the element itself is a keyboard focus region. */
export const isFocusRegion = (el: Element | null | undefined): boolean =>
  !!el && typeof el.matches === "function" && el.matches(`[${FOCUS_REGION_ATTRIBUTE}]`)

/** Release a viewport or its inner scroller without changing native editor behavior. */
export function releaseFocusRegion(event: PointerEvent, doc: Document = document): void {
  const active = doc.activeElement
  const region = active?.closest(`[${FOCUS_REGION_ATTRIBUTE}]`)
  if (!region || event.composedPath().includes(region)) return
  let target = active
  while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement
  if (target && !isTextControl(target)) (target as HTMLElement).blur()
}

/** Route paste from non-editable surfaces without taking paste away from another editor. */
export const isPromptPaste = (event: ClipboardEvent): boolean =>
  !event.defaultPrevented &&
  !hasPopup() &&
  !event.composedPath().some((node) => node instanceof Element && (isTextControl(node) || node.closest(".xterm")))

/** Check writability without visibility, since review can cover the intended prompt. */
export const isWritablePrompt = (prompt: HTMLTextAreaElement | undefined): prompt is HTMLTextAreaElement =>
  !!prompt?.isConnected && !prompt.readOnly && !prompt.disabled && prompt.getAttribute("aria-disabled") !== "true"

/**
 * Whether the prompt can receive a paste once it is revealed. Visibility is
 * excluded because review covers the prompt before the paste reveals it, but an
 * inert or aria-hidden prompt stays unreachable and must not be revealed.
 */
export const isReachablePrompt = (prompt: HTMLTextAreaElement | undefined): prompt is HTMLTextAreaElement =>
  isWritablePrompt(prompt) && prompt.closest('[inert], [aria-hidden="true"]') === null

export function pasteToPrompt(
  event: ClipboardEvent,
  prompt: HTMLTextAreaElement | undefined,
  paste: (event: ClipboardEvent) => void,
): void {
  if (!isPromptPaste(event) || !isReachablePrompt(prompt) || !prompt.getClientRects().length) return
  prompt.focus({ preventScroll: true })
  if (prompt.ownerDocument.activeElement !== prompt) return
  paste(event)
  if (event.defaultPrevented) return
  const text = event.clipboardData?.getData("text/plain")
  if (!text) return
  event.preventDefault()
  // Keep native undo for text, while reusing the normal image and large-paste handlers above.
  prompt.ownerDocument.execCommand("insertText", false, text)
}

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
