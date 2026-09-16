import { describe, expect, test } from "bun:test"
import { normalize } from "../components/session-diff"
import { EXTREME_DIFF_CHANGED_LINES, MAX_EAGER_DIFF_BYTES, virtualize } from "./index"

// Builds the same metadata the inline card renders, from a real patch.
function metadata(additions: number, line: string) {
  const body = Array.from({ length: additions }, () => `+${line}`).join("\n")
  const patch = `--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,${additions} @@\n${body}\n`
  return normalize({ file: "a.ts", patch, additions, deletions: 0 })?.fileDiff
}

describe("inline file diff virtualization", () => {
  test("materializes only the added lines", () => {
    expect(metadata(3, "const a = 1")?.additionLines.length).toBe(3)
  })

  test("renders hunk-bounded diffs eagerly so the instance survives streamed updates", () => {
    expect(virtualize(metadata(2, "const a = 1"))).toBe(false)
  })

  test("virtualizes without metadata", () => {
    expect(virtualize(undefined)).toBe(true)
  })

  test("falls back to the virtualizer past the changed line limit", () => {
    expect(virtualize(metadata(EXTREME_DIFF_CHANGED_LINES, "const a = 1"))).toBe(false)
    expect(virtualize(metadata(EXTREME_DIFF_CHANGED_LINES + 1, "const a = 1"))).toBe(true)
  })

  test("falls back to the virtualizer past the eager byte limit", () => {
    expect(virtualize(metadata(2, "x".repeat(1_000)))).toBe(false)
    expect(virtualize(metadata(2, "x".repeat(MAX_EAGER_DIFF_BYTES / 2)))).toBe(true)
  })
})
