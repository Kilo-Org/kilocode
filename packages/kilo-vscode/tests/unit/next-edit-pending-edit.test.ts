import { describe, expect, it } from "bun:test"
import { planInsertion, planReplacement } from "../../src/services/autocomplete/next-edit/pendingEdit"

describe("planInsertion", () => {
  it("appends after the final unterminated line at EOF", () => {
    const edit = planInsertion(
      { diffStartLine: 2, replacement: "third\n" },
      { lineCount: 2, end: (line) => [5, 6][line] },
    )

    expect(edit).toEqual({ line: 1, character: 6, text: "\nthird" })
  })

  it("keeps insertion-before-line semantics for a trailing empty line", () => {
    const edit = planInsertion(
      { diffStartLine: 1, replacement: "second\n" },
      { lineCount: 2, end: (line) => [5, 0][line] },
    )

    expect(edit).toEqual({ line: 1, character: 0, text: "second\n" })
  })
})

describe("planReplacement", () => {
  it("removes a middle line through the following separator", () => {
    const edit = planReplacement(
      { diffStartLine: 1, diffEndLine: 1, replacement: "", removesLines: true },
      { lineCount: 3, end: (line) => [6, 6, 5][line] },
    )

    expect(edit).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 2, character: 0 },
      text: "",
    })
  })

  it("removes a final line through the preceding separator", () => {
    const edit = planReplacement(
      { diffStartLine: 1, diffEndLine: 1, replacement: "", removesLines: true },
      { lineCount: 2, end: (line) => [6, 6][line] },
    )

    expect(edit).toEqual({
      start: { line: 0, character: 6 },
      end: { line: 1, character: 6 },
      text: "",
    })
  })

  it("preserves a line intentionally rewritten as blank", () => {
    const edit = planReplacement(
      { diffStartLine: 1, diffEndLine: 1, replacement: "", removesLines: false },
      { lineCount: 3, end: (line) => [6, 6, 5][line] },
    )

    expect(edit).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 6 },
      text: "",
    })
  })
})
