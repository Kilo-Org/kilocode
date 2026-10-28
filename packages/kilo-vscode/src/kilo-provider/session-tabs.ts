/** Where a session opens: inside the sidebar chat, or as its own editor tab. */
export type SessionLocation = "sidebar" | "editorTab"

export function sessionLocation(value: unknown): SessionLocation {
  return value === "editorTab" ? "editorTab" : "sidebar"
}

type Chat = { getCurrentSessionId(): string | undefined }

/** Key under which a cloud session preview is tracked, since the host never learns its session id. */
export const cloudTabKey = (id: string) => `cloud:${id}`

/**
 * Find the editor tab already showing a session, so opening it again focuses
 * that tab instead of creating a duplicate. Matches on the live session id, which
 * stays correct when a tab switches sessions from inside (history, fork).
 *
 * `opening` covers the window before a new tab reports its session id: it maps a key
 * to the tab opened for it. An entry only counts while that tab is still open and has
 * no session of its own yet; otherwise it is stale and dropped.
 */
export function findSessionTab<P>(tabs: ReadonlyMap<P, Chat>, id: string, opening?: Map<string, P>): P | undefined {
  for (const [panel, chat] of tabs) {
    if (chat.getCurrentSessionId() === id) return panel
  }
  const panel = opening?.get(id)
  if (panel === undefined) return
  const chat = tabs.get(panel)
  if (chat && chat.getCurrentSessionId() === undefined) return panel
  opening?.delete(id)
}
