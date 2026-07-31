import { describe, expect, test } from "bun:test"
import path from "path"
import { containsPath, type InstanceContext } from "../../src/project/instance-context"

// Restores the boundary coverage lost with test/file/path-traversal.test.ts. The
// "inside directory OR worktree, except worktree === '/'" policy is Kilo-facing: it
// gates plan files, background processes, shell permissions, config classification,
// and LSP filtering, where a worktree path outside the working directory must not
// trigger the external_directory permission.

const root = path.resolve("/repo")

// containsPath only reads directory and worktree.
const ctx = (input: { directory: string; worktree: string }) => input as unknown as InstanceContext

describe("containsPath", () => {
  test("allows paths inside the working directory", () => {
    const c = ctx({ directory: root, worktree: root })
    expect(containsPath(path.join(root, "foo.txt"), c)).toBe(true)
    expect(containsPath(path.join(root, "src", "file.ts"), c)).toBe(true)
    expect(containsPath(root, c)).toBe(true)
  })

  test("allows worktree paths outside a nested working directory (monorepo subdirectory)", () => {
    const c = ctx({ directory: path.join(root, "packages", "lib"), worktree: root })
    expect(containsPath(path.join(root, ".opencode", "state"), c)).toBe(true)
    expect(containsPath(path.join(root, "packages", "other", "file.ts"), c)).toBe(true)
    expect(containsPath(root, c)).toBe(true)
  })

  test("rejects paths outside both directory and worktree", () => {
    const c = ctx({ directory: path.join(root, "packages", "lib"), worktree: root })
    expect(containsPath(path.resolve("/etc/passwd"), c)).toBe(false)
    expect(containsPath(path.resolve("/tmp/other-project"), c)).toBe(false)
  })

  test("rejects .. escapes and prefix collisions", () => {
    const c = ctx({ directory: root, worktree: root })
    expect(containsPath(path.join(root, "..", "escape.txt"), c)).toBe(false)
    expect(containsPath(path.join(root, "src", "..", "..", "etc"), c)).toBe(false)
    expect(containsPath(`${root}-other${path.sep}file`, c)).toBe(false)
  })

  test("worktree '/' (non-git project) does not allow arbitrary paths", () => {
    const c = ctx({ directory: path.join(root, "project"), worktree: "/" })
    expect(containsPath(path.join(root, "project", "file.txt"), c)).toBe(true)
    expect(containsPath(path.resolve("/etc/passwd"), c)).toBe(false)
    expect(containsPath(path.resolve("/tmp/other"), c)).toBe(false)
  })
})
