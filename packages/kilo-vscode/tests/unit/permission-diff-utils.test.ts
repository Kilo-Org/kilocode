import { describe, expect, test } from "bun:test"
import { permissionDiffs } from "../../webview-ui/src/components/chat/permission-diff-utils"
import type { PermissionRequest } from "../../webview-ui/src/types/messages"

function perm(args: PermissionRequest["args"]): PermissionRequest {
  return {
    id: "perm",
    sessionID: "ses",
    toolName: "edit",
    patterns: ["*"],
    always: ["*"],
    args,
  }
}

describe("permissionDiffs", () => {
  test("uses filediff metadata for edit and write permissions", () => {
    const diffs = permissionDiffs(
      perm({ filediff: { file: "src/app.ts", patch: "patch", additions: 1, deletions: 0 } }),
    )

    expect(diffs).toEqual([{ file: "src/app.ts", patch: "patch", additions: 1, deletions: 0 }])
  })

  test("uses apply_patch files metadata", () => {
    const diffs = permissionDiffs(
      perm({
        files: [
          { relativePath: "src/a.ts", type: "update", patch: "a", additions: 1, deletions: 1 },
          { relativePath: "src/b.ts", type: "add", patch: "b", additions: 2, deletions: 0 },
        ],
      }),
    )

    expect(diffs).toEqual([
      { file: "src/a.ts", patch: "a", additions: 1, deletions: 1 },
      { file: "src/b.ts", patch: "b", additions: 2, deletions: 0 },
    ])
  })

  test("falls back to raw diff metadata", () => {
    const diffs = permissionDiffs(perm({ filepath: "src/a.ts", diff: "Index: src/a.ts" }))

    expect(diffs).toEqual([{ file: "src/a.ts", patch: "Index: src/a.ts", additions: 0, deletions: 0 }])
  })

  test("returns no diffs for command-only permissions", () => {
    expect(permissionDiffs(perm({ command: "git status" }))).toEqual([])
  })
})
