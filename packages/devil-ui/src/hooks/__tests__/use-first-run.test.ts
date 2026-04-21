/**
 * Tests for useFirstRun hook.
 */
import { describe, it, expect } from "bun:test"
import { withRoot } from "./test-harness"
import { useFirstRun } from "../use-first-run"

describe("useFirstRun", () => {
  it("returns isFirstRun=true when storage key is absent", () => {
    withRoot(() => {
      const storage: Record<string, string> = {}
      const { isFirstRun } = useFirstRun({
        storageKey: "test.first-run",
        readStorage: (k) => k in storage,
        writeStorage: (k, v) => { storage[k] = v },
      })
      expect(isFirstRun()).toBe(true)
    })
  })

  it("returns isFirstRun=false when storage key is present", () => {
    withRoot(() => {
      const storage: Record<string, string> = { "test.first-run.done": "done" }
      const { isFirstRun } = useFirstRun({
        storageKey: "test.first-run.done",
        readStorage: (k) => k in storage,
        writeStorage: (k, v) => { storage[k] = v },
      })
      expect(isFirstRun()).toBe(false)
    })
  })

  it("markComplete sets isFirstRun to false", async () => {
    await withRoot(async () => {
      const storage: Record<string, string> = {}
      const { isFirstRun, markComplete } = useFirstRun({
        storageKey: "test.mark",
        readStorage: (k) => k in storage,
        writeStorage: async (k, v) => { storage[k] = v },
      })
      expect(isFirstRun()).toBe(true)
      await markComplete()
      expect(isFirstRun()).toBe(false)
    })
  })

  it("markComplete writes to storage", async () => {
    await withRoot(async () => {
      const storage: Record<string, string> = {}
      const { markComplete } = useFirstRun({
        storageKey: "persist.key",
        readStorage: (k) => k in storage,
        writeStorage: async (k, v) => { storage[k] = v },
      })
      await markComplete()
      expect(storage["persist.key"]).toBe("done")
    })
  })

  it("returns an Accessor<boolean> for isFirstRun", () => {
    withRoot(() => {
      const { isFirstRun } = useFirstRun({
        storageKey: "type.check",
        readStorage: () => false,
        writeStorage: () => {},
      })
      // isFirstRun is a function (Accessor)
      expect(typeof isFirstRun).toBe("function")
    })
  })

  it("markComplete is a function returning Promise", () => {
    withRoot(() => {
      const { markComplete } = useFirstRun({
        storageKey: "fn.check",
        readStorage: () => false,
        writeStorage: () => {},
      })
      expect(typeof markComplete).toBe("function")
      const result = markComplete()
      expect(result instanceof Promise).toBe(true)
    })
  })

  it("second useFirstRun instance with same key reads persisted value", () => {
    withRoot(() => {
      const storage: Record<string, string> = {}
      const { markComplete } = useFirstRun({
        storageKey: "shared.key",
        readStorage: (k) => k in storage,
        writeStorage: (k, v) => { storage[k] = v },
      })
      void markComplete()

      // New instance reading the same storage
      const { isFirstRun: isFirstRun2 } = useFirstRun({
        storageKey: "shared.key",
        readStorage: (k) => k in storage,
        writeStorage: (k, v) => { storage[k] = v },
      })
      expect(isFirstRun2()).toBe(false)
    })
  })
})
