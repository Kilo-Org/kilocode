import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  canonicalizePath,
  findTrackedBranch,
  resolveProjectRoot,
  samePath,
} from "../../src/agent-manager/project/paths"

describe("project-paths", () => {
  it("canonicalizePath resolves a symlink alias to its realpath", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-root-"))
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "pp-target-"))
    const alias = path.join(root, "alias")
    fs.symlinkSync(target, alias)
    try {
      expect(canonicalizePath(alias)).toBe(canonicalizePath(target))
      expect(canonicalizePath(alias)).not.toBe(alias)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(target, { recursive: true, force: true })
    }
  })

  it("samePath folds case on darwin/win32 and matches exactly on linux", () => {
    expect(samePath("/x/Y", "/x/y", "darwin")).toBe(true)
    expect(samePath("/x/Y", "/x/y", "win32")).toBe(true)
    expect(samePath("/x/Y", "/x/y", "linux")).toBe(false)
    expect(samePath("/x/y", "/x/y", "linux")).toBe(true)
  })

  it("findTrackedBranch matches a symlink-aliased path against realpath keys", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-tracked-"))
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "pp-target-"))
    const alias = path.join(root, "alias")
    fs.symlinkSync(target, alias)
    try {
      // git worktree list --porcelain realpath-resolves registration, so the
      // tracked key is the realpath, not the lexical alias a session was
      // registered with.
      const tracked = new Map<string, string>([[canonicalizePath(target), "branch-a"]])
      expect(findTrackedBranch(tracked, alias)).toBe("branch-a")
      expect(findTrackedBranch(tracked, target)).toBe("branch-a")
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(target, { recursive: true, force: true })
    }
  })

  it("findTrackedBranch matches a lexical-keyed map by canonicalizing both sides", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-lexical-"))
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "pp-lexical-target-"))
    const alias = path.join(root, "alias")
    fs.symlinkSync(target, alias)
    try {
      // A map keyed by the lexical alias (as older code paths produced) must
      // still match a probe path that canonicalizes to the same realpath.
      const tracked = new Map<string, string>([[alias, "branch-a"]])
      expect(findTrackedBranch(tracked, target)).toBe("branch-a")
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(target, { recursive: true, force: true })
    }
  })

  it("findTrackedBranch returns undefined for an untracked existing path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-untracked-"))
    const other = path.join(root, "other")
    fs.mkdirSync(other, { recursive: true })
    try {
      const tracked = new Map<string, string>([[canonicalizePath(root), "branch-a"]])
      expect(findTrackedBranch(tracked, other)).toBeUndefined()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("resolveProjectRoot maps a linked worktree to the primary checkout", async () => {
    const calls = new Map([
      ["rev-parse --path-format=absolute --show-toplevel", "/repo/worktree"],
      ["rev-parse --path-format=absolute --git-dir", "/repo/.git/worktrees/feature"],
      ["rev-parse --path-format=absolute --git-common-dir", "/repo/.git"],
      ["worktree list --porcelain -z", "worktree /repo\0HEAD abc\0\0worktree /repo/worktree\0HEAD def\0"],
    ])
    const root = await resolveProjectRoot("/repo/worktree", async (_cwd, args) => calls.get(args.join(" ")) ?? "")

    expect(root).toBe(canonicalizePath("/repo"))
  })
})
