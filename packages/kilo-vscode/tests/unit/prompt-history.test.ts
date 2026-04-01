import { describe, it, expect, beforeEach } from "bun:test"
import { canNavigate, appendEntry, seedEntries, MAX } from "../../webview-ui/src/hooks/usePromptHistory"

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
