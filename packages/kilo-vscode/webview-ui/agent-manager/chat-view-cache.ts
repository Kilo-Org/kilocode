/**
 * Pure LRU bookkeeping for Agent Manager's keep-alive chat view cache.
 *
 * Keeps recently visited chat views mounted in stable DOM order so switching
 * worktrees or session tabs never tears down and rebuilds SessionView, Virtua,
 * or PromptInput. Because MessageList is already virtualized, keeping up to
 * CHAT_CACHE_SIZE slots warm in place avoids cold content-visibility/AX
 * reserialization spikes on switches while bounding DOM and memory usage.
 */

export const CHAT_CACHE_SIZE = 15

export interface ChatCacheSlot {
  readonly id: number
  key: string
  readonly directory: string
}

export interface ChatCacheState<T extends ChatCacheSlot> {
  /** Mounted slots in stable DOM order (never reordered on activation). */
  entries: T[]
  /** Slot IDs from least recently used to most recently used. */
  recent: number[]
}

export function chatSlotKey(directory: string, sessionOrDraft: string | undefined): string {
  return `${directory}\0${sessionOrDraft ?? "new"}`
}

export function emptyChatCache<T extends ChatCacheSlot>(): ChatCacheState<T> {
  return { entries: [], recent: [] }
}

/**
 * Mark an existing slot as most recently used, or append a newly created slot
 * and evict the least recently used slot beyond `max`. Existing entries keep
 * their DOM index so Solid `<For>` never moves or remounts sibling nodes.
 */
export function rememberChatSlot<T extends ChatCacheSlot>(
  state: ChatCacheState<T>,
  key: string,
  create: () => T,
  max: number = CHAT_CACHE_SIZE,
): { state: ChatCacheState<T>; slot: T; evicted: T[] } {
  const existing = state.entries.find((item) => item.key === key)
  if (existing) {
    if (state.recent.at(-1) === existing.id) return { state, slot: existing, evicted: [] }
    const recent = [...state.recent.filter((id) => id !== existing.id), existing.id]
    return { state: { entries: state.entries, recent }, slot: existing, evicted: [] }
  }
  const slot = create()
  const recent = [...state.recent, slot.id]
  const entries = [...state.entries, slot]
  if (entries.length <= max) return { state: { entries, recent }, slot, evicted: [] }
  const keep = new Set(recent.slice(-max))
  const evicted = entries.filter((item) => !keep.has(item.id))
  return {
    state: {
      entries: entries.filter((item) => keep.has(item.id)),
      recent: recent.filter((id) => keep.has(id)),
    },
    slot,
    evicted,
  }
}

/**
 * Promote a draft slot's key in place when its first prompt creates a real
 * session, without changing the slot object identity or unmounting its DOM.
 * If another slot already occupies `nextKey`, remove and return that duplicate slot.
 */
export function promoteChatSlot<T extends ChatCacheSlot>(
  state: ChatCacheState<T>,
  slotId: number,
  nextKey: string,
): { state: ChatCacheState<T>; evicted: T[] } {
  const target = state.entries.find((item) => item.id === slotId)
  if (!target || target.key === nextKey) return { state, evicted: [] }
  const duplicate = state.entries.find((item) => item.id !== slotId && item.key === nextKey)
  target.key = nextKey
  if (!duplicate) return { state, evicted: [] }
  return {
    state: {
      entries: state.entries.filter((item) => item.id !== duplicate.id),
      recent: state.recent.filter((id) => id !== duplicate.id),
    },
    evicted: [duplicate],
  }
}

/** Drop slots that fail `keep` (e.g., disposed directory store or deleted session). */
export function pruneChatSlots<T extends ChatCacheSlot>(
  state: ChatCacheState<T>,
  keep: (slot: T) => boolean,
): ChatCacheState<T> {
  if (state.entries.every(keep)) return state
  const entries = state.entries.filter(keep)
  const ids = new Set(entries.map((item) => item.id))
  return { entries, recent: state.recent.filter((id) => ids.has(id)) }
}
