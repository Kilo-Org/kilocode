// Leaf module shared by remote-sender (rename adoption) and kilo-sessions
// (title broadcast + auto-title marking). Kept free of imports from either so
// neither side needs a static import of the other.

/** Marks older than this are dropped on write. Generous vs the ~10s DO re-emit window. */
export const MARK_TTL_MS = 60_000

type Entry = { title: string; time: number }

const renames = new Map<string, Entry>()
const autos = new Map<string, Entry>()

function prune(map: Map<string, Entry>, now: number) {
  for (const [id, entry] of map) {
    if (now - entry.time > MARK_TTL_MS) map.delete(id)
  }
}

function mark(map: Map<string, Entry>, sessionId: string, title: string) {
  const now = Date.now()
  prune(map, now)
  map.set(sessionId, { title, time: now })
}

function consume(map: Map<string, Entry>, sessionId: string, title: string): boolean {
  const now = Date.now()
  const entry = map.get(sessionId)
  if (!entry) return false
  if (now - entry.time > MARK_TTL_MS) {
    map.delete(sessionId)
    return false
  }
  if (entry.title !== title) return false
  map.delete(sessionId)
  return true
}

export function markRenameAdopted(sessionId: string, title: string) {
  mark(renames, sessionId, title)
}

/** Consume a pending rename adoption when the title matches. */
export function consumeRenameAdoption(sessionId: string, title: string): boolean {
  return consume(renames, sessionId, title)
}

export function markAutoTitle(sessionId: string, title: string) {
  mark(autos, sessionId, title)
}

/** Consume a pending auto-title mark when the title matches. */
export function consumeAutoTitle(sessionId: string, title: string): boolean {
  return consume(autos, sessionId, title)
}

/** Drop both mark maps for one session (Deleted / test isolation). */
export function clear(sessionId: string) {
  renames.delete(sessionId)
  autos.delete(sessionId)
}

/** Drop every mark (tests). */
export function clearAll() {
  renames.clear()
  autos.clear()
}
