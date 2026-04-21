import { describe, it, expect } from "bun:test"
import { createMemoryStore, usePromptHistory } from "../use-prompt-history"
import { withRoot } from "./test-harness"

// ─── createMemoryStore tests ──────────────────────────────────────────────────

describe("createMemoryStore", () => {
  it("stores entries and returns them via list()", () => {
    const store = createMemoryStore()
    store.save("entry 1")
    store.save("entry 2")
    expect(store.list()).toEqual(["entry 1", "entry 2"])
  })

  it("drops oldest entry when capacity is exceeded", () => {
    const store = createMemoryStore(3)
    store.save("a")
    store.save("b")
    store.save("c")
    store.save("d") // "a" should be dropped

    const entries = store.list() as string[]
    expect(entries.length).toBe(3)
    expect(entries).not.toContain("a")
    expect(entries).toContain("d")
  })

  it("does not add duplicate consecutive entries", () => {
    const store = createMemoryStore()
    store.save("same")
    store.save("same")

    expect((store.list() as string[]).length).toBe(1)
  })
})

// ─── usePromptHistory tests ───────────────────────────────────────────────────

describe("usePromptHistory", () => {
  it("up() cycles through entries starting from most recent", () => {
    withRoot((dispose) => {
      const store = createMemoryStore()
      store.save("first")
      store.save("second")
      store.save("third")

      const { current, up } = usePromptHistory(store)

      expect(current()).toBe("") // starts at -1
      up()
      expect(current()).toBe("third") // most recent
      up()
      expect(current()).toBe("second")
      up()
      expect(current()).toBe("first") // oldest
      up()
      expect(current()).toBe("first") // capped at 0

      dispose()
    })
  })

  it("down() moves cursor toward -1 (live input)", () => {
    withRoot((dispose) => {
      const store = createMemoryStore()
      store.save("alpha")
      store.save("beta")

      const { current, up, down } = usePromptHistory(store)

      up() // index = 1 -> "beta"
      up() // index = 0 -> "alpha"
      down() // index = 1 -> "beta"
      expect(current()).toBe("beta")
      down() // index = -1 -> ""
      expect(current()).toBe("")
      down() // index stays -1
      expect(current()).toBe("")

      dispose()
    })
  })

  it("add() saves to store, refreshes history, and resets index to -1", () => {
    withRoot((dispose) => {
      const store = createMemoryStore()

      const { current, up, add } = usePromptHistory(store)

      add("hello")
      expect(current()).toBe("") // index reset to -1

      up() // should see "hello"
      expect(current()).toBe("hello")

      add("world")
      expect(current()).toBe("") // index reset again

      up()
      expect(current()).toBe("world") // most recent
      up()
      expect(current()).toBe("hello") // previous

      dispose()
    })
  })

  it("index reset to -1 means next up() starts from most recent entry", () => {
    withRoot((dispose) => {
      const store = createMemoryStore()
      store.save("old")

      const { current, up, add } = usePromptHistory(store)

      up()
      expect(current()).toBe("old")
      up() // already at oldest, capped at 0
      expect(current()).toBe("old")

      add("new entry")
      // After add, index is -1
      expect(current()).toBe("")
      up()
      expect(current()).toBe("new entry") // starts from most recent

      dispose()
    })
  })
})
