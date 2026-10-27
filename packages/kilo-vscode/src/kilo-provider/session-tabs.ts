/** Where a session opens: inside the sidebar chat, or as its own editor tab. */
export type SessionLocation = "sidebar" | "editorTab"

export function sessionLocation(value: unknown): SessionLocation {
  return value === "editorTab" ? "editorTab" : "sidebar"
}

type Chat = { getCurrentSessionId(): string | undefined }

/**
 * Find the editor tab already showing a session, so opening it again focuses
 * that tab instead of creating a duplicate. Matches on the live session id, which
 * stays correct when a tab switches sessions from inside (history, fork).
 */
export function findSessionTab<P>(tabs: Iterable<readonly [P, Chat]>, id: string): P | undefined {
  for (const [panel, chat] of tabs) {
    if (chat.getCurrentSessionId() === id) return panel
  }
}
