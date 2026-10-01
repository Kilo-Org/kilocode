import { describe, it, expect, beforeEach } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  canNavigate,
  appendEntry,
  seedEntries,
  usePromptHistory,
  MAX,
  MAX_CONVERSATIONS,
  MAX_ENTRY,
} from "../../webview-ui/src/hooks/usePromptHistory"

describe("canNavigate", () => {
  it("allows up when cursor is at start and not browsing", () => {
    expect(canNavigate("up", "hello", 0, false)).toBe(true)
  })

  it("blocks up when cursor is mid-text and not browsing", () => {
    expect(canNavigate("up", "hello", 3, false)).toBe(false)
  })

  it("allows down when cursor is at end and not browsing", () => {
    expect(canNavigate("down", "hello", 5, false)).toBe(true)
  })

  it("blocks down when cursor is mid-text and not browsing", () => {
    expect(canNavigate("down", "hello", 2, false)).toBe(false)
  })

  it("allows up at either boundary when browsing", () => {
    expect(canNavigate("up", "hello", 0, true)).toBe(true)
    expect(canNavigate("up", "hello", 5, true)).toBe(true)
  })

  it("allows down at either boundary when browsing", () => {
    expect(canNavigate("down", "hello", 0, true)).toBe(true)
    expect(canNavigate("down", "hello", 5, true)).toBe(true)
  })

  it("blocks browsing navigation when cursor is mid-text", () => {
    expect(canNavigate("up", "hello", 3, true)).toBe(false)
    expect(canNavigate("down", "hello", 3, true)).toBe(false)
  })

  it("allows both directions on empty input", () => {
    expect(canNavigate("up", "", 0, false)).toBe(true)
    expect(canNavigate("down", "", 0, false)).toBe(true)
  })

  it("clamps cursor to text bounds", () => {
    expect(canNavigate("up", "hi", -1, false)).toBe(true)
    expect(canNavigate("down", "hi", 999, false)).toBe(true)
  })
})

describe("appendEntry", () => {
  let entries: string[]

  beforeEach(() => {
    entries = []
  })

  it("prepends a trimmed entry", () => {
    appendEntry(entries, "hello", MAX)
    expect(entries).toEqual(["hello"])
  })

  it("trims whitespace", () => {
    appendEntry(entries, "  hello  ", MAX)
    expect(entries).toEqual(["hello"])
  })

  it("skips empty or whitespace-only text", () => {
    expect(appendEntry(entries, "", MAX)).toBe(false)
    expect(appendEntry(entries, "   ", MAX)).toBe(false)
    expect(entries).toEqual([])
  })

  it("deduplicates consecutive identical entries", () => {
    appendEntry(entries, "hello", MAX)
    expect(appendEntry(entries, "hello", MAX)).toBe(false)
    expect(entries).toEqual(["hello"])
  })

  it("moves existing entry to front instead of creating a duplicate", () => {
    appendEntry(entries, "first", MAX)
    appendEntry(entries, "second", MAX)
    appendEntry(entries, "first", MAX)
    expect(entries).toEqual(["first", "second"])
  })

  it("enforces max size", () => {
    for (let i = 0; i < 5; i++) entries.push(`old-${i}`)
    appendEntry(entries, "new", 3)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toBe("new")
  })

  it("returns true when entry was added", () => {
    expect(appendEntry(entries, "hello", MAX)).toBe(true)
  })

  it("returns false when entry was skipped", () => {
    entries.push("hello")
    expect(appendEntry(entries, "hello", MAX)).toBe(false)
  })
})

describe("seedEntries", () => {
  let entries: string[]

  beforeEach(() => {
    entries = []
  })

  it("seeds in reverse chronological order (newest first)", () => {
    seedEntries(entries, ["first", "second", "third"], MAX)
    expect(entries).toEqual(["third", "second", "first"])
  })

  it("skips empty and whitespace-only texts", () => {
    seedEntries(entries, ["", "  ", "valid"], MAX)
    expect(entries).toEqual(["valid"])
  })

  it("deduplicates against existing entries", () => {
    entries.push("existing")
    seedEntries(entries, ["existing", "new"], MAX)
    expect(entries).toEqual(["existing", "new"])
  })

  it("deduplicates within the input array", () => {
    seedEntries(entries, ["dup", "dup", "dup"], MAX)
    expect(entries).toEqual(["dup"])
  })

  it("enforces max size", () => {
    const texts = Array.from({ length: 150 }, (_, i) => `msg-${i}`)
    seedEntries(entries, texts, MAX)
    expect(entries).toHaveLength(MAX)
  })

  it("returns true when entries were added", () => {
    expect(seedEntries(entries, ["hello"], MAX)).toBe(true)
  })

  it("returns false when no entries were added", () => {
    entries.push("hello")
    expect(seedEntries(entries, ["hello"], MAX)).toBe(false)
  })

  it("returns false for all-empty input", () => {
    expect(seedEntries(entries, ["", "  "], MAX)).toBe(false)
  })

  it("preserves existing entries when seeding", () => {
    appendEntry(entries, "recent", MAX)
    seedEntries(entries, ["old1", "old2"], MAX)
    expect(entries[0]).toBe("recent")
    expect(entries).toEqual(["recent", "old2", "old1"])
  })
})

