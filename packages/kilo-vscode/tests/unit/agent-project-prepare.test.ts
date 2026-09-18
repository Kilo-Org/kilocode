import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { GitOps } from "../../src/agent-manager/GitOps"
import { canonicalizePath } from "../../src/agent-manager/project/paths"
import {
  commit,
  configure,
  create,
  identity,
  initialize,
  inspect,
  validName,
} from "../../src/agent-manager/project/prepare"

let dir: string
let env: NodeJS.ProcessEnv
let git: GitOps

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-prepare-test-"))
  env = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_") || key === "EMAIL") delete process.env[key]
  }
  const config = path.join(dir, "global")
  await fs.writeFile(config, "[init]\n\tdefaultBranch = onboarding\n[commit]\n\tgpgsign = false\n")
  process.env.GIT_CONFIG_GLOBAL = config
  process.env.GIT_CONFIG_NOSYSTEM = "1"
  git = new GitOps({ log: () => {} })
})

afterEach(async () => {
  git.dispose()
  for (const key of Object.keys(process.env)) {
    if (!(key in env)) delete process.env[key]
  }
  Object.assign(process.env, env)
  await fs.rm(dir, { recursive: true, force: true })
})

async function run(root: string, ...args: string[]) {
  const result = await git.execGit(args, root)
  if (result.code) throw new Error(result.stderr)
  return result.stdout.trim()
}

async function project() {
  const { root } = await create(dir, "project", git)
  await configure(root, git, { name: "Preparation Test", email: "prepare@example.invalid" })
  return root
}

