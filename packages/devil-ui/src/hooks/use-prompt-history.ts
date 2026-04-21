import { createSignal, type Accessor } from "solid-js"

// ─── Store interface ──────────────────────────────────────────────────────────

/**
 * Pluggable storage backend for prompt history.
 * The default in-memory store is suitable for TUI / desktop.
 * Consumers may supply a persistent backend (e.g. SQLite, localStorage).
 */
export interface PromptHistoryStore {
  save(entry: string): void | Promise<void>
  list(): string[] | Promise<string[]>
}

// ─── In-memory store ──────────────────────────────────────────────────────────

/**
 * Creates an in-memory ring buffer of prompt history entries.
 * When `capacity` is exceeded, the oldest entry is dropped.
 *
 * @param capacity Maximum number of entries to retain. Defaults to 50.
 */
export function createMemoryStore(capacity = 50): PromptHistoryStore {
  const entries: string[] = []

  return {
    save(entry: string): void {
      // Avoid duplicating consecutive identical entries.
      if (entries[entries.length - 1] === entry) return
      entries.push(entry)
      if (entries.length > capacity) {
        entries.shift() // drop oldest
      }
    },

    list(): string[] {
      return [...entries]
    },
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UsePromptHistoryResult {
  /**
   * Current history entry at the navigation cursor.
   * Empty string when the cursor is at position -1 (i.e. at the live input).
   */
  current: Accessor<string>
  /** Move cursor toward older entries (toward index 0). */
  up(): void
  /** Move cursor toward newer entries (toward the live input, index -1). */
  down(): void
  /**
   * Persist a new entry and reset the cursor to -1 so the next `up()` starts
   * from the most recent entry.
   */
  add(entry: string): void
}

/**
 * Provides keyboard-navigable prompt history backed by a `PromptHistoryStore`.
 *
 * Initialises synchronously from `store.list()` so it works correctly under
 * the `createRoot` test harness. If `store.list()` returns a Promise the
 * signal is seeded as an empty array first, then updated when the Promise
 * resolves.
 *
 * Index semantics:
 *   -1  = "live" position (current() returns "")
 *    0  = oldest entry
 *    N-1 = most recent entry
 * `up()` decrements toward 0; `down()` increments toward -1.
 */
export function usePromptHistory(store: PromptHistoryStore): UsePromptHistoryResult {
  // Seed synchronously when possible.
  const initial = store.list()

  const [history, setHistory] = createSignal<string[]>(Array.isArray(initial) ? initial : [])
  const [index, setIndex] = createSignal<number>(-1)

  // If store.list() returned a Promise, resolve it and backfill.
  if (!Array.isArray(initial)) {
    ;(initial as Promise<string[]>).then((entries) => {
      setHistory(entries)
    })
  }

  const current: Accessor<string> = () => {
    const idx = index()
    if (idx === -1) return ""
    const h = history()
    return h[idx] ?? ""
  }

  function up(): void {
    const h = history()
    if (h.length === 0) return
    setIndex((prev) => {
      if (prev === -1) return h.length - 1
      return Math.max(0, prev - 1)
    })
  }

  function down(): void {
    setIndex((prev) => {
      if (prev === -1) return -1
      return prev + 1 >= history().length ? -1 : prev + 1
    })
  }

  function add(entry: string): void {
    const result = store.save(entry)
    const refresh = () => {
      const entries = store.list()
      if (Array.isArray(entries)) {
        setHistory(entries)
      } else {
        ;(entries as Promise<string[]>).then(setHistory)
      }
      setIndex(-1)
    }

    if (result instanceof Promise) {
      result.then(refresh)
    } else {
      refresh()
    }
  }

  return { current, up, down, add }
}
