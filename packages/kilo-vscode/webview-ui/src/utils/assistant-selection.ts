function closestAssistantRow(node: Node | null): HTMLElement | undefined {
  const element = node?.nodeType === 1 ? (node as Element) : node?.parentElement
  if (element?.closest('[data-annotation-marker], button, [role="button"], .selection-toolbar')) return undefined
  return element?.closest<HTMLElement>('[data-row="assistant"]') ?? undefined
}

export interface AssistantSelectionScope {
  transcript: HTMLElement | undefined
  sessionID: string | undefined
  streaming: ReadonlySet<string>
}

export interface AssistantCaptureOwner {
  transcript: HTMLElement
  sessionID: string
  row: HTMLElement
  messageID: string
}

function assistantRowOwned(row: HTMLElement, scope: AssistantSelectionScope): boolean {
  if (!scope.transcript?.isConnected || row.closest("[data-transcript-root]") !== scope.transcript) return false
  if (
    !scope.sessionID ||
    scope.transcript.dataset.session !== scope.sessionID ||
    row.dataset.session !== scope.sessionID
  )
    return false
  if (!row.dataset.message || row.hasAttribute("data-live")) return false
  return !scope.streaming.has(row.dataset.message)
}

export function assistantSelectionRow(
  anchor: Node | null,
  focus: Node | null,
  commonAncestor: Node | null,
  scope: AssistantSelectionScope,
): HTMLElement | undefined {
  const row = closestAssistantRow(anchor)
  if (!row || closestAssistantRow(focus) !== row) return undefined
  if (!assistantRowOwned(row, scope)) return undefined
  if (!commonAncestor || (commonAncestor !== row && !row.contains(commonAncestor))) return undefined
  return row
}

export function assistantCaptureOwned(capture: AssistantCaptureOwner, scope: AssistantSelectionScope): boolean {
  if (capture.transcript !== scope.transcript || capture.sessionID !== scope.sessionID) return false
  if (capture.row.dataset.message !== capture.messageID) return false
  return assistantRowOwned(capture.row, scope)
}

export function selectionToolbarPosition(
  anchor: Pick<DOMRect, "top" | "left" | "width" | "height">,
  toolbar: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 8,
  gap = 8,
) {
  const maxLeft = Math.max(padding, viewport.width - padding - toolbar.width)
  const left = Math.min(Math.max(anchor.left + anchor.width / 2 - toolbar.width / 2, padding), maxLeft)
  const above = anchor.top - gap - toolbar.height
  const below = anchor.top + anchor.height + gap
  const maxTop = Math.max(padding, viewport.height - padding - toolbar.height)
  const top = Math.min(Math.max(above >= padding ? above : below, padding), maxTop)
  return { top, left }
}