describe("append after seed — no duplicates", () => {
  it("does not create duplicates when appending a value that exists deeper in the array", () => {
    const entries: string[] = []
    // Simulate: session loaded with old messages, seed populates the array
    seedEntries(entries, ["hi", "there", "whats", "up"], MAX)
    // entries should be newest-first: ["up", "whats", "there", "hi"]
    expect(entries).toEqual(["up", "whats", "there", "hi"])

    // Now user re-sends "hi" — should move to front, NOT create a duplicate
    appendEntry(entries, "hi", MAX)
    expect(entries).toEqual(["hi", "up", "whats", "there"])
    expect(entries).toHaveLength(4)
  })

  it("reproduces the wrap-around bug: append only deduplicates entries[0]", () => {
    // Start with stale seed data (simulating old code or loaded session)
    const entries: string[] = ["hi", "there", "whats", "up"]

    // User sends messages in order: hi, there, whats, up
    appendEntry(entries, "hi", MAX) // entries[0] === "hi" → skip (consecutive dedup)
    appendEntry(entries, "there", MAX) // entries[0] === "hi" !== "there" → unshift
    appendEntry(entries, "whats", MAX)
    appendEntry(entries, "up", MAX)

    // Should have exactly 4 unique entries, not 7 with duplicates
    const unique = new Set(entries)
    expect(unique.size).toBe(4)
    expect(entries).toHaveLength(4)
  })

  it("concurrent sessions sharing module-level entries do not interfere", () => {
    // Both sessions share the same entries array (module-level)
    // Session A sends "alpha", Session B sends "beta"
    const entries: string[] = []
    appendEntry(entries, "alpha", MAX)
    appendEntry(entries, "beta", MAX)
    // Both are present, newest first
    expect(entries).toEqual(["beta", "alpha"])

    // Session A seeds with old messages ["x", "y"]
    seedEntries(entries, ["x", "y"], MAX)
    // Seeded entries go after existing, newest seeded first
    expect(entries).toEqual(["beta", "alpha", "y", "x"])

    // Session B sends "alpha" again — should move to front, not duplicate
    appendEntry(entries, "alpha", MAX)
    expect(entries.filter((e) => e === "alpha")).toHaveLength(1)
  })
})

