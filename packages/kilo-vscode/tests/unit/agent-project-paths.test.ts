import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { simpleGit } from "simple-git"
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
      ["rev-parse --show-toplevel", "/repo/worktree"],
      ["rev-parse --git-dir", "/repo/.git/worktrees/feature"],
      ["rev-parse --git-common-dir", "/repo/.git"],
      ["worktree list --porcelain -z", "worktree /repo\0HEAD abc\0\0worktree /repo/worktree\0HEAD def\0"],
    ])
    const root = await resolveProjectRoot("/repo/worktree", async (_cwd, args) => calls.get(args.join(" ")) ?? "")

    expect(root).toBe(canonicalizePath("/repo"))
  })

  it("rejects option-contaminated top-level output instead of using the process cwd", async () => {
    const root = await resolveProjectRoot(os.tmpdir(), async () => `--path-format=absolute\n${os.tmpdir()}\n`)
    expect(root).toBeUndefined()
  })

  it("resolves relative metadata paths against the Git cwd", async () => {
    const dir = path.join(os.tmpdir(), "pp-relative", "server")
    const root = path.dirname(dir)
    const calls = new Map([
      ["rev-parse --show-toplevel", `${root}\n`],
      ["rev-parse --git-dir", "../.git\n"],
      ["rev-parse --git-common-dir", `${path.join(root, ".git")}\n`],
    ])
    const commands: string[] = []
    const result = await resolveProjectRoot(dir, async (_cwd, args) => {
      commands.push(args.join(" "))
      return calls.get(args.join(" ")) ?? ""
    })
    expect(result).toBe(canonicalizePath(root))
    expect(commands).toEqual([...calls.keys()])
  })

  it.each([undefined, "worktree --path-format=absolute\ninvalid\0"])(
    "falls back to the valid checkout when worktree listing is unavailable or malformed (%s)",
    async (listing) => {
      const dir = path.join(os.tmpdir(), "pp-linked")
      const calls = new Map([
        ["rev-parse --show-toplevel", `${dir}\n`],
        ["rev-parse --git-dir", path.join(os.tmpdir(), "repo", ".git", "worktrees", "linked")],
        ["rev-parse --git-common-dir", path.join(os.tmpdir(), "repo", ".git")],
        ["worktree list --porcelain -z", listing],
      ])
      const root = await resolveProjectRoot(dir, async (_cwd, args) => {
        const output = calls.get(args.join(" "))
        if (output == null) throw new Error("unsupported option")
        return output
      })
      expect(root).toBe(canonicalizePath(dir))
    },
  )

  it("resolves real Unicode checkout and linked-worktree subfolders without newer Git flags", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-git-"))
    const root = path.join(dir, "\u76ee\u5f55 primary")
    const linked = path.join(dir, "\u76ee\u5f55 linked")
    fs.mkdirSync(root)
    try {
      const git = simpleGit(root)
      await git.init()
      await git.raw([
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "init",
      ])
      await git.raw(["worktree", "add", "-b", "linked", linked])
      for (const checkout of [root, linked]) {
        const subdir = path.join(checkout, "server")
        fs.mkdirSync(subdir)
        const result = await resolveProjectRoot(subdir, (cwd, args) => {
          expect(args.some((arg) => arg.startsWith("--path-format"))).toBe(false)
          return simpleGit(cwd).raw(args)
        })
        expect(result).toBe(canonicalizePath(root))
      }
      const fallback = await resolveProjectRoot(path.join(linked, "server"), (cwd, args) => {
        if (args.includes("-z")) throw new Error("unsupported option: -z")
        return simpleGit(cwd).raw(args)
      })
      expect(fallback).toBe(canonicalizePath(root))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
