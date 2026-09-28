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

type Store = Record<string, string[]>

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    const store: Store = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      store[key] = value.filter((e): e is string => typeof e === "string").slice(0, MAX)
    }
    return store
  } catch (err) {
    console.warn("[Kilo New] prompt history load failed", err)
    return {}
  }
}

function save(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
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

function entriesFor(key: string): string[] {
  const existing = store[key]
  if (existing) return existing
  const created: string[] = []
  store[key] = created
  return created
}

export interface PromptHistory {
  /** Navigate history. Returns the new text value, or null if no navigation occurred. */
  navigate: (direction: "up" | "down", text: string, cursor: number) => string | null
  /** Append a sent prompt to history (deduplicates consecutive identical entries). */
  append: (text: string) => void
  /** Seed history from existing session messages (e.g., when a session is loaded). */
  seed: (texts: string[]) => void
  /** Reset navigation state. Call when the user types new input. */
  reset: () => void
  /** Current history index (-1 = not browsing). */
  index: Accessor<number>
}

/**
 * @param key Accessor for the current conversation's history key (typically the
 * session ID). History is isolated per key; an undefined key falls back to a
 * shared bucket for conversations that have not been created yet.
 */
export function usePromptHistory(key: Accessor<string | undefined>): PromptHistory {
  const [index, setIndex] = createSignal(-1)
  let saved: string | null = null
  const resolve = () => key() ?? FALLBACK_KEY
  let lastKey = resolve()

  // Switching conversations must not carry over browsing position or the saved draft.
  function syncKey(): string {
    const current = resolve()
    if (current === lastKey) return current
    lastKey = current
    setIndex(-1)
    saved = null
    return current
  }

  function entries(): string[] {
    return entriesFor(syncKey())
  }

  function navigate(direction: "up" | "down", text: string, cursor: number): string | null {
    const list = entries()
    if (!canNavigate(direction, text, cursor, index() >= 0)) return null

    if (direction === "up") {
      if (list.length === 0) return null
      if (index() === -1) {
        saved = text
        setIndex(0)
        return list[0]!
      }
      const next = index() + 1
      if (next >= list.length) return null
      setIndex(next)
      return list[next]!
    }

    // direction === "down"
    if (index() < 0) return null

    if (index() > 0) {
      const next = index() - 1
      setIndex(next)
      return list[next]!
    }

    // index === 0: return to the saved draft
    setIndex(-1)
    const draft = saved ?? ""
    saved = null
    return draft
  }

  function append(text: string) {
    if (appendEntry(entries(), text, MAX)) save(store)
  }

  function seed(texts: string[]) {
    if (seedEntries(entries(), texts, MAX)) save(store)
  }

  function reset() {
    setIndex(-1)
    saved = null
  }

  const currentIndex: Accessor<number> = () => {
    syncKey()
    return index()
  }

  return { navigate, append, seed, reset, index: currentIndex }
}
