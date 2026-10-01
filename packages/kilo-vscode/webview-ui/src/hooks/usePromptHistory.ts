/**
 * Prompt history navigation hook.
 * Arrow Up/Down at cursor boundaries cycles through previously sent prompts,
 * matching the behavior of the CLI TUI.
 *
 * Entries persist via localStorage, surviving webview hide/show cycles.
 * History is scoped per conversation key (typically the session ID), so
 * switching conversations does not mix unrelated prompt history.
 */

import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"

export const MAX = 100
const STORAGE_KEY = "kilo.prompt-history.v2"
/** Bucket for conversations that do not yet have a stable key (e.g. a brand-new tab). */
const FALLBACK_KEY = "new"
/** Bucket shared by every conversation when global history is enabled. Never evicted. */
const GLOBAL_KEY = "global"
/** Pre-per-conversation storage: one flat list shared by all conversations. */
const LEGACY_KEY = "kilo.prompt-history.v1"
/** Cap on remembered conversations, evicting the least recently used once exceeded. */
export const MAX_CONVERSATIONS = 50
const EMPTY: string[] = []

// Insertion order doubles as recency order: touching a key re-inserts it at the end.
type Store = Map<string, string[]>

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Map()
    const store: Store = new Map()
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      const list = value.filter((e): e is string => typeof e === "string").slice(0, MAX)
      if (list.length > 0) store.set(key, list)
    }
    return store
  } catch (err) {
    console.warn("[Kilo New] prompt history load failed", err)
    return new Map()
  }
}

/** Start the global bucket from the pre-v2 shared list, so enabling global history keeps old prompts. */
function legacy(store: Store) {
  if (store.has(GLOBAL_KEY)) return
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null")
    if (!Array.isArray(parsed)) return
    const list = parsed.filter((e): e is string => typeof e === "string").slice(0, MAX)
    if (list.length > 0) store.set(GLOBAL_KEY, list)
  } catch (err) {
    console.warn("[Kilo New] prompt history legacy load failed", err)
  }
}

function save(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(store)))
  } catch (err) {
    console.warn("[Kilo New] prompt history save failed", err)
  }
}

/**
 * Check whether the cursor position allows history navigation.
 * - Not browsing: up requires cursor at start, down requires cursor at end
 * - Already browsing: either boundary allows navigation in both directions
 */
export function canNavigate(direction: "up" | "down", text: string, cursor: number, browsing: boolean): boolean {
  const pos = Math.max(0, Math.min(cursor, text.length))
  const atStart = pos === 0
  const atEnd = pos === text.length
  return browsing ? atStart || atEnd : direction === "up" ? atStart : atEnd
}

/** Prepend an entry, moving it to front if it already exists anywhere. Returns whether entries changed. */
export function appendEntry(entries: string[], text: string, max: number): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const idx = entries.indexOf(trimmed)
  if (idx === 0) return false
  if (idx > 0) entries.splice(idx, 1)
  entries.unshift(trimmed)
  if (entries.length > max) entries.length = max
  return true
}

/**
 * Seed entries from session messages (chronological, oldest first).
 * New entries are inserted after any existing entries (which are newest-first)
 * but in reverse chronological order so the most recent seeded message is
 * closest to index 0 among the seeded block.
 * Returns whether any were added.
 */
export function seedEntries(entries: string[], texts: string[], max: number): boolean {
  // Collect new unique entries preserving chronological order
  const fresh: string[] = []
  for (const raw of texts) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (entries.includes(trimmed)) continue
    if (fresh.includes(trimmed)) continue
    fresh.push(trimmed)
  }
  if (fresh.length === 0) return false
  // Reverse so newest message is first, then append after existing entries
  for (let i = fresh.length - 1; i >= 0; i--) entries.push(fresh[i]!)
  if (entries.length > max) entries.length = max
  return true
}

// Module-level: initialized from localStorage, shared across remounts, keyed per conversation.
const store: Store = load()
legacy(store)

/** Read-only lookup: never allocates or persists an empty bucket for a key that was merely browsed. */
function entriesFor(key: string): string[] {
  return store.get(key) ?? EMPTY
}

/** Get-or-create the mutable bucket for `key`, marking it most-recently-used and
 * evicting the oldest conversation once the cap is exceeded. Only call this when
 * about to write, so reads never grow the store. */
