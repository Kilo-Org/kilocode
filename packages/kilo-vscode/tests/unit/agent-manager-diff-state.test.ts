import { describe, expect, it } from "bun:test"
import { mergeWorktreeDiffs } from "../../webview-ui/diff-viewer/diff-state"
import {
  EAGER_DIFF_REVIEW_LINES,
  EXTREME_DIFF_CHANGED_LINES,
  allOpenFiles,
  eagerDiffFiles,
  expandableOpenFiles,
  initialOpenFiles,
  toggleOpenFiles,
} from "../../webview-ui/diff-viewer/diff-open-policy"
import type { WorktreeFileDiff } from "../../webview-ui/src/types/messages"

function diff(overrides: Partial<WorktreeFileDiff>): WorktreeFileDiff {
  return {
    file: "src/app.ts",
    before: "",
    after: "",
    additions: 1,
    deletions: 0,
    status: "modified",
    tracked: true,
    generatedLike: false,
    summarized: true,
    stamp: "1:1",
    ...overrides,
  }
}

describe("agent manager diff state", () => {
  it("preserves loaded detail and patch when summary metadata is unchanged", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", patch: "@@ -1 +1 @@\n-old\n+new\n" })]
    const next = [diff({ summarized: true })]
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs).toEqual([
      diff({ summarized: false, before: "old\n", after: "new\n", patch: "@@ -1 +1 @@\n-old\n+new\n" }),
    ])
    expect(result.diffs[0]).toBe(prev[0])
    expect(result.stale.size).toBe(0)
  })

  it("replaces detailed content when patch anchors change", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", patch: "@@ -1 +1 @@\n-old\n+new\n" })]
    const next = [diff({ summarized: false, before: "old\n", after: "new\n", patch: "@@ -100 +100 @@\n-old\n+new\n" })]
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs[0]).toBe(next[0])
    expect(result.diffs[0]?.patch).toContain("@@ -100 +100 @@")
  })

  it("preserves cached content and marks stale when summary metadata changes", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", additions: 1 })]
    const next = [diff({ summarized: true, additions: 2 })]
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs[0]).toBe(prev[0])
    expect(result.stale).toEqual(new Set(["src/app.ts"]))
  })

  it("preserves cached content and marks stale when summary stamp changes", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", stamp: "1:1" })]
    const next = [diff({ summarized: true, stamp: "1:2" })]
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs[0]).toBe(prev[0])
    expect(result.stale).toEqual(new Set(["src/app.ts"]))
  })

  it("opens reviewable diffs initially", () => {
    expect(
      initialOpenFiles([
        diff({ file: "src/app.ts", generatedLike: false, additions: 3 }),
        diff({ file: "node_modules/pkg/index.js", generatedLike: true, additions: 3 }),
        diff({ file: "src/huge.ts", additions: EXTREME_DIFF_CHANGED_LINES + 1 }),
      ]),
    ).toEqual(["src/app.ts"])

    const many = Array.from({ length: 26 }, (_, i) => diff({ file: `src/${i}.ts` }))
    expect(initialOpenFiles(many)).toHaveLength(26)
  })

  it("expands only reviewable files from the bulk action", () => {
    expect(
      expandableOpenFiles([
        diff({ file: "src/app.ts", generatedLike: false, additions: 3 }),
        diff({ file: "src/generated.ts", generatedLike: true, additions: 3 }),
        diff({ file: "src/huge.ts", additions: EXTREME_DIFF_CHANGED_LINES + 1 }),
      ]),
    ).toEqual(["src/app.ts"])
  })

  it("toggles reviewable files based on whether every reviewable file is open", () => {
    const diffs = [
      diff({ file: "src/app.ts" }),
      diff({ file: "src/panel.ts" }),
      diff({ file: "src/generated.ts", generatedLike: true }),
      diff({ file: "src/huge.ts", additions: EXTREME_DIFF_CHANGED_LINES + 1 }),
    ]

    expect(allOpenFiles(diffs, [])).toBe(false)
    expect(allOpenFiles(diffs, ["stale.ts"])).toBe(false)
    expect(allOpenFiles(diffs, ["src/app.ts"])).toBe(false)
    expect(allOpenFiles(diffs, ["src/app.ts", "src/panel.ts"])).toBe(true)
    expect(allOpenFiles(diffs, ["stale.ts", "src/app.ts", "src/panel.ts", "src/generated.ts"])).toBe(true)

    expect(toggleOpenFiles(diffs, [])).toEqual(["src/app.ts", "src/panel.ts"])
    expect(toggleOpenFiles(diffs, ["stale.ts"])).toEqual(["src/app.ts", "src/panel.ts"])
    expect(toggleOpenFiles(diffs, ["src/app.ts"])).toEqual(["src/app.ts", "src/panel.ts"])
    expect(toggleOpenFiles(diffs, ["src/app.ts", "src/panel.ts"])).toEqual([])
  })
})

describe("eager diff files", () => {
  it("renders hunk-bounded detailed patches eagerly", () => {
    const diffs = [
      diff({ file: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b\n", additions: 10, deletions: 5 }),
      diff({ file: "src/b.ts", patch: "@@ -1 +1 @@\n-a\n+b\n", additions: 3, deletions: 0 }),
    ]
    expect(eagerDiffFiles(diffs)).toEqual(new Set(["src/a.ts", "src/b.ts"]))
  })

  it("virtualizes a full-content detail without a hunk-bounded patch", () => {
    const diffs = [diff({ file: "src/large-source.ts", before: "a\n".repeat(4000), after: "b\n", additions: 1 })]
    expect(eagerDiffFiles(diffs)).toEqual(new Set())
  })

  it("virtualizes files larger than the large-file threshold", () => {
    const diffs = [
      diff({ file: "src/big.ts", patch: "large", additions: EXTREME_DIFF_CHANGED_LINES + 1, deletions: 0 }),
      diff({ file: "src/small.ts", patch: "small", additions: 5, deletions: 0 }),
    ]
    expect(eagerDiffFiles(diffs)).toEqual(new Set(["src/small.ts"]))
  })

  it("stops rendering eagerly once the review budget is exhausted", () => {
    // Each file is under the large-file threshold, but together they exceed the
    // aggregate budget, so the overflow falls back to virtualization.
    const diffs = [
      diff({ file: "src/a.ts", patch: "a", additions: 2000, deletions: 0 }),
      diff({ file: "src/b.ts", patch: "b", additions: 2000, deletions: 0 }),
      diff({ file: "src/c.ts", patch: "c", additions: 2000, deletions: 0 }),
      diff({ file: "src/d.ts", patch: "d", additions: EAGER_DIFF_REVIEW_LINES - 6005, deletions: 0 }),
      diff({ file: "src/e.ts", patch: "e", additions: 2000, deletions: 0 }),
      diff({ file: "src/f.ts", patch: "f", additions: 5, deletions: 0 }),
    ]
    const eager = eagerDiffFiles(diffs)
    expect(eager.has("src/a.ts")).toBe(true)
    expect(eager.has("src/d.ts")).toBe(true)
    // Budget exhausted, so the next sizeable file virtualizes.
    expect(eager.has("src/e.ts")).toBe(false)
    // A smaller later file still fits within the remaining budget.
    expect(eager.has("src/f.ts")).toBe(true)
  })
})
