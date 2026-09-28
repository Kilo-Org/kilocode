import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { resolveWorktreeFile } from "../../src/agent-manager/worktree-file-path"
import type { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

function state(worktree: { id: string; path: string }) {
  return {
    getWorktree: (id: string) => (id === worktree.id ? worktree : undefined),
    getSession: () => undefined,
  } as unknown as WorktreeStateManager
}

function repo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kilo-worktree-")))
  fs.writeFileSync(path.join(root, "file.ts"), "")
  return root
}

describe("resolveWorktreeFile", () => {
  it("resolves a relative path against the worktree directory", () => {
    const root = repo()

    expect(resolveWorktreeFile(state({ id: "wt", path: root }), "wt", "file.ts", undefined)).toBe(
      path.join(root, "file.ts"),
    )
  })

  it("returns absolute paths untouched, even without state", () => {
    const file = path.join(repo(), "file.ts")

    expect(resolveWorktreeFile(undefined, "wt", file, undefined)).toBe(file)
  })

  it("rejects a relative path that escapes the worktree directory", () => {
    const root = repo()
    const outside = repo()
    const target = path.relative(root, path.join(outside, "file.ts"))

    expect(resolveWorktreeFile(state({ id: "wt", path: root }), "wt", target, undefined)).toBeUndefined()
  })

  it("falls back to the project root for a local context", () => {
    const root = repo()

    expect(resolveWorktreeFile(state({ id: "wt", path: root }), "local", "file.ts", root)).toBe(
      path.join(root, "file.ts"),
    )
  })
})