describe("usePromptHistory — per-conversation isolation", () => {
  it("keeps history separate per session key", () => {
    createRoot((dispose) => {
      const [sidA, setSidA] = createSignal<string | undefined>("session-a-unique")
      const historyA = usePromptHistory(sidA)
      historyA.append("hello from A")

      const [sidB] = createSignal<string | undefined>("session-b-unique")
      const historyB = usePromptHistory(sidB)

      // Session B must not see session A's entries.
      expect(historyB.navigate("up", "", 0, [])).toBeNull()

      // Session A still sees its own entry.
      expect(historyA.navigate("up", "", 0, [])?.text).toBe("hello from A")

      dispose()
    })
  })

  it("does not leak entries across different keys used by the same hook instance", () => {
    createRoot((dispose) => {
      const [sid, setSid] = createSignal<string | undefined>("session-c-unique")
      const history = usePromptHistory(sid)
      history.append("first conversation message")
      expect(history.navigate("up", "", 0, [])?.text).toBe("first conversation message")

      setSid("session-d-unique")
      // Switching keys resets browsing state and reveals the new key's (empty) history.
      expect(history.navigate("up", "", 0, [])).toBeNull()

      history.append("second conversation message")
      expect(history.navigate("up", "", 0, [])?.text).toBe("second conversation message")

      dispose()
    })
  })

  it("resets browsing index when the conversation key changes", () => {
    createRoot((dispose) => {
      const [sid, setSid] = createSignal<string | undefined>("session-e-unique")
      const history = usePromptHistory(sid)
      history.append("a")
      history.append("b")
      history.navigate("up", "", 0, [])
      expect(history.index()).toBe(0)

      // The reset happens on the next action (navigate/append/seed), not merely by
      // reading `index()` — that accessor is a pure signal read with no side effects.
      setSid("session-f-unique")
      history.navigate("up", "", 0, [])
      expect(history.index()).toBe(-1)

      dispose()
    })
  })

  it("does not record prompts while the conversation has no key", () => {
    createRoot((dispose) => {
      const [sid] = createSignal<string | undefined>(undefined)
      const history = usePromptHistory(sid)
      history.append("sent before any session id exists")
      expect(history.navigate("up", "", 0, [])).toBeNull()
      dispose()
    })
  })

  it("re-keys a pending conversation to its real session", () => {
    createRoot((dispose) => {
      const [sid, setSid] = createSignal<string | undefined>("pending-move")
      const history = usePromptHistory(sid)
      history.append("first prompt", "pending-move")
      history.move("pending-move", "ses-move")
      setSid("ses-move")
      expect(history.navigate("up", "", 0, [])?.text).toBe("first prompt")
      dispose()
    })
  })

  it("keeps both lists, newest first, when the target already has entries", () => {
    createRoot((dispose) => {
      const [sid] = createSignal<string | undefined>("ses-merge")
      const history = usePromptHistory(sid)
      history.append("old")
      history.append("pending one", "pending-merge")
      history.move("pending-merge", "ses-merge")
      expect(history.navigate("up", "", 0, [])?.text).toBe("pending one")
      expect(history.navigate("up", "", 0, [])?.text).toBe("old")
      dispose()
    })
  })

  it("ignores prompts longer than the entry cap", () => {
    createRoot((dispose) => {
      const [sid] = createSignal<string | undefined>("ses-long")
      const history = usePromptHistory(sid)
      history.append("x".repeat(MAX_ENTRY + 1))
      history.seed(["y".repeat(MAX_ENTRY + 1)])
      expect(history.navigate("up", "", 0, [])).toBeNull()
      dispose()
    })
  })

  it("records an append against an explicit target key even after the active key changed", () => {
    createRoot((dispose) => {
      const [sid, setSid] = createSignal<string | undefined>("session-g-unique")
      const history = usePromptHistory(sid)

      // Simulate a send that resolves after the user has already switched conversations:
      // the entry must land in the conversation it was sent from, not the one now active.
      setSid("session-h-unique")
      history.append("sent from session-g-unique", "session-g-unique")

      // The now-active conversation (session-h-unique) must not see it.
      expect(history.navigate("up", "", 0, [])).toBeNull()

      setSid("session-g-unique")
      expect(history.navigate("up", "", 0, [])?.text).toBe("sent from session-g-unique")

      dispose()
    })
  })

  it("evicts the least recently used conversation once the cap is exceeded", () => {
    createRoot((dispose) => {
      // Comfortably larger than both the cap and whatever other tests in this file
      // already added to the shared module-level store, so the assertions below
      // are independent of test ordering.
      const batch = MAX_CONVERSATIONS + 100
      const histories = Array.from({ length: batch }, (_, i) => {
        const [sid] = createSignal<string | undefined>(`evict-${i}`)
        return usePromptHistory(sid)
      })
      histories.forEach((history, i) => history.append(`msg-${i}`))

      // The earliest conversation written in this batch was evicted...
      expect(histories[0]!.navigate("up", "", 0, [])).toBeNull()
      // ...while the most recently written one survives.
      expect(histories.at(-1)!.navigate("up", "", 0, [])?.text).toBe(`msg-${batch - 1}`)

      dispose()
    })
  })
})

describe("usePromptHistory — global mode", () => {
  it("shares one history across conversations while enabled", () => {
    createRoot((dispose) => {
      const [sid, setSid] = createSignal<string | undefined>("global-a")
      const history = usePromptHistory(sid, () => true)
      history.append("shared prompt")

      setSid("global-b")
      expect(history.navigate("up", "", 0, [])?.text).toBe("shared prompt")
      dispose()
    })
  })

  it("keeps the global list apart from per-conversation history", () => {
    createRoot((dispose) => {
      const [shared, setShared] = createSignal(true)
      const [sid] = createSignal<string | undefined>("global-c")
      const history = usePromptHistory(sid, shared)
      history.append("only global")

      setShared(false)
      expect(history.navigate("up", "", 0, [])).toBeNull()
      history.append("only local")

      setShared(true)
      expect(history.navigate("up", "", 0, [])?.text).toBe("only global")
      dispose()
    })
  })

  it("records an explicit target key into the shared bucket", () => {
    createRoot((dispose) => {
      const [sid, setSid] = createSignal<string | undefined>("global-e")
      const history = usePromptHistory(sid, () => true)
      setSid("global-f")
      history.append("sent from e", "global-e")
      expect(history.navigate("up", "", 0, [])?.text).toBe("sent from e")
      dispose()
    })
  })

  it("never evicts the global bucket", () => {
    createRoot((dispose) => {
      const [sid] = createSignal<string | undefined>("global-g")
      usePromptHistory(sid, () => true).append("keep me")
      for (let i = 0; i < MAX_CONVERSATIONS + 20; i++) {
        const [k] = createSignal<string | undefined>(`churn-${i}`)
        usePromptHistory(k).append(`m${i}`)
      }
      const history = usePromptHistory(sid, () => true)
      expect(history.navigate("up", "", 0, [])?.text).toBe("keep me")
      dispose()
    })
  })
})
