import { describe, expect, test } from "bun:test"
import path from "path"
import { WorktreeOverlay } from "../../../src/indexing/worktree-overlay"

describe("WorktreeOverlay", () => {
  test("seeds baseline hashes and shadows changed or deleted files", () => {
    const root = path.resolve("/tmp/worktree")
    const overlay = new WorktreeOverlay(
      root,
      path.resolve("/tmp/main"),
      new Map([
        ["src/same.ts", "same"],
        ["src/changed.ts", "base"],
        ["src/deleted.ts", "deleted"],
      ]),
    )

    expect(overlay.seed()).toEqual({
      [path.join(root, "src/same.ts")]: "same",
      [path.join(root, "src/changed.ts")]: "base",
      [path.join(root, "src/deleted.ts")]: "deleted",
    })

    overlay.reconcile({
      [path.join(root, "src/same.ts")]: "same",
      [path.join(root, "src/changed.ts")]: "worktree",
    })

    expect(overlay.ready).toBe(true)
    expect([...overlay.shadows].sort()).toEqual(["src/changed.ts", "src/deleted.ts"])
  })

  test("blocks updates and restores baseline visibility after a revert", () => {
    const root = path.resolve("/tmp/worktree")
    const file = path.join(root, "src/file.ts")
    const overlay = new WorktreeOverlay(root, path.resolve("/tmp/main"), new Map([["src/file.ts", "base"]]))

    overlay.block(file)
    expect(overlay.blocked.has("src/file.ts")).toBe(true)

    overlay.settle(file, "changed")
    expect(overlay.blocked.has("src/file.ts")).toBe(false)
    expect(overlay.shadows.has("src/file.ts")).toBe(true)

    overlay.block(file)
    overlay.settle(file, "base")
    expect(overlay.blocked.has("src/file.ts")).toBe(false)
    expect(overlay.shadows.has("src/file.ts")).toBe(false)
  })
})
