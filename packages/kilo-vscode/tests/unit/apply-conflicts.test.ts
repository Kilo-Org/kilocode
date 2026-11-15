import { describe, it, expect } from "bun:test"
import {
  groupApplyConflicts,
  hasDirtyBaseConflict,
  mapApplyConflictReason,
} from "../../webview-ui/agent-manager/apply-conflicts"

describe("apply-conflicts", () => {
  it("groups conflict reasons by file and deduplicates reasons", () => {
    const rows = groupApplyConflicts([
      { file: "src/a.ts", reason: "patch failed" },
      { file: "src/a.ts", reason: "patch failed" },
      { file: "src/a.ts", reason: "does not match index" },
      { file: "src/b.ts", reason: "cannot read the current contents" },
      { reason: "general conflict" },
    ])

    expect(rows).toEqual([
      { file: "src/a.ts", reasons: ["patch failed", "does not match index"] },
      { file: "src/b.ts", reasons: ["cannot read the current contents"] },
      { file: undefined, reasons: ["general conflict"] },
    ])
  })

  it("maps known git conflict strings to reason keys", () => {
    expect(mapApplyConflictReason("error: src/a.ts: does not match index")).toBe("index")
    expect(mapApplyConflictReason("error: src/a.ts: patch does not apply")).toBe("patch")
    expect(mapApplyConflictReason("error: src/a.ts: patch failed")).toBe("patch")
    expect(mapApplyConflictReason("error: cannot read the current contents of 'src/a.ts'")).toBe("contents")
    expect(mapApplyConflictReason("some unexpected git error")).toBeUndefined()
  })

  it("detects a dirty base checkout from git's does-not-match-index error", () => {
    const rows = groupApplyConflicts([
      { file: "src/a.ts", reason: "error: src/a.ts: does not match index" },
      { file: "src/b.ts", reason: "error: src/b.ts: patch does not apply" },
    ])
    expect(hasDirtyBaseConflict(rows)).toBe(true)
  })

  it("does not flag a dirty base checkout for pure patch conflicts", () => {
    const rows = groupApplyConflicts([{ file: "src/b.ts", reason: "error: src/b.ts: patch does not apply" }])
    expect(hasDirtyBaseConflict(rows)).toBe(false)
    expect(hasDirtyBaseConflict([])).toBe(false)
  })
})
