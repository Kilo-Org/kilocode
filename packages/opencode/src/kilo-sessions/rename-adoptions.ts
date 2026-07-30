// Leaf module shared by remote-sender (rename adoption) and kilo-sessions
// (title broadcast + auto-title marking). Kept free of imports from either so
// neither side needs a static import of the other.

const renames = new Map<string, string>()
const autos = new Map<string, string>()

export function markRenameAdopted(sessionId: string, title: string) {
  renames.set(sessionId, title)
}

/** Consume a pending rename adoption when the title matches. */
export function consumeRenameAdoption(sessionId: string, title: string): boolean {
  if (renames.get(sessionId) !== title) return false
  renames.delete(sessionId)
  return true
}

export function markAutoTitle(sessionId: string, title: string) {
  autos.set(sessionId, title)
}

/** Consume a pending auto-title mark when the title matches. */
export function consumeAutoTitle(sessionId: string, title: string): boolean {
  if (autos.get(sessionId) !== title) return false
  autos.delete(sessionId)
  return true
}
