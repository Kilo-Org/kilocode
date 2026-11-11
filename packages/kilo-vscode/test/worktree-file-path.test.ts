import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { resolveWorktreeFile, sessionDirectory } from "../src/agent-manager/worktree-file-path"
import type { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

function state(worktree: { id: string; path: string }, session?: { id: string; worktreeId: string | null }) {
  return {
    getWorktree: (id: string) => (id === worktree.id ? worktree : undefined),
    getSession: (id: string) => (session && id === session.id ? session : undefined),
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

  it("resolves a known local session to the project root", () => {
    const root = repo()

    expect(
      resolveWorktreeFile(
        state({ id: "wt", path: root }, { id: "ses-local", worktreeId: null }),
        "ses-local",
        "file.ts",
        root,
      ),
    ).toBe(path.join(root, "file.ts"))
  })

  it("does not fall back to the project root for an unknown id", () => {
    const root = repo()

    expect(resolveWorktreeFile(state({ id: "wt", path: root }), "ses-removed", "file.ts", root)).toBeUndefined()
  })

  it("falls back to the project root for a local context", () => {
    const root = repo()

    expect(resolveWorktreeFile(state({ id: "wt", path: root }), "local", "file.ts", root)).toBe(
      path.join(root, "file.ts"),
    )
  })
})

describe("sessionDirectory", () => {
  const manager = {
    getWorktree: (id: string) => (id === "wt" ? { id: "wt", path: "/worktrees/wt" } : undefined),
    getSession: (id: string) =>
      id === "ses_worktree" ? { id, worktreeId: "wt" } : id === "ses_local" ? { id } : undefined,
  } as unknown as WorktreeStateManager

  it("uses the worktree of a managed session", () => {
    expect(sessionDirectory(manager, "ses_worktree", "/repo")).toBe("/worktrees/wt")
  })

  it("falls back to the project root for a local session and no session", () => {
    expect(sessionDirectory(manager, "ses_local", "/repo")).toBe("/repo")
    expect(sessionDirectory(manager, null, "/repo")).toBe("/repo")
  })
})
