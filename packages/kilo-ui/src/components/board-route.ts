type Node = { id: string; parentID?: string; title?: string }

const LIMIT = 32

/**
 * Optimistic route for a board_post that is still pending. The stored route
 * (from, to, labels) only arrives with the tool result, but the sender and the
 * usual recipients are already in the session store, so the trigger can show
 * the real avatars and titles while the model still streams the message body.
 * Unknown or partially streamed recipient IDs resolve to "" so the avatar does
 * not flicker through hash colors.
 */
export function preview(sessions: readonly Node[], sessionID: string, to: unknown) {
  const byID = new Map(sessions.map((node) => [node.id, node]))
  const root = (id: string, depth = 0): string | undefined => {
    const node = byID.get(id)
    if (!node) return undefined
    if (!node.parentID) return node.id
    if (depth >= LIMIT) return undefined
    return root(node.parentID, depth + 1)
  }
  const top = root(sessionID)
  const alias = (id: string) => (top && id === top ? "main" : id)
  const label = (id: string) => byID.get(id)?.title?.trim() || undefined
  const value = typeof to === "string" ? to.trim() : ""
  const target = (() => {
    if (value === "ALL") return { id: "ALL", label: undefined }
    if (value === "main") return { id: top ? "main" : "", label: top ? label(top) : undefined }
    if (!byID.has(value)) return { id: "", label: undefined }
    return { id: alias(value), label: label(value) }
  })()
  return { from: alias(sessionID), fromLabel: label(sessionID), to: target.id, toLabel: target.label }
}