describe("project preparation", () => {
  it("creates an unborn repository, honors the branch preference, and enables its first managed worktree", async () => {
    const root = await project()
    expect(root).toBe(canonicalizePath(path.join(dir, "project")))
    expect(await inspect(root, git)).toEqual({ root, empty: true })
    expect(await run(root, "symbolic-ref", "--short", "HEAD")).toBe("onboarding")
    expect(await run(root, "remote")).toBe("")
    await commit(root, git)
    expect(await run(root, "ls-tree", "HEAD")).toBe("")
    const { WorktreeManager } = await import("../../src/agent-manager/WorktreeManager")
    const manager = new WorktreeManager(root, () => {}, git, undefined, 0)
    const worktree = await manager.createWorktree({ branchName: "first", baseBranch: "onboarding" })
    expect(await inspect(worktree.path, git)).toEqual({ root, empty: false })
    expect(await run(worktree.path, "rev-parse", "HEAD")).toBe(await run(root, "rev-parse", "HEAD"))
  })

  it("preserves staged, unstaged, and untracked files and the real index byte for byte", async () => {
    const root = await project()
    await fs.writeFile(path.join(root, "staged.txt"), "staged content")
    await run(root, "add", "staged.txt")
    await fs.writeFile(path.join(root, "staged.txt"), "unstaged content")
    await fs.writeFile(path.join(root, "untracked.txt"), "untracked content")
    const index = await fs.readFile(path.join(root, ".git", "index"))
    await commit(root, git)
    expect(await fs.readFile(path.join(root, ".git", "index"))).toEqual(index)
    expect(await run(root, "ls-tree", "HEAD")).toBe("")
    expect(await run(root, "show", ":staged.txt")).toBe("staged content")
    expect(await fs.readFile(path.join(root, "staged.txt"), "utf8")).toBe("unstaged content")
    expect(await run(root, "status", "--porcelain")).toBe("AM staged.txt\n?? untracked.txt")
  })

  it("reports a missing Git binary instead of a raw spawn error", async () => {
    const missing = { execGit: async () => ({ code: 1, stdout: "", stderr: "spawn git ENOENT" }) }
    await expect(inspect(dir, missing)).rejects.toThrow("Git is not installed")
  })

  it("treats a Git name with only disallowed characters as missing identity", async () => {
    const { root } = await create(dir, "project", git)
    await run(root, "config", "--local", "user.name", ",,")
    await run(root, "config", "--local", "user.email", "ok@example.invalid")
    expect(await identity(root, git)).toBe(false)
  })

  it("does not run reference-transaction hooks during the bootstrap update", async () => {
    const root = await project()
    const hooks = path.join(root, ".git", "hooks")
    await fs.mkdir(hooks, { recursive: true })
    await run(root, "config", "core.hooksPath", hooks)
    await fs.writeFile(path.join(hooks, "reference-transaction"), "#!/bin/sh\necho ran > hook-ran\n", { mode: 0o755 })
    await commit(root, git)
    expect(await run(root, "ls-tree", "HEAD")).toBe("")
    await expect(fs.stat(path.join(root, "hook-ran"))).rejects.toThrow()
  })

  it("does not install hooks from an ambient Git template directory", async () => {
    const template = path.join(dir, "template")
    await fs.mkdir(path.join(template, "hooks"), { recursive: true })
    await fs.writeFile(path.join(template, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
    process.env.GIT_TEMPLATE_DIR = template
    const root = path.join(dir, "templated")
    await fs.mkdir(root)
    const canonical = await initialize(root, git)
    const entries = await fs.readdir(path.join(canonical, ".git", "hooks")).catch(() => [] as string[])
    expect(entries).not.toContain("pre-commit")
  })

  it("initializes a populated folder only once without staging its files", async () => {
    const root = path.join(dir, "existing")
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, "source.txt"), "keep")
    expect(await inspect(root, git)).toEqual({ root: undefined, empty: true })
    const canonical = await initialize(root, git)
    await configure(root, git, { name: "Test", email: "test@example.invalid" })
    await commit(root, git)
    const head = await run(root, "rev-parse", "HEAD")
    expect(await initialize(root, git)).toBe(canonical)
    await commit(root, git)
    expect(await run(root, "rev-parse", "HEAD")).toBe(head)
    expect(await run(root, "status", "--porcelain")).toBe("?? source.txt")
  })

  it("does not create a commit on an orphan HEAD when another ref has history", async () => {
    const root = await project()
    await commit(root, git)
    const head = await run(root, "rev-parse", "HEAD")
    await run(root, "checkout", "--orphan", "orphan")
    expect(await inspect(root, git)).toEqual({ root, empty: false })
    await commit(root, git)
    expect((await git.execGit(["rev-parse", "--verify", "HEAD"], root)).code).not.toBe(0)
    expect(await run(root, "rev-list", "--all")).toBe(head)
  })

  it("preserves a detached HEAD even when no branch or tag references its commit", async () => {
    const root = await project()
    await commit(root, git)
    const head = await run(root, "rev-parse", "HEAD")
    await run(root, "checkout", "--detach")
    await run(root, "branch", "-D", "onboarding")
    expect((await git.execGit(["show-ref"], root)).code).toBe(1)
    expect(await inspect(root, git)).toEqual({ root, empty: false })
    await commit(root, git)
    expect(await run(root, "rev-parse", "HEAD")).toBe(head)
  })

  it("canonicalizes symlink parents and linked-worktree subfolders and rejects nested creation", async () => {
    const alias = path.join(dir, "alias")
    await fs.symlink(dir, alias, process.platform === "win32" ? "junction" : "dir")
    const { root, created } = await create(alias, "project", git)
    expect(root).toBe(canonicalizePath(path.join(dir, "project")))
    expect(created).toBe(true)
    await configure(root, git, { name: "Test", email: "test@example.invalid" })
    await commit(root, git)
    const linked = path.join(dir, "linked")
    await run(root, "worktree", "add", "-b", "linked", linked)
    const child = path.join(linked, "child")
    await fs.mkdir(child)
    expect(await inspect(child, git)).toEqual({ root, empty: false })
    expect(await initialize(child, git)).toBe(root)
    await expect(create(child, "nested", git)).rejects.toThrow("nested")
    await expect(fs.stat(path.join(child, "nested"))).rejects.toThrow()
    await expect(fs.stat(path.join(child, ".git"))).rejects.toThrow()
  })

  it("opens an occupied destination without removing or changing its contents", async () => {
    const occupied = path.join(dir, "occupied")
    await fs.mkdir(occupied)
    await fs.writeFile(path.join(occupied, "keep"), "keep")
    const result = await create(dir, "occupied", git)
    expect(result).toEqual({ root: canonicalizePath(occupied), created: false })
    expect(await fs.readFile(path.join(occupied, "keep"), "utf8")).toBe("keep")
    await expect(fs.stat(path.join(occupied, ".git"))).rejects.toThrow()
  })

  it("rejects malformed Git metadata, missing Git, files, bare repositories, home and filesystem root", async () => {
    const broken = path.join(dir, "broken")
    await fs.mkdir(path.join(broken, ".git"), { recursive: true })
    await expect(initialize(broken, git)).rejects.toThrow("metadata")
    expect(await fs.readdir(path.join(broken, ".git"))).toEqual([])
    await fs.rm(path.join(broken, ".git"), { recursive: true })
    await fs.writeFile(path.join(broken, ".git"), "gitdir: absent\n")
    await expect(initialize(broken, git)).rejects.toThrow()
    expect(await fs.readFile(path.join(broken, ".git"), "utf8")).toBe("gitdir: absent\n")
    const absent = new GitOps({ log: () => {}, binary: path.join(dir, "missing-git") })
    try {
      await expect(initialize(dir, absent)).rejects.toThrow()
      await expect(fs.stat(path.join(dir, ".git"))).rejects.toThrow()
    } finally {
      absent.dispose()
    }
    await expect(initialize(path.join(dir, "global"), git)).rejects.toThrow("Not a directory")
    const bare = path.join(dir, "bare")
    await run(dir, "init", "--bare", bare)
    await expect(initialize(bare, git)).rejects.toThrow()
    await expect(initialize(os.homedir(), git)).rejects.toThrow("home folder")
    await expect(initialize(path.parse(dir).root, git)).rejects.toThrow("filesystem root")
  })

  it("requires explicit identity and saves approved values only locally", async () => {
    const { root } = await create(dir, "project", git)
    expect(await identity(root, git)).toBe(false)
    await expect(commit(root, git)).rejects.toThrow("auto-detection is disabled")
    const before = await fs.readFile(process.env.GIT_CONFIG_GLOBAL!)
    await configure(root, git, { name: "Test", email: "test@example.invalid" })
    expect(await identity(root, git)).toBe(true)
    expect(await fs.readFile(process.env.GIT_CONFIG_GLOBAL!)).toEqual(before)
    expect(await run(root, "config", "--local", "user.name")).toBe("Test")
  })

  it("respects explicit author and committer environment identity without using OS guesses", async () => {
    const { root } = await create(dir, "project", git)
    process.env.GIT_AUTHOR_NAME = "Author"
    process.env.GIT_AUTHOR_EMAIL = "author@example.invalid"
    expect(await identity(root, git)).toBe(false)
    process.env.GIT_COMMITTER_NAME = "Committer"
    process.env.GIT_COMMITTER_EMAIL = "committer@example.invalid"
    expect(await identity(root, git)).toBe(true)
    await commit(root, git)
    expect(await run(root, "show", "-s", "--format=%an <%ae>%n%cn <%ce>")).toBe(
      "Author <author@example.invalid>\nCommitter <committer@example.invalid>",
    )
  })

  it("ignores ambient Git directory, worktree and index overrides", async () => {
    const other = await project()
    const index = path.join(dir, "ambient-index")
    await fs.writeFile(index, "do not touch")
    process.env.GIT_DIR = path.join(other, ".git")
    process.env.GIT_COMMON_DIR = path.join(other, ".git")
    process.env.GIT_WORK_TREE = other
    process.env.GIT_INDEX_FILE = index
    const { root } = await create(dir, "intended", git)
    await configure(root, git, { name: "Intended", email: "intended@example.invalid" })
    await commit(root, git)
    expect(await inspect(root, git)).toEqual({ root, empty: false })
    expect(await inspect(other, git)).toEqual({ root: other, empty: true })
    expect(await identity(other, git)).toBe(true)
    expect(await fs.readFile(index, "utf8")).toBe("do not touch")
  })

  it.each(["hook", "signing"])("creates an unsigned bootstrap commit despite configured %s policy", async (policy) => {
    const root = await project()
    await fs.writeFile(path.join(root, "staged"), "keep staged")
    await run(root, "add", "staged")
    const index = await fs.readFile(path.join(root, ".git", "index"))
    if (policy === "hook") {
      const hooks = path.join(root, ".git", "hooks")
      await fs.mkdir(hooks, { recursive: true })
      await run(root, "config", "core.hooksPath", hooks)
      for (const name of ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit"]) {
        await fs.writeFile(path.join(hooks, name), "#!/bin/sh\necho ran > hook-ran\nexit 1\n", { mode: 0o755 })
      }
    }
    if (policy === "signing") {
      await run(root, "config", "commit.gpgsign", "true")
      await run(root, "config", "gpg.program", path.join(dir, "missing-gpg"))
    }
    const config = await fs.readFile(path.join(root, ".git", "config"))
    await commit(root, git)
    expect(await inspect(root, git)).toEqual({ root, empty: false })
    expect(await run(root, "ls-tree", "HEAD")).toBe("")
    expect(await run(root, "cat-file", "commit", "HEAD")).not.toContain("gpgsig")
    expect(await run(root, "rev-list", "--parents", "-n", "1", "HEAD")).toBe(await run(root, "rev-parse", "HEAD"))
    expect(await fs.readFile(path.join(root, ".git", "config"))).toEqual(config)
    await expect(fs.stat(path.join(root, "hook-ran"))).rejects.toThrow()
    expect(await fs.readFile(path.join(root, ".git", "index"))).toEqual(index)
    expect(await fs.readFile(path.join(root, "staged"), "utf8")).toBe("keep staged")
  })

  it("does not let a staging hook add files to the bootstrap commit", async () => {
    const root = await project()
    await fs.writeFile(path.join(root, "hook-file"), "keep")
    await fs.writeFile(path.join(root, "staged"), "staged")
    await run(root, "add", "staged")
    const index = await fs.readFile(path.join(root, ".git", "index"))
    const hooks = path.join(root, ".git", "hooks")
    await fs.mkdir(hooks, { recursive: true })
    await run(root, "config", "core.hooksPath", hooks)
    await fs.writeFile(path.join(hooks, "pre-commit"), "#!/bin/sh\ngit add hook-file\n", { mode: 0o755 })
    await commit(root, git)
    expect(await run(root, "ls-tree", "--name-only", "HEAD")).toBe("")
    expect(await fs.readFile(path.join(root, ".git", "index"))).toEqual(index)
  })

  it("keeps a concurrently created initial commit instead of overwriting it", async () => {
    const root = await project()
    let head = ""
    await commit(root, {
      execGit: async (args, cwd, opts) => {
        if (args.includes("update-ref")) {
          await run(root, "commit", "--allow-empty", "-m", "User commit")
          head = await run(root, "rev-parse", "HEAD")
        }
        return git.execGit(args, cwd, opts)
      },
    })
    expect(head).not.toBe("")
    expect(await run(root, "rev-parse", "HEAD")).toBe(head)
    expect(await run(root, "show", "-s", "--format=%s")).toBe("User commit")
    expect(await run(root, "rev-list", "--count", "HEAD")).toBe("1")
  })

  it("does not redirect the branch update through a concurrently switched HEAD", async () => {
    const root = await project()
    let head = ""
    await expect(
      commit(root, {
        execGit: async (args, cwd, opts) => {
          if (args.includes("update-ref")) {
            await run(root, "symbolic-ref", "HEAD", "refs/heads/other")
            await run(root, "commit", "--allow-empty", "-m", "Other branch")
            head = await run(root, "rev-parse", "HEAD")
          }
          return git.execGit(args, cwd, opts)
        },
      }),
    ).rejects.toThrow("branch changed")
    expect(head).not.toBe("")
    expect(await run(root, "rev-parse", "HEAD")).toBe(head)
    expect(await run(root, "symbolic-ref", "HEAD")).toBe("refs/heads/other")
  })

  it("retains staged files when the guarded ref update fails", async () => {
    const root = await project()
    await fs.writeFile(path.join(root, "staged"), "keep staged")
    await run(root, "add", "staged")
    const index = await fs.readFile(path.join(root, ".git", "index"))
    await fs.writeFile(path.join(root, ".git", "refs", "heads", "onboarding.lock"), "held")
    await expect(commit(root, git)).rejects.toThrow("cannot lock ref")
    expect(await inspect(root, git)).toEqual({ root, empty: true })
    expect(await fs.readFile(path.join(root, ".git", "index"))).toEqual(index)
    expect(await fs.readFile(path.join(root, "staged"), "utf8")).toBe("keep staged")
  })

  it("uses Git's author and committer configuration and rejects invalid identity", async () => {
    const { root } = await create(dir, "project", git)
    for (const role of ["author", "committer"]) {
      await run(root, "config", `${role}.name`, role)
      await run(root, "config", `${role}.email`, `${role}@example.invalid`)
    }
    expect(await identity(root, git)).toBe(true)
    await commit(root, git)
    expect(await run(root, "show", "-s", "--format=%an <%ae>%n%cn <%ce>")).toBe(
      "author <author@example.invalid>\ncommitter <committer@example.invalid>",
    )
    process.env.GIT_AUTHOR_NAME = ""
    expect(await identity(root, git)).toBe(false)
    delete process.env.GIT_AUTHOR_NAME
    await fs.appendFile(path.join(root, ".git", "config"), "\n[broken\n")
    await expect(identity(root, git)).rejects.toThrow("bad config")
  })

  it("verifies an empty initial tree in SHA-256 repositories when supported", async () => {
    const root = path.join(dir, "sha256")
    const result = await git.execGit(["init", "--object-format=sha256", root], dir)
    if (result.code) {
      expect(result.stderr).toMatch(/unknown|unsupported|not supported/i)
      return
    }
    await configure(root, git, { name: "Test", email: "test@example.invalid" })
    await commit(root, git)
    expect((await run(root, "rev-parse", "HEAD")).length).toBe(64)
    expect(await run(root, "ls-tree", "HEAD")).toBe("")
  })

  it("validates portable child names", () => {
    for (const name of [
      "",
      ".",
      "..",
      "a/b",
      "a\\b",
      "a:b",
      "a?b",
      "name.",
      "name ",
      " name",
      ".git",
      "CON",
      "CONIN$",
      "CONOUT$",
      "nul.txt",
      "LPT1",
      "COM\u00b9",
      "x\x00y",
      "x".repeat(256),
    ]) {
      expect(validName(name)).toBe(false)
    }
    for (const name of ["project", "my-project", "my project", ".hidden", "console", "com10"]) {
      expect(validName(name)).toBe(true)
    }
  })
})
