/**
 * Prompt history navigation.
 * Arrow Up/Down at cursor boundaries cycles through previously sent prompts.
 *
 * Entries persist via localStorage, surviving webview hide/show cycles.
 * History is shared across conversations by default. The
 * `experimental.conversationPromptHistory` setting scopes it per conversation
 * key instead, so switching conversations does not mix unrelated history.
 */

import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"

export const MAX = 100
/** The shared list: a flat array, the only storage shape before per-conversation history existed. */
const SHARED_STORAGE_KEY = "kilo.prompt-history.v1"
/** Per-conversation lists: a map of conversation key to list. */
const SCOPED_STORAGE_KEY = "kilo.prompt-history.v2"
/** Bucket for conversations that do not yet have a stable key (e.g. a brand-new tab). */
const FALLBACK_KEY = "new"
/** In-memory bucket for the shared list. Never evicted. */
const GLOBAL_KEY = "global"
/** Cap on remembered conversations, evicting the least recently used once exceeded. */
export const MAX_CONVERSATIONS = 50
/** Per-conversation mode only: longer prompts are not remembered, to protect the storage quota. */
export const MAX_ENTRY = 10_000
const EMPTY: string[] = []

// Insertion order doubles as recency order: touching a key re-inserts it at the end.
type Store = Map<string, string[]>

/**
 * Conversations whose history was moved before their first entry was written.
 * A first prompt settles the session before the send is admitted, so the append
 * can arrive after the move. Following the alias keeps that entry in the session
 * it belongs to instead of the retired draft key.
 */
const moved = new Map<string, string>()

function storage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string").slice(0, MAX)
}

function read(key: string): unknown {
  try {
    const raw = storage()?.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch (err) {
    console.warn("[Kilo New] prompt history load failed", err)
    return undefined
  }
}

function load(): Store {
  const store: Store = new Map()
  const scoped = read(SCOPED_STORAGE_KEY)
  if (typeof scoped === "object" && scoped !== null && !Array.isArray(scoped)) {
    for (const [key, value] of Object.entries(scoped)) {
      const list = strings(value)
      if (key !== GLOBAL_KEY && list.length > 0) store.set(key, list)
    }
  }
  const shared = strings(read(SHARED_STORAGE_KEY))
  if (shared.length > 0) store.set(GLOBAL_KEY, shared)
  return store
}

function write(key: string, value: unknown): boolean {
  const target = storage()
  if (!target) return false
  try {
    target.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** Drop the least recently used conversation (never the shared list). Returns whether one was dropped. */
function evict(): boolean {
  const oldest = [...store.keys()].find((key) => key !== GLOBAL_KEY)
  if (oldest === undefined) return false
  store.delete(oldest)
  return true
}

/**
 * Persist one side of the store, so a shared-list change never rewrites the
 * per-conversation lists and the reverse. When the storage quota is exceeded, the
 * per-conversation write drops the oldest conversations from a copy only;
 * in-memory history is never dropped for a failed write.
 */
function persist(key: string) {
  if (!storage()) return
  if (key === GLOBAL_KEY) {
    if (!write(SHARED_STORAGE_KEY, store.get(GLOBAL_KEY) ?? [])) console.warn("[Kilo New] prompt history save failed")
    return
  }
  const copy = new Map(store)
  copy.delete(GLOBAL_KEY)
  while (!write(SCOPED_STORAGE_KEY, Object.fromEntries(copy))) {
    const oldest = copy.keys().next().value
    if (oldest === undefined) return console.warn("[Kilo New] prompt history save failed")
    copy.delete(oldest)
  }
}

/** Follow a move alias, so an entry appended after the move lands in the target conversation. */
function follow(key: string): string {
  const target = moved.get(key)
  if (target === undefined) return key
  moved.delete(key)
  return target
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

/**
 * Re-key a conversation's history, e.g. when a pending draft becomes a real session.
 * With no entry yet, the target is remembered so a late append still lands there.
 */
export function movePromptHistory(from: string, to: string) {
  if (from === to || from === GLOBAL_KEY || to === GLOBAL_KEY) return
  const source = follow(from)
  const target = follow(to)
  if (source === target) return
  const list = store.get(source)
  if (!list) {
    moved.set(from, target)
    return
  }
  store.delete(source)
  const existing = store.get(target)
  if (existing) seedEntries(list, [...existing].reverse(), MAX)
  store.set(target, list)
  persist(target)
}

/** Read-only lookup: never allocates or persists an empty bucket for a key that was merely browsed. */
function entriesFor(key: string): string[] {
  return store.get(key) ?? EMPTY
}

/** Get-or-create the mutable bucket for `key`, marking it most-recently-used and
 * evicting the oldest conversation once the cap is exceeded. Only call this when
 * about to write, so reads never grow the store. */
function mutableEntriesFor(key: string): { key: string; entries: string[] } {
  const name = follow(key)
  const existing = store.get(name)
  if (existing) {
    store.delete(name)
    store.set(name, existing)
    return { key: name, entries: existing }
  }
  const created: string[] = []
  store.set(name, created)
  if (store.size > MAX_CONVERSATIONS) evict()
  return { key: name, entries: created }
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
   * conversation is currently active, required when the send may complete after
   * the user has already switched to a different conversation.
   */
  append: (text: string, targetKey?: string) => void
  /** Seed history from existing session messages (e.g., when a session is loaded). */
  seed: (texts: string[]) => void
  /** Reset navigation state. Call when the user types new input. */
  reset: () => void
  /** Re-key a conversation's history, e.g. when a pending draft becomes a real session. */
  move: (from: string, to: string) => void
  /** Current history index (-1 = not browsing). Reflects the active conversation
   * only after an action (navigate/append/seed) has synced it; it is a plain
   * signal read with no side effects. */
  index: Accessor<number>
}

/**
 * @param key Accessor for the current conversation's history key (typically the
 * session ID). History is isolated per key when shared returns false; an undefined
 * key falls back to a shared bucket for conversations that have not been created yet.
 * @param shared When it returns true, every conversation shares one history and
 * `key` is ignored.
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
    const all = shared?.() === true
    if (!text.trim() || (!all && text.length > MAX_ENTRY)) return
    // No conversation key yet: recording would leak into every other brand-new conversation.
    if (!all && targetKey === undefined && key() === undefined) return
    // An explicit targetKey names the session the message actually belongs to; it may
    // differ from the active key. Shared mode ignores it: there is one bucket.
    const current = syncKey()
    const name = all || targetKey === undefined ? current : targetKey
    const bucket = mutableEntriesFor(name)
    if (appendEntry(bucket.entries, text, MAX)) persist(bucket.key)
  }

  function seed(texts: string[]) {
    const all = shared?.() === true
    const fit = all ? texts : texts.filter((text) => text.length <= MAX_ENTRY)
    if (!fit.some((text) => text.trim())) return
    const bucket = mutableEntriesFor(syncKey())
    if (seedEntries(bucket.entries, fit, MAX)) persist(bucket.key)
  }

  function reset() {
    setIndex(-1)
    saved = null
  }

  return { navigate, append, seed, reset, move: movePromptHistory, index }
}
