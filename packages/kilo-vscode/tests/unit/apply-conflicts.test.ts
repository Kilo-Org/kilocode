import { describe, it, expect } from "bun:test"
import {
  applyConflictAlerts,
  groupApplyConflicts,
  hasDirtyBaseConflict,
  mapApplyConflictReason,
  primaryConflictReason,
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

  it("shows the hint and keeps the raw git message for mixed conflicts", () => {
    const rows = groupApplyConflicts([
      { file: "src/a.ts", reason: "error: src/a.ts: does not match index" },
      { file: "src/new.ts", reason: "error: src/new.ts: does not exist in index" },
    ])
    const message = "error: src/new.ts: does not exist in index"
    expect(applyConflictAlerts(rows, message)).toEqual({ hint: true, message })
  })

  it("shows only the raw message when nothing is dirty", () => {
    const rows = groupApplyConflicts([{ file: "src/b.ts", reason: "patch failed" }])
    expect(applyConflictAlerts(rows, "boom")).toEqual({ hint: false, message: "boom" })
    expect(applyConflictAlerts(rows, "")).toEqual({ hint: false, message: undefined })
  })

  it("prefers the index reason when a file also has a patch failure", () => {
    const rows = groupApplyConflicts([
      { file: "src/a.ts", reason: "patch failed" },
      { file: "src/a.ts", reason: "does not match index" },
    ])
    expect(primaryConflictReason(rows[0]!)).toBe("does not match index")
    expect(primaryConflictReason({ reasons: [] })).toBe("")
  })
})