function mutableEntriesFor(key: string): string[] {
  const existing = store.get(key)
  if (existing) {
    store.delete(key)
    store.set(key, existing)
    return existing
  }
  const created: string[] = []
  store.set(key, created)
  if (store.size > MAX_CONVERSATIONS) {
    const oldest = [...store.keys()].find((k) => k !== GLOBAL_KEY)
    if (oldest !== undefined) store.delete(oldest)
  }
  return created
}

export interface PromptHistory {
  /**
   * Navigate history. Returns the new text with its collapsed paste contents, or null
   * if no navigation occurred. `pastes` are the contents of the chips in the current
   * text, kept with the draft so returning to it brings the chips back.
   */
  navigate: (
    direction: "up" | "down",
    text: string,
    cursor: number,
    pastes: readonly string[],
  ) => { text: string; pastes: readonly string[] } | null
  /**
   * Append a sent prompt to history (deduplicates consecutive identical entries).
   * Pass `targetKey` to record against a specific conversation instead of whichever
   * conversation is currently active — required when the send may complete after
   * the user has already switched to a different conversation.
   */
  append: (text: string, targetKey?: string) => void
  /** Seed history from existing session messages (e.g., when a session is loaded). */
  seed: (texts: string[]) => void
  /** Reset navigation state. Call when the user types new input. */
  reset: () => void
  /** Current history index (-1 = not browsing). Reflects the active conversation
   * only after an action (navigate/append/seed) has synced it; it is a plain
   * signal read with no side effects. */
  index: Accessor<number>
}

/**
 * @param key Accessor for the current conversation's history key (typically the
 * session ID). History is isolated per key; an undefined key falls back to a
 * shared bucket for conversations that have not been created yet.
 * @param shared When it returns true, every conversation shares one history and
 * `key` is ignored. Seeding from session messages is skipped in that mode.
 */
export function usePromptHistory(key: Accessor<string | undefined>, shared?: Accessor<boolean>): PromptHistory {
  const [index, setIndex] = createSignal(-1)
  let saved: { text: string; pastes: readonly string[] } | null = null
  const resolve = () => (shared?.() ? GLOBAL_KEY : (key() ?? FALLBACK_KEY))
  let lastKey = resolve()

  // Switching conversations must not carry over browsing position or the saved draft.
  // Only action methods call this — reading `index` never triggers it.
  function syncKey(): string {
    const current = resolve()
    if (current === lastKey) return current
    lastKey = current
    setIndex(-1)
    saved = null
    return current
  }

  function navigate(
    direction: "up" | "down",
    text: string,
    cursor: number,
    pastes: readonly string[],
  ): { text: string; pastes: readonly string[] } | null {
    const list = entriesFor(syncKey())
    if (!canNavigate(direction, text, cursor, index() >= 0)) return null

    if (direction === "up") {
      if (list.length === 0) return null
      if (index() === -1) {
        saved = { text, pastes }
        setIndex(0)
        return { text: list[0]!, pastes: [] }
      }
      const next = index() + 1
      if (next >= list.length) return null
      setIndex(next)
      return { text: list[next]!, pastes: [] }
    }

    // direction === "down"
    if (index() < 0) return null

    if (index() > 0) {
      const next = index() - 1
      setIndex(next)
      return { text: list[next]!, pastes: [] }
    }

    // index === 0: return to the saved draft
    setIndex(-1)
    const draft = saved ?? { text: "", pastes: [] }
    saved = null
    return draft
  }

  function append(text: string, targetKey?: string) {
    if (!text.trim()) return
    // An explicit targetKey names the session the message actually belongs to; it may
    // differ from the active key. Shared mode ignores it: there is one bucket.
    const current = syncKey()
    const list = mutableEntriesFor(shared?.() || targetKey === undefined ? current : targetKey)
    if (appendEntry(list, text, MAX)) save(store)
  }

  function seed(texts: string[]) {
    if (shared?.() || !texts.some((t) => t.trim())) return
    if (seedEntries(mutableEntriesFor(syncKey()), texts, MAX)) save(store)
  }

  function reset() {
    setIndex(-1)
    saved = null
  }

  return { navigate, append, seed, reset, index }
}
