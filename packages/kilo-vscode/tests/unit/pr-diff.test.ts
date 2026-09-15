import { describe, expect, it } from "bun:test"
import { canCommentOnPRLine, createPRDiffs } from "../../webview-ui/diff-viewer/pr-diff"
import type { PRDiffSnapshot } from "../../src/shared/pr-comment-actions"

const patch = ["@@ -1,3 +1,4 @@", " one", "-two", "+updated", "+another", " three", ""].join("\n")

const snapshot: PRDiffSnapshot = {
  id: "snapshot-1",
  head: "a".repeat(40),
  files: [{ path: "src/file.ts", status: "modified", patch }],
}

describe("PR diff adapter", () => {
  it("projects complete GitHub patches into diff viewer files", () => {
    expect(createPRDiffs(snapshot)).toEqual([
      {
        file: "src/file.ts",
        before: "one\ntwo\nthree\n",
        after: "one\nupdated\nanother\nthree\n",
        patch: "--- a/src/file.ts\n+++ b/src/file.ts\n" + patch,
        additions: 2,
        deletions: 1,
        status: "modified",
        tracked: true,
        stamp: "snapshot-1",
      },
    ])
  })

  it("accepts only ranges represented by the PR patch", () => {
    expect(canCommentOnPRLine(snapshot, "src/file.ts", "RIGHT", 2, 3)).toBe(true)
    expect(canCommentOnPRLine(snapshot, "src/file.ts", "LEFT", 2, 2)).toBe(true)
    expect(canCommentOnPRLine(snapshot, "src/file.ts", "RIGHT", 4, 4)).toBe(true)
    expect(canCommentOnPRLine(snapshot, "src/file.ts", "RIGHT", 5, 5)).toBe(false)
    expect(canCommentOnPRLine(snapshot, "other.ts", "RIGHT", 2, 2)).toBe(false)
  })

  it("does not project unsupported files", () => {
    expect(createPRDiffs({ ...snapshot, files: [{ path: "image.png", status: "modified" }] })).toEqual([])
  })

  it("accepts a line when GitHub rewrites a control-character escape in its patch", () => {
    // GitHub reports `\^@` where git reports the literal `\u0000` escape.
    const api = "@@ -1,2 +1,2 @@\n context\n-return key(a, b)\n+return `${a}\\^@${b}`"
    const value: PRDiffSnapshot = {
      id: "rewrite",
      head: "a".repeat(40),
      files: [{ path: "app.ts", status: "modified", patch: api }],
    }
    expect(canCommentOnPRLine(value, "app.ts", "RIGHT", 2, 2)).toBe(true)
    expect(canCommentOnPRLine(value, "app.ts", "LEFT", 2, 2)).toBe(true)
    expect(canCommentOnPRLine(value, "app.ts", "RIGHT", 3, 3)).toBe(false)
  })
})
