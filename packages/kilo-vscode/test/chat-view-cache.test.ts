import { describe, expect, it } from "bun:test"
import {
  CHAT_CACHE_SIZE,
  chatSlotKey,
  emptyChatCache,
  promoteChatSlot,
  pruneChatSlots,
  rememberChatSlot,
  type ChatCacheSlot,
} from "../webview-ui/agent-manager/chat-view-cache"

interface TestSlot extends ChatCacheSlot {
  label: string
}

function makeFactory() {
  let id = 1
  return (directory: string, key: string, label: string) => () => ({
    id: id++,
    directory,
    key,
    label,
  })
}

describe("chat-view-cache", () => {
  it("keeps DOM order stable when re-activating an existing slot", () => {
    const factory = makeFactory()
    let state = emptyChatCache<TestSlot>()

    const aKey = chatSlotKey("/repo/wt-a", "ses_a")
    const bKey = chatSlotKey("/repo/wt-b", "ses_b")
    const cKey = chatSlotKey("/repo/wt-c", "ses_c")

    state = rememberChatSlot(state, aKey, factory("/repo/wt-a", aKey, "A")).state
    state = rememberChatSlot(state, bKey, factory("/repo/wt-b", bKey, "B")).state
    state = rememberChatSlot(state, cKey, factory("/repo/wt-c", cKey, "C")).state

    const beforeEntries = state.entries
    const reactivated = rememberChatSlot(state, aKey, factory("/repo/wt-a", aKey, "A2"))
    expect(reactivated.slot.label).toBe("A")
    // Entries array keeps identical element order and reference so Solid <For> never moves DOM nodes.
    expect(reactivated.state.entries).toBe(beforeEntries)
    expect(reactivated.state.entries.map((item) => item.label)).toEqual(["A", "B", "C"])
    expect(reactivated.state.recent).toEqual([2, 3, 1])

    // Re-activating the already-MRU slot is a referential no-op.
    const same = rememberChatSlot(reactivated.state, aKey, factory("/repo/wt-a", aKey, "A3"))
    expect(same.state).toBe(reactivated.state)
  })

  it("evicts the least recently used slot when exceeding max capacity", () => {
    const factory = makeFactory()
    let state = emptyChatCache<TestSlot>()

    for (let i = 1; i <= 3; i++) {
      const k = chatSlotKey(`/repo/wt-${i}`, `ses_${i}`)
      state = rememberChatSlot(state, k, factory(`/repo/wt-${i}`, k, `S${i}`), 3).state
    }
    // Touch S1 so S2 becomes the least recently used slot.
    const k1 = chatSlotKey("/repo/wt-1", "ses_1")
    state = rememberChatSlot(state, k1, factory("/repo/wt-1", k1, "S1"), 3).state

    const k4 = chatSlotKey("/repo/wt-4", "ses_4")
    const added = rememberChatSlot(state, k4, factory("/repo/wt-4", k4, "S4"), 3)

    expect(added.evicted.map((item) => item.label)).toEqual(["S2"])
    expect(added.state.entries.map((item) => item.label)).toEqual(["S1", "S3", "S4"])
    expect(added.state.recent).toEqual([3, 1, 4])
  })

  it("promotes a draft slot key in place without changing slot object identity", () => {
    const factory = makeFactory()
    let state = emptyChatCache<TestSlot>()

    const draftKey = chatSlotKey("/repo/wt-a", "pending:1")
    const created = rememberChatSlot(state, draftKey, factory("/repo/wt-a", draftKey, "Draft"))
    state = created.state

    const realKey = chatSlotKey("/repo/wt-a", "ses_real_1")
    const promoted = promoteChatSlot(state, created.slot.id, realKey)

    expect(promoted.state).toBe(state)
    expect(promoted.evicted).toEqual([])
    expect(created.slot.key).toBe(realKey)
    expect(promoted.state.entries).toHaveLength(1)
    expect(promoted.state.entries[0]).toBe(created.slot)
  })

  it("drops a duplicate slot when promoting into an already-occupied key", () => {
    const factory = makeFactory()
    let state = emptyChatCache<TestSlot>()

    const draftKey = chatSlotKey("/repo/wt-a", "pending:1")
    const realKey = chatSlotKey("/repo/wt-a", "ses_real_1")
    const draft = rememberChatSlot(state, draftKey, factory("/repo/wt-a", draftKey, "Draft"))
    state = draft.state
    const stale = rememberChatSlot(state, realKey, factory("/repo/wt-a", realKey, "Stale"))
    state = stale.state

    const promoted = promoteChatSlot(state, draft.slot.id, realKey)
    expect(promoted.evicted).toEqual([stale.slot])
    expect(promoted.state.entries).toEqual([draft.slot])
    expect(promoted.state.recent).toEqual([draft.slot.id])
  })

  it("prunes slots whose backing directory is no longer alive", () => {
    const factory = makeFactory()
    let state = emptyChatCache<TestSlot>()

    const aKey = chatSlotKey("/repo/wt-a", "ses_a")
    const bKey = chatSlotKey("/repo/wt-b", "ses_b")
    state = rememberChatSlot(state, aKey, factory("/repo/wt-a", aKey, "A")).state
    state = rememberChatSlot(state, bKey, factory("/repo/wt-b", bKey, "B")).state

    expect(pruneChatSlots(state, () => true)).toBe(state)

    const pruned = pruneChatSlots(state, (slot) => slot.directory === "/repo/wt-b")
    expect(pruned.entries.map((item) => item.label)).toEqual(["B"])
    expect(pruned.recent).toEqual([2])
  })

  it("exposes default cache capacity >= 8 for multi-worktree switching", () => {
    expect(CHAT_CACHE_SIZE).toBeGreaterThanOrEqual(8)
  })
})
