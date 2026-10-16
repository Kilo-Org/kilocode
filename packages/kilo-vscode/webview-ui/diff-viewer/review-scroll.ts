import type { Accessor } from "solid-js"
import type { VirtualizerHandle } from "virtua/solid"
import type { WorktreeFileDiff } from "../src/types/messages"

export function createReviewScrollPreserver(
  rows: Accessor<WorktreeFileDiff[]>,
  virtualizer: Accessor<VirtualizerHandle | undefined>,
) {
  return (run: () => void) => {
    const handle = virtualizer()
    const index = handle?.findItemIndex(handle.scrollOffset)
    const file = index === undefined ? undefined : rows()[index]?.file
    const offset = index === undefined ? 0 : (handle?.scrollOffset ?? 0) - (handle?.getItemOffset(index) ?? 0)
    run()
    if (!file) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const next = rows().findIndex((diff) => diff.file === file)
        if (next < 0) return
        virtualizer()?.scrollToIndex(next, { offset })
      })
    })
  }
}

/** Claim reading focus after the browser has focused Pierre's inner PRE. */
export function focusDiff(event: MouseEvent & { currentTarget: HTMLDivElement }) {
  if (event.defaultPrevented || event.button !== 0) return
  const viewport = event.currentTarget
  for (const node of event.composedPath()) {
    if (node === viewport) break
    if (
      node instanceof Element &&
      node.matches(
        'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="treeitem"], [role="textbox"], [tabindex]:not(pre)',
      )
    )
      return
  }
  // Do not cancel the click or change the selection, including drag/Shift selection.
  viewport.focus({ preventScroll: true })
}

export function pageDiff(event: KeyboardEvent & { currentTarget: HTMLDivElement }) {
  const viewport = event.currentTarget
  if (
    !event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing ||
    event.defaultPrevented ||
    (event.key !== "ArrowDown" && event.key !== "ArrowUp") ||
    viewport.ownerDocument.activeElement !== viewport ||
    event.composedPath().at(0) !== viewport ||
    viewport.ownerDocument.getSelection()?.toString()
  )
    return

  event.preventDefault()
  const page = Math.max(viewport.clientHeight - 40, viewport.clientHeight * 0.9)
  const offset = event.key === "ArrowDown" ? page : -page
  viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + offset))
}
