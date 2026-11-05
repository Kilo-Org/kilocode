import { describe, expect, test } from "bun:test"
import { saveTuning, tuningProblem } from "../../src/kilocode/components/dialog-indexing"

describe("indexing tuning validation", () => {
  test("accepts a similarity in 0..1 and positive whole numbers", () => {
    expect(tuningProblem("searchMinScore", "0.4", 0.4)).toBeUndefined()
    expect(tuningProblem("searchMaxResults", "50", 50)).toBeUndefined()
    expect(tuningProblem("searchMinScore", "", undefined)).toBeUndefined()
  })

  test("rejects a similarity outside 0..1", () => {
    expect(tuningProblem("searchMinScore", "2", 2)).toBe("Search Min Score must be between 0 and 1")
    expect(tuningProblem("searchMinScore", "-1", -1)).toBe("Search Min Score must be between 0 and 1")
  })

  test("rejects non-numbers and non-positive or fractional counts", () => {
    expect(tuningProblem("searchMaxResults", "abc", Number.NaN)).toBe('Invalid number: "abc"')
    expect(tuningProblem("searchMaxResults", "0", 0)).toBe("Enter a positive whole number")
    expect(tuningProblem("embeddingBatchSize", "1.5", 1.5)).toBe("Enter a positive whole number")
  })
})

describe("indexing tuning save", () => {
  const raw = { enabled: true, searchMaxResults: 20 }
  const fixture = (update: () => Promise<unknown>) => {
    const toasts: string[] = []
    const writes: unknown[] = []
    const rpc = {
      "config.update": (input: unknown) => {
        writes.push(input)
        return update()
      },
    }
    const toast = { show: (input: { message: string }) => toasts.push(input.message) }
    return { rpc: rpc as never, toast: toast as never, toasts, writes }
  }

  test("shows the new value when the server accepts the save", async () => {
    const state = fixture(async () => ({}))
    const shown = await saveTuning(state.rpc, { directory: "/repo" }, "project", raw, "searchMaxResults", 30, state.toast)
    expect(shown).toEqual({ enabled: true, searchMaxResults: 30 })
    expect(state.writes).toEqual([{ scope: "project", config: { enabled: true, searchMaxResults: 30 } }])
    expect(state.toasts).toEqual(["Indexing config saved"])
  })

  test("keeps the old value when the server rejects the save", async () => {
    const state = fixture(async () => {
      throw new Error("invalid")
    })
    const shown = await saveTuning(state.rpc, { directory: "/repo" }, "project", raw, "searchMaxResults", 30, state.toast)
    expect(shown).toBe(raw)
    expect(state.toasts).toEqual(["Failed to save indexing config"])
  })
})
