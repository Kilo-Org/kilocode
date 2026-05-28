import { describe, expect, it } from "bun:test"
import { mergeWorktreeDiffs } from "../../webview-ui/agent-manager/diff-state"
import {
  EXTREME_DIFF_CHANGED_LINES,
  allOpenFiles,
  expandableOpenFiles,
  initialOpenFiles,
  toggleOpenFiles,
} from "../../webview-ui/agent-manager/diff-open-policy"
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
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs).toEqual([diff({ summarized: false, before: "old\n", after: "new\n" })])
    expect(result.diffs[0]).toBe(prev[0])
    expect(result.stale.size).toBe(0)
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
