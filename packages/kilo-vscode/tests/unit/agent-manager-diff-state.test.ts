import { describe, expect, it } from "bun:test"
import { mergeWorktreeDiffDetail, mergeWorktreeDiffs } from "../../webview-ui/agent-manager/diff-state"
import { initialOpenFiles } from "../../webview-ui/agent-manager/diff-open-policy"
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
  it("preserves loaded detail when summary metadata is unchanged", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n" })]
    const next = [diff({ summarized: true })]

    expect(mergeWorktreeDiffs(prev, next)).toEqual([diff({ summarized: false, before: "old\n", after: "new\n" })])
  })

  it("drops cached detail when summary metadata changes", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", additions: 1 })]
    const next = [diff({ summarized: true, additions: 2 })]

    expect(mergeWorktreeDiffs(prev, next)).toEqual(next)
  })

  it("drops cached detail when the summary stamp changes", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", stamp: "1:1" })]
    const next = [diff({ summarized: true, stamp: "1:2" })]

    expect(mergeWorktreeDiffs(prev, next)).toEqual(next)
  })

  it("applies detail when it still matches the current summary metadata", () => {
    const prev = [diff({ summarized: true, additions: 2, stamp: "1:2" })]
    const next = diff({ summarized: false, before: "old\n", after: "new\n", additions: 2, stamp: "1:2" })

    expect(mergeWorktreeDiffDetail(prev, next)).toEqual([next])
  })

  it("ignores stale detail when the summary metadata has already changed", () => {
    const prev = [diff({ summarized: true, additions: 2, stamp: "1:2" })]
    const stale = diff({ summarized: false, before: "old\n", after: "new\n", additions: 1, stamp: "1:1" })

    expect(mergeWorktreeDiffDetail(prev, stale)).toEqual(prev)
  })

  it("avoids generated-like files and keeps one preview open for large diff sets", () => {
    expect(
      initialOpenFiles([
        diff({ file: "src/app.ts", generatedLike: false, additions: 3 }),
        diff({ file: "node_modules/pkg/index.js", generatedLike: true, additions: 3 }),
      ]),
    ).toEqual(["src/app.ts"])

    const many = [
      diff({ file: "src/huge.ts", additions: 900, deletions: 30 }),
      diff({ file: "node_modules/pkg/index.js", generatedLike: true, additions: 1 }),
      ...Array.from({ length: 24 }, (_, i) => diff({ file: `src/${i}.ts`, additions: 5 + i })),
    ]
    expect(initialOpenFiles(many)).toEqual(["src/0.ts"])
  })
})
