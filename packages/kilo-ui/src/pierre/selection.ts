import type { SelectedLineRange } from "@pierre/diffs"

type Side = "additions" | "deletions"

export function readSelectedLineRange(
  root: ShadowRoot,
  line: (node: Node | null) => number | undefined,
  side: (node: Node | null) => Side | undefined,
): SelectedLineRange | undefined {
  const selection =
    (root as unknown as { getSelection?: () => Selection | null }).getSelection?.() ?? window.getSelection()
  if (!selection || selection.isCollapsed) return

  const domRange =
    (
      selection as unknown as {
        getComposedRanges?: (options?: { shadowRoots?: ShadowRoot[] }) => Range[]
      }
    ).getComposedRanges?.({ shadowRoots: [root] })?.[0] ??
    (selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined)

  const startNode = domRange?.startContainer ?? selection.anchorNode
  const endNode = domRange?.endContainer ?? selection.focusNode
  if (!startNode || !endNode) return
  if (!root.contains(startNode) || !root.contains(endNode)) return

  const start = line(startNode)
  const end = line(endNode)
  if (start === undefined || end === undefined) return

  const startSide = side(startNode)
  const endSide = side(endNode)
  const selected: SelectedLineRange = { start, end }
  const selectedSide = startSide ?? endSide
  if (selectedSide) selected.side = selectedSide
  if (endSide && selectedSide && endSide !== selectedSide) selected.endSide = endSide
  return selected
}

export function attachLineSelectionListeners(
  container: HTMLElement,
  enabled: boolean,
  handlers: {
    mousedown: (event: MouseEvent) => void
    mousemove: (event: MouseEvent) => void
    mouseup: () => void
    selectionchange: () => void
  },
): () => void {
  if (!enabled) return () => {}

  container.addEventListener("mousedown", handlers.mousedown)
  container.addEventListener("mousemove", handlers.mousemove)
  window.addEventListener("mouseup", handlers.mouseup)
  document.addEventListener("selectionchange", handlers.selectionchange)
  return () => {
    container.removeEventListener("mousedown", handlers.mousedown)
    container.removeEventListener("mousemove", handlers.mousemove)
    window.removeEventListener("mouseup", handlers.mouseup)
    document.removeEventListener("selectionchange", handlers.selectionchange)
  }
}
