import { describe, expect, test } from "bun:test"
import { tuningProblem } from "../../src/kilocode/components/dialog-indexing"

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
