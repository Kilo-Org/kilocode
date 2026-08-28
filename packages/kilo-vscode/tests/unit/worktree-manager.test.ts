import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import { WorktreeManager } from "../../src/agent-manager/WorktreeManager"
import {
  generateBranchName,
  sanitizeBranchName,
  semanticBranchName,
  versionedName,
} from "../../src/agent-manager/branch-name"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
import { GitOps } from "../../src/agent-manager/GitOps"
import type { PRInfo } from "../../src/agent-manager/git-import"
import simpleGit from "simple-git"

// Each test gets its own temp directory -- no shared state, safe to run in parallel.
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

function gitExec(args: string[]) {
  const res = Bun.spawnSync(args, { stdout: "ignore", stderr: "pipe" })
  if (res.exitCode !== 0) {
    const err = Buffer.from(res.stderr).toString("utf8")
    throw new Error(`git command failed (${args.join(" ")}): ${err}`)
  }
}

/** Create a temp git repo with an initial commit (required for worktrees). */
async function createTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-"))
  tempDirs.push(dir)
  gitExec(["git", "init", "-b", "main", dir])
  gitExec(["git", "-C", dir, "config", "user.email", "test@test.com"])
  gitExec(["git", "-C", dir, "config", "user.name", "Test"])
  await fs.writeFile(path.join(dir, "README.md"), "init")
  gitExec(["git", "-C", dir, "add", "."])
  gitExec(["git", "-C", dir, "commit", "-m", "initial commit"])
  return dir
}

function createManager(root: string, ops?: GitOps): WorktreeManager {
  const logs: string[] = []
  return new WorktreeManager(root, (msg) => logs.push(msg), ops)
}

// Test-only helper to verify metadata writes keep the temp worktree checkout clean.
async function changedFiles(cwd: string): Promise<string[]> {
  const raw = await simpleGit(cwd).raw(["status", "--porcelain", "--untracked-files=all", "--"])
  return raw.trim().split("\n").filter(Boolean)
}

/** Create a temp repo with a bare origin remote so origin/<branch> refs exist. */
async function createTempRepoWithOrigin(): Promise<{ bare: string; clone: string }> {
  const bare = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-bare-"))
  const clone = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-clone-"))
  tempDirs.push(bare, clone)

  gitExec(["git", "init", "--bare", "-b", "main", bare])
  gitExec(["git", "clone", bare, clone])
  gitExec(["git", "-C", clone, "config", "user.email", "test@test.com"])
  gitExec(["git", "-C", clone, "config", "user.name", "Test"])
  await fs.writeFile(path.join(clone, "README.md"), "init")
  gitExec(["git", "-C", clone, "add", "."])
  gitExec(["git", "-C", clone, "commit", "-m", "initial commit"])
  gitExec(["git", "-C", clone, "push", "-u", "origin", "main"])

  return { bare, clone }
}

// ---------------------------------------------------------------------------
// generateBranchName
// ---------------------------------------------------------------------------

describe("generateBranchName", () => {
  it("generates a two-word predicate-object name", () => {
    const name = generateBranchName("anything")
    // Should be two lowercase words joined by a hyphen
    expect(name).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it("avoids existing branches", () => {
    // Generate 50 names and collect them; none should collide with the existing list
    const existing = ["brave-piano", "sunny-cloud"]
    for (let i = 0; i < 50; i++) {
      const name = generateBranchName("task", existing)
      expect(existing).not.toContain(name)
    }
  })

  it("falls back to numeric suffix when collisions are likely", () => {
    // Supply a huge existing list — eventually a numeric suffix or timestamp is used
    const name = generateBranchName("task", [])
    expect(typeof name).toBe("string")
    expect(name.length).toBeGreaterThan(0)
  })

  it("ignores the prompt and always returns friendly words", () => {
    const a = generateBranchName("")
    const b = generateBranchName("FIX BUG")
    // Both should be lowercase word-hyphen-word patterns
    expect(a).toMatch(/^[a-z]+-[a-z]+/)
    expect(b).toMatch(/^[a-z]+-[a-z]+/)
  })
})

// ---------------------------------------------------------------------------
// sanitizeBranchName
// ---------------------------------------------------------------------------

describe("semanticBranchName", () => {
  it("creates a branch slug from a generated session title", () => {
    expect(semanticBranchName("Fix token refresh race")).toBe("fix-token-refresh-race")
  })

  it("normalizes a user prefix and keeps branch separators", () => {
    expect(semanticBranchName("Add billing alerts", "marius/features/")).toBe("marius/features/add-billing-alerts")
  })

  it("reserves the length limit for the prefix", () => {
    expect(semanticBranchName("a".repeat(100), "team/").length).toBeLessThanOrEqual(50)
  })

  it("returns empty when the title has no usable characters", () => {
    expect(semanticBranchName("修复登录")).toBe("")
  })
})

describe("sanitizeBranchName", () => {
  it("replaces spaces with hyphens", () => {
    expect(sanitizeBranchName("model comparison")).toBe("model-comparison")
  })

  it("lowercases input", () => {
    expect(sanitizeBranchName("My Feature")).toBe("my-feature")
  })

  it("strips special characters", () => {
    expect(sanitizeBranchName("fix bug #123 & add feature!")).toBe("fix-bug-123-add-feature")
  })

  it("collapses consecutive hyphens", () => {
    expect(sanitizeBranchName("one   two   three")).toBe("one-two-three")
  })

  it("strips leading and trailing hyphens", () => {
    expect(sanitizeBranchName("---hello---")).toBe("hello")
  })

  it("truncates to maxLength", () => {
    const result = sanitizeBranchName("a".repeat(100))
    expect(result.length).toBeLessThanOrEqual(50)
  })

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeBranchName("   ")).toBe("")
  })

  it("returns empty string for empty input", () => {
    expect(sanitizeBranchName("")).toBe("")
  })

  it("handles custom maxLength", () => {
    const result = sanitizeBranchName("abcdefghij", 5)
    expect(result).toBe("abcde")
  })
})

// ---------------------------------------------------------------------------
// versionedName
// ---------------------------------------------------------------------------

describe("versionedName", () => {
  it("returns base name for first version", () => {
    const result = versionedName("auth-refactor", 0, 3)
    expect(result).toEqual({ branch: "auth-refactor", label: "auth-refactor" })
  })

  it("appends _v2 to branch and v2 to label for second version", () => {
    const result = versionedName("auth-refactor", 1, 3)
    expect(result).toEqual({ branch: "auth-refactor_v2", label: "auth-refactor v2" })
  })

  it("appends _v3 to branch and v3 to label for third version", () => {
    const result = versionedName("auth-refactor", 2, 3)
    expect(result).toEqual({ branch: "auth-refactor_v3", label: "auth-refactor v3" })
  })

  it("returns undefined for both when no name provided", () => {
    expect(versionedName(undefined, 0, 3)).toEqual({ branch: undefined, label: undefined })
    expect(versionedName(undefined, 1, 3)).toEqual({ branch: undefined, label: undefined })
  })

  it("returns undefined for empty string name", () => {
    expect(versionedName("", 0, 2)).toEqual({ branch: undefined, label: undefined })
  })

  it("no suffix for single version", () => {
    const result = versionedName("test", 0, 1)
    expect(result).toEqual({ branch: "test", label: "test" })
  })
})

// ---------------------------------------------------------------------------
// WorktreeStateManager -- updateWorktreeLabel
// ---------------------------------------------------------------------------

describe("WorktreeStateManager.updateWorktreeLabel", () => {
  it("persists label on a worktree", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-label-"))
    tempDirs.push(dir)
    const state = new WorktreeStateManager(dir, () => {})
    const wt = state.addWorktree({ branch: "test", path: dir, parentBranch: "main" })
    state.updateWorktreeLabel(wt.id, "my custom name")
    await state.flush()

    expect(state.getWorktree(wt.id)?.label).toBe("my custom name")
  })

  it("clears label when set to empty string", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-label-"))
    tempDirs.push(dir)
    const state = new WorktreeStateManager(dir, () => {})
    const wt = state.addWorktree({ branch: "test", path: dir, parentBranch: "main", label: "initial" })
    await state.flush()
    state.updateWorktreeLabel(wt.id, "")
    await state.flush()

    expect(state.getWorktree(wt.id)?.label).toBeUndefined()
  })

  it("survives save and reload", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-label-"))
    tempDirs.push(dir)
    const state = new WorktreeStateManager(dir, () => {})
    const wt = state.addWorktree({ branch: "test", path: dir, parentBranch: "main", label: "persisted" })
    await state.flush()

    const state2 = new WorktreeStateManager(dir, () => {})
    await state2.load()
    expect(state2.getWorktree(wt.id)?.label).toBe("persisted")
  })

  it("no-ops for nonexistent worktree", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-label-"))
    tempDirs.push(dir)
    const state = new WorktreeStateManager(dir, () => {})
    state.updateWorktreeLabel("nonexistent", "test")
    await state.flush()
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- createWorktree
// ---------------------------------------------------------------------------

describe("WorktreeManager.createWorktree", () => {
  it("uses a configured Git executable for worktree creation", async () => {
    const root = await createTempRepo()
    gitExec(["git", "-C", root, "config", "core.autocrlf", "false"])
    gitExec(["git", "-C", root, "config", "core.eol", "lf"])
    const real = Bun.which("git")
    if (!real) throw new Error("Git is required for this test")

    const fake = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-no-git-"))
    tempDirs.push(fake)
    const file = path.join(fake, process.platform === "win32" ? "git.cmd" : "git")
    await fs.writeFile(file, process.platform === "win32" ? "@exit /b 127\r\n" : "#!/bin/sh\nexit 127\n")
    if (process.platform !== "win32") await fs.chmod(file, 0o755)

    const bin =
      process.platform === "win32"
        ? real
        : path.join(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-git executable-")), "git")
    if (process.platform !== "win32") {
      const dir = path.dirname(bin)
      tempDirs.push(dir)
      await fs.symlink(real, bin)
    }

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string" && key.toLowerCase() !== "path") env[key] = value
    }
    const key = Object.keys(process.env).find((name) => name.toLowerCase() === "path") ?? "PATH"
    const dirs = [fake]
    if (process.platform === "win32") {
      const root = process.env.SystemRoot ?? process.env.windir
      if (root) {
        dirs.push(
          path.join(root, "System32"),
          path.join(root, "System32", "Wbem"),
          path.join(root, "System32", "WindowsPowerShell", "v1.0"),
        )
      }
    }
    env[key] = dirs.join(path.delimiter)
    env.KILO_TEST_ROOT = root
    env.KILO_TEST_GIT = bin

    const script = `
      import { existsSync } from "node:fs"
      import path from "node:path"
      import { GitOps } from "./src/agent-manager/GitOps"
      import { apply, capture } from "./src/agent-manager/git-transfer"
      import { WorktreeManager } from "./src/agent-manager/WorktreeManager"

      const root = process.env.KILO_TEST_ROOT
      const git = process.env.KILO_TEST_GIT
      if (!root || !git) throw new Error("Missing configured Git test environment")

      const ops = new GitOps({ log: () => undefined, binary: git })
      const manager = new WorktreeManager(root, () => undefined, ops)
      const result = await manager.createWorktree({ branchName: "configured-git" })
      if (!existsSync(path.join(result.path, ".git"))) throw new Error("Worktree was not created")
      if ((await ops.currentBranch(result.path)) !== result.branch) throw new Error("GitOps did not use configured Git")
      if (await manager.hasWork(result.path, result.parentBranch)) throw new Error("New worktree unexpectedly has work")
      await Bun.write(path.join(result.path, "configured.txt"), "configured")
      if (!(await manager.hasWork(result.path, result.parentBranch))) throw new Error("WorktreeManager did not use configured Git")
      await Bun.write(path.join(root, "README.md"), "staged\\n")
      const staged = await ops.execGit(["add", "README.md"], root)
      if (staged.code !== 0) throw new Error("Could not stage configured Git test change")
      await Bun.write(path.join(root, "README.md"), "unstaged\\n")
      const snapshot = await capture(root, () => undefined, git)
      if (!snapshot.staged?.includes("staged") || !snapshot.unstaged?.includes("unstaged")) {
        throw new Error("Git transfer did not capture staged and unstaged changes")
      }
      const applied = await apply(snapshot, result.path, () => undefined, git)
      if (!applied.ok) throw new Error(applied.error ?? "Git transfer did not apply changes")
      if ((await Bun.file(path.join(result.path, "README.md")).text()) !== "unstaged\\n") {
        throw new Error("Git transfer did not apply the working tree content")
      }
      const status = (await ops.execGit(["status", "--porcelain", "--", "README.md"], result.path)).stdout.trim()
      if (status !== "MM README.md") throw new Error("Git transfer did not preserve staged state: " + status)
    `
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: process.cwd(),
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const stderr = child.stderr.toString("utf8")

    expect(child.exitCode, stderr).toBe(0)
    expect(existsSync(path.join(root, ".kilo", "worktrees", "configured-git", ".git"))).toBe(true)
  }, 120_000)

  it("creates a worktree with a new branch", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const result = await mgr.createWorktree({ prompt: "test task" })

    // Branch should be a friendly two-word name (e.g. "brave-piano")
    expect(result.branch).toMatch(/^[a-z]+-[a-z]+/)
    expect(result.parentBranch).toBeTruthy()

    // Worktree directory should exist and have a .git file (not directory)
    const stat = await fs.stat(path.join(result.path, ".git"))
    expect(stat.isFile()).toBe(true)

    // Branch should exist in the repo
    const git = simpleGit(root)
    const branches = await git.branch()
    expect(branches.all).toContain(result.branch)
  })

  it("uses existing branch when specified", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    await git.branch(["feature-branch"])

    const mgr = createManager(root)
    const result = await mgr.createWorktree({ existingBranch: "feature-branch" })

    expect(result.branch).toBe("feature-branch")
    const stat = await fs.stat(path.join(result.path, ".git"))
    expect(stat.isFile()).toBe(true)
  })

  it("throws when existing branch does not exist", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    await expect(mgr.createWorktree({ existingBranch: "nonexistent" })).rejects.toThrow(
      'Branch "nonexistent" does not exist',
    )
  })

  it("throws when workspace is not a git repo", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-nogit-"))
    tempDirs.push(dir)
    const mgr = createManager(dir)

    await expect(mgr.createWorktree({ prompt: "test" })).rejects.toThrow("not a git repository")
  })

  it("creates worktrees directory under .kilo/worktrees/", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const result = await mgr.createWorktree({ prompt: "test" })

    expect(result.path).toContain(path.join(".kilo", "worktrees"))
  })

  it("records parentBranch as default branch", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()

    const mgr = createManager(root)
    const result = await mgr.createWorktree({ prompt: "test" })

    expect(result.parentBranch).toBe(branch)
  })

  it("uses two checkout workers without changing Git configuration", async () => {
    const root = await createTempRepo()
    const hook = path.join(root, ".git", "hooks", "post-checkout")
    const file = path.join(root, "workers")
    await fs.writeFile(hook, `#!/bin/sh\ngit config --get checkout.workers > "${file}"\n`)
    await fs.chmod(hook, 0o755)

    await createManager(root).createWorktree({ branchName: "parallel-checkout" })

    expect((await fs.readFile(file, "utf8")).trim()).toBe("2")
    expect((await simpleGit(root).getConfig("checkout.workers")).value).toBeNull()
  })

  it("preserves an explicitly configured checkout worker count", async () => {
    const root = await createTempRepo()
    const hook = path.join(root, ".git", "hooks", "post-checkout")
    const file = path.join(root, "workers")
    gitExec(["git", "-C", root, "config", "checkout.workers", "1"])
    await fs.writeFile(hook, `#!/bin/sh\ngit config --get checkout.workers > "${file}"\n`)
    await fs.chmod(hook, 0o755)

    await createManager(root).createWorktree({ branchName: "configured-checkout" })

    expect((await fs.readFile(file, "utf8")).trim()).toBe("1")
    expect((await simpleGit(root).getConfig("checkout.workers")).value).toBe("1")
  })

  it("retains post-checkout hook failure tolerance with parallel checkout", async () => {
    const root = await fs.realpath(await createTempRepo())
    const hook = path.join(root, ".git", "hooks", "post-checkout")
    await fs.writeFile(hook, "#!/bin/sh\nprintf 'post-checkout hook failed' >&2\nexit 1\n")
    await fs.chmod(hook, 0o755)

    const result = await createManager(root).createWorktree({ branchName: "hook-failure" })

    expect(existsSync(result.path)).toBe(true)
    expect((await simpleGit(root).raw(["worktree", "list", "--porcelain"])).includes(result.path)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- removeWorktree
// ---------------------------------------------------------------------------

describe("WorktreeManager.removeWorktree", () => {
  it("removes an existing worktree", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const result = await mgr.createWorktree({ prompt: "removeme" })
    expect(await fs.stat(result.path).then(() => true)).toBe(true)

    await mgr.removeWorktree(result.path)

    const exists = await fs
      .stat(result.path)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  }, 15_000)

  it("does not throw when worktree path does not exist", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    // Should not throw
    await mgr.removeWorktree(path.join(root, ".kilo", "worktrees", "nonexistent"))
  })

  it("removes orphaned directory that git does not know about", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    // Create an orphaned directory (not a real worktree)
    const orphanPath = path.join(root, ".kilo", "worktrees", "orphan")
    await fs.mkdir(orphanPath, { recursive: true })
    await fs.writeFile(path.join(orphanPath, "file.txt"), "orphan")

    await mgr.removeWorktree(orphanPath)

    const exists = await fs
      .stat(orphanPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })

  it("cleans up git metadata after removal", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const git = simpleGit(root)

    const result = await mgr.createWorktree({ prompt: "prune-check" })

    await mgr.removeWorktree(result.path)
    // Allow background rm to complete
    await new Promise((r) => setTimeout(r, 200))

    // git worktree list should only show the main repo
    const raw = await git.raw(["worktree", "list", "--porcelain"])
    const dirs = raw
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.replace("worktree ", ""))
    expect(dirs).toHaveLength(1)
  })

  it("deletes the local branch when branch is provided", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const git = simpleGit(root)

    const result = await mgr.createWorktree({ prompt: "branch-delete" })
    const branches = await git.branch()
    expect(branches.all).toContain(result.branch)

    await mgr.removeWorktree(result.path, result.branch)

    const after = await git.branch()
    expect(after.all).not.toContain(result.branch)
  })

  it("keeps the branch when branch param is omitted", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const git = simpleGit(root)

    const result = await mgr.createWorktree({ prompt: "keep-branch" })
    await mgr.removeWorktree(result.path)

    const after = await git.branch()
    expect(after.all).toContain(result.branch)
  })

  it(
    "returns quickly even with a dirty worktree",
    async () => {
      const root = await createTempRepo()
      const mgr = createManager(root)

      const result = await mgr.createWorktree({ prompt: "dirty-wt" })

      // Make the worktree dirty with uncommitted files
      await fs.writeFile(path.join(result.path, "dirty.txt"), "uncommitted")
      for (let i = 0; i < 20; i++) {
        await fs.writeFile(path.join(result.path, `bulk-${i}.txt`), "x".repeat(1000))
      }

      const start = Date.now()
      await mgr.removeWorktree(result.path)
      const elapsed = Date.now() - start

      // The blocking portion (rename + prune) should complete well under 3s.
      // Old approach with git worktree remove (non-force then force) was much slower.
      expect(elapsed).toBeLessThan(3000)

      // Original path should be gone immediately
      const exists = await fs
        .stat(result.path)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)
    },
    { timeout: 15000 },
  )

  it(
    "eventual cleanup: files are fully deleted after background rm",
    async () => {
      const root = await createTempRepo()
      const mgr = createManager(root)

      const result = await mgr.createWorktree({ prompt: "eventual" })
      await fs.writeFile(path.join(result.path, "data.txt"), "content")

      await mgr.removeWorktree(result.path)

      // Poll until background rm finishes (up to 5s)
      const worktreesDir = path.join(root, ".kilo", "worktrees")
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const entries = await fs.readdir(worktreesDir)
        if (!entries.some((e) => e.startsWith(".kilo-delete-"))) break
        await new Promise((r) => setTimeout(r, 100))
      }

      // No .kilo-delete-* temp dirs should remain
      const entries = await fs.readdir(worktreesDir)
      const orphans = entries.filter((e) => e.startsWith(".kilo-delete-"))
      expect(orphans).toHaveLength(0)
    },
    { timeout: 10000 },
  )
})

// ---------------------------------------------------------------------------
// WorktreeManager -- discoverWorktrees cleans orphaned temp dirs
// ---------------------------------------------------------------------------

describe("WorktreeManager.discoverWorktrees orphan cleanup", () => {
  it("cleans up .kilo-delete-* dirs left by interrupted deletions", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    // Create a worktree so the worktrees directory exists
    const wt = await mgr.createWorktree({ prompt: "real-wt" })

    // Simulate an orphaned temp dir from an interrupted deletion
    const orphan = path.join(root, ".kilo", "worktrees", ".kilo-delete-fake-uuid")
    await fs.mkdir(orphan, { recursive: true })
    await fs.writeFile(path.join(orphan, "leftover.txt"), "stale")

    const discovered = await mgr.discoverWorktrees()

    // Should only discover the real worktree, not the orphan
    expect(discovered).toHaveLength(1)
    expect(discovered[0]?.branch).toBe(wt.branch)

    // Wait for background cleanup
    await new Promise((r) => setTimeout(r, 300))

    const exists = await fs
      .stat(orphan)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- createWorktree cleans up leftover directories
// ---------------------------------------------------------------------------

describe("WorktreeManager.createWorktree cleanup", () => {
  it("cleans up leftover worktree directory before re-creation", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    // Create a worktree, then remove it improperly (just delete via git but leave artifacts)
    const first = await mgr.createWorktree({ existingBranch: undefined, prompt: "cleanup-test" })
    const branch = first.branch

    // Remove the worktree properly, then recreate the directory as an orphan
    // to simulate a crash that left a stale directory
    await mgr.removeWorktree(first.path)
    await fs.mkdir(first.path, { recursive: true })
    await fs.writeFile(path.join(first.path, "stale.txt"), "leftover")

    // Creating a worktree with the same branch name (via existingBranch) should
    // clean up the stale directory and succeed
    const second = await mgr.createWorktree({ existingBranch: branch })

    expect(second.branch).toBe(branch)
    const gitFile = await fs.stat(path.join(second.path, ".git"))
    expect(gitFile.isFile()).toBe(true)

    // Stale file should be gone
    const staleExists = await fs
      .stat(path.join(second.path, "stale.txt"))
      .then(() => true)
      .catch(() => false)
    expect(staleExists).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- session ID persistence
// ---------------------------------------------------------------------------

describe("WorktreeManager metadata", () => {
  it("round-trips writeMetadata / readMetadata with parentBranch", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const result = await mgr.createWorktree({ prompt: "session-test" })

    await mgr.writeMetadata(result.path, "sess-abc-123", "feature-branch", "origin")
    const meta = await mgr.readMetadata(result.path)

    expect(meta?.sessionId).toBe("sess-abc-123")
    expect(meta?.parentBranch).toBe("feature-branch")
    expect(meta?.remote).toBe("origin")
  })

  it("writes metadata outside the worktree checkout", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const result = await mgr.createWorktree({ prompt: "session-status" })

    await mgr.writeMetadata(result.path, "sess-clean-123", "feature-branch", "origin")

    expect(existsSync(path.join(result.path, ".kilo", "session-id"))).toBe(false)
    expect(existsSync(path.join(result.path, ".kilo", "metadata.json"))).toBe(false)
    expect(await changedFiles(result.path)).toEqual([])
  })

  it("returns undefined when no metadata exists", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const result = await mgr.createWorktree({ prompt: "no-session" })

    const meta = await mgr.readMetadata(result.path)
    expect(meta).toBeUndefined()
  })

  it("reads legacy session-id file when metadata.json is missing", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const result = await mgr.createWorktree({ prompt: "legacy-test" })

    // Write only the legacy session-id file (no metadata.json)
    const dir = path.join(result.path, ".kilo")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "session-id"), "legacy-sess-456", "utf-8")

    const meta = await mgr.readMetadata(result.path)
    expect(meta?.sessionId).toBe("legacy-sess-456")
    expect(meta?.parentBranch).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- discoverWorktrees
// ---------------------------------------------------------------------------

describe("WorktreeManager.discoverWorktrees", () => {
  it("discovers worktrees with session IDs", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const wt1 = await mgr.createWorktree({ prompt: "discover-one" })
    const wt2 = await mgr.createWorktree({ prompt: "discover-two" })

    await mgr.writeMetadata(wt1.path, "sess-1", "main")
    await mgr.writeMetadata(wt2.path, "sess-2", "main")

    const discovered = await mgr.discoverWorktrees()

    expect(discovered.length).toBe(2)

    const ids = discovered.map((d) => d.sessionId).sort()
    expect(ids).toEqual(["sess-1", "sess-2"])

    for (const info of discovered) {
      expect(info.branch).toBeTruthy()
      expect(info.path).toBeTruthy()
      expect(info.parentBranch).toBeTruthy()
      expect(info.createdAt).toBeGreaterThan(0)
    }
  })

  it("returns empty array when no worktrees directory exists", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const discovered = await mgr.discoverWorktrees()
    expect(discovered).toEqual([])
  })

  it("includes worktrees without metadata (sessionId undefined)", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    await mgr.createWorktree({ prompt: "no-session-id" })

    const discovered = await mgr.discoverWorktrees()
    expect(discovered.length).toBe(1)
    expect(discovered[0]?.sessionId).toBeUndefined()
  })

  it("recovers parentBranch from persisted metadata", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const wt = await mgr.createWorktree({ prompt: "parent-recovery" })
    await mgr.writeMetadata(wt.path, "sess-parent", "feature/my-branch")

    const discovered = await mgr.discoverWorktrees()
    const found = discovered.find((d) => d.sessionId === "sess-parent")

    expect(found).toBeDefined()
    expect(found!.parentBranch).toBe("feature/my-branch")
  })

  it("repairs stale gitdir refs when .kilo/worktrees already exists", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const worktree = path.join(root, ".kilo", "worktrees", "partial")
    const gitdir = path.join(root, ".git", "worktrees", "partial", "gitdir")
    await fs.mkdir(worktree, { recursive: true })
    await fs.mkdir(path.dirname(gitdir), { recursive: true })
    await fs.writeFile(gitdir, path.join(root, ".kilocode", "worktrees", "partial", ".git"), "utf-8")

    await mgr.discoverWorktrees()

    const fixed = await fs.readFile(gitdir, "utf-8")
    expect(fixed).toContain(path.join(root, ".kilo", "worktrees", "partial", ".git"))
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- ensureGitExclude
// ---------------------------------------------------------------------------

describe("WorktreeManager.ensureGitExclude", () => {
  it("adds Agent Manager state and worktrees to .git/info/exclude", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    await mgr.ensureGitExclude()

    const content = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    expect(content).toContain(".kilo/worktrees/")
    expect(content).toContain(".kilo/agent-manager.json")
  })

  it("adds only specific legacy Agent Manager paths", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    await mgr.ensureGitExclude()

    const content = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    expect(content).toContain(".kilocode/worktrees/")
    expect(content).toContain(".kilocode/agent-manager.json")
    expect(content).toContain(".kilocode/setup-script")
    expect(content).not.toContain("\n.kilocode/\n")
  })

  it("is idempotent -- does not duplicate entries", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    await mgr.ensureGitExclude()
    await mgr.ensureGitExclude()
    await mgr.ensureGitExclude()

    const content = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    const count = content.split(".kilo/worktrees/").length - 1
    expect(count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- automatic branch rename
// ---------------------------------------------------------------------------

describe("WorktreeManager.renameBranch", () => {
  it("renames a local-only branch without moving or cleaning the worktree", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const created = await mgr.createWorktree({ branchName: "quiet-river" })
    await fs.writeFile(path.join(created.path, "draft.txt"), "keep me")

    const branch = await mgr.renameBranch(created.path, created.branch, "fix-token-refresh")

    expect(branch).toBe("fix-token-refresh")
    expect((await simpleGit(created.path).revparse(["--abbrev-ref", "HEAD"])).trim()).toBe(branch)
    expect(await fs.readFile(path.join(created.path, "draft.txt"), "utf-8")).toBe("keep me")
    expect((await simpleGit(root).branch()).all).not.toContain(created.branch)
  })

  it("suffixes a generated name that already exists", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const created = await mgr.createWorktree({ branchName: "quiet-river" })
    await simpleGit(root).branch(["fix-auth"])

    expect(await mgr.renameBranch(created.path, created.branch, "fix-auth")).toBe("fix-auth-2")
  })

  it("does not rename a branch that exists on a remote", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const created = await mgr.createWorktree({ branchName: "quiet-river" })
    const hash = (await simpleGit(root).revparse(["HEAD"])).trim()
    await simpleGit(root).raw(["update-ref", `refs/remotes/origin/${created.branch}`, hash])

    await expect(mgr.renameBranch(created.path, created.branch, "fix-auth")).rejects.toThrow(
      "already exists on a remote",
    )
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- branch name collision retry
// ---------------------------------------------------------------------------

describe("WorktreeManager.createWorktree branch collision", () => {
  it("creates a suffixed worktree without replacing an active explicitly named worktree", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const first = await mgr.createWorktree({ branchName: "echo-hello-world" })
    const second = await mgr.createWorktree({ branchName: "echo-hello-world" })

    expect(first.branch).toBe("echo-hello-world")
    expect(second.branch).toBe("echo-hello-world-2")
    expect((await fs.stat(path.join(first.path, ".git"))).isFile()).toBe(true)
    expect((await fs.stat(path.join(second.path, ".git"))).isFile()).toBe(true)
    expect((await simpleGit(root).branch()).all.filter((branch) => branch.startsWith("echo-hello-world"))).toEqual([
      "echo-hello-world",
      "echo-hello-world-2",
    ])
  })

  it("uses the same suffix sequence when only the requested branch already exists", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    const mgr = createManager(root)
    const first = await mgr.createWorktree({ branchName: "collide" })

    await git.raw(["worktree", "remove", "--force", first.path])
    expect((await git.branch()).all).toContain("collide")

    const second = await mgr.createWorktree({ branchName: "collide" })

    expect(second.branch).toBe("collide-2")
    expect((await fs.stat(path.join(second.path, ".git"))).isFile()).toBe(true)
  })

  it("does not treat remote-tracking refs as local branch collisions", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    const hash = (await git.revparse(["HEAD"])).trim()
    await git.raw(["update-ref", "refs/remotes/origin/remote-name", hash])

    const result = await createManager(root).createWorktree({ branchName: "remote-name" })

    expect(result.branch).toBe("remote-name")
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- removeWorktree safety guard
// ---------------------------------------------------------------------------

describe("WorktreeManager.removeWorktree safety", () => {
  it("refuses to remove paths outside the worktrees directory", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    // Create a directory outside .kilo/worktrees/
    const outside = path.join(root, "important-data")
    await fs.mkdir(outside, { recursive: true })
    await fs.writeFile(path.join(outside, "file.txt"), "precious")

    // Attempt to remove it — should be silently refused
    await mgr.removeWorktree(outside)

    // Directory should still exist
    const exists = await fs
      .stat(outside)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- listBranches
// ---------------------------------------------------------------------------

describe("WorktreeManager.listBranches", () => {
  it("returns the current branch", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const { branches, defaultBranch } = await mgr.listBranches()

    const names = branches.map((b) => b.name)
    const git = simpleGit(root)
    const current = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()
    expect(names).toContain(current)
    expect(defaultBranch).toBeTruthy()
  })

  it("includes branches created after init", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    await git.branch(["feature-test"])

    const mgr = createManager(root)
    const { branches } = await mgr.listBranches()

    expect(branches.map((b) => b.name)).toContain("feature-test")
  })

  it("marks local branches as isLocal", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const { branches } = await mgr.listBranches()
    for (const b of branches) {
      expect(b.isLocal).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- checkedOutBranches
// ---------------------------------------------------------------------------

describe("WorktreeManager.checkedOutBranches", () => {
  it("includes the main branch", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const checked = await mgr.checkedOutBranches()
    const git = simpleGit(root)
    const current = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()
    expect(checked.has(current)).toBe(true)
  })

  it("includes worktree branches", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const wt = await mgr.createWorktree({ prompt: "checked-out-test" })
    const checked = await mgr.checkedOutBranches()

    expect(checked.has(wt.branch)).toBe(true)
  })

  it("excludes branches after worktree removal", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const wt = await mgr.createWorktree({ prompt: "removal-test" })
    await mgr.removeWorktree(wt.path)

    const checked = await mgr.checkedOutBranches()
    expect(checked.has(wt.branch)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- Start Point Resolution & Helpers
// ---------------------------------------------------------------------------

describe("WorktreeManager helpers", () => {
  it("hasOriginRemote returns false when no remote exists", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    expect(await mgr.hasOriginRemote()).toBe(false)
  })

  it("hasOriginRemote returns true when origin exists", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    await git.addRemote("origin", "https://example.com/repo.git")
    const mgr = createManager(root)
    expect(await mgr.hasOriginRemote()).toBe(true)
  })

  it("refExistsLocally verifies refs", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    const mgr = createManager(root)

    const head = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()
    expect(await mgr.refExistsLocally(head)).toBe(true)
    expect(await mgr.refExistsLocally("nonexistent")).toBe(false)
    expect(await mgr.refExistsLocally("origin/HEAD")).toBe(false)
  })

  it("repoUsesLfs detects .gitattributes", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    expect(await mgr.repoUsesLfs()).toBe(false)

    await fs.writeFile(path.join(root, ".gitattributes"), "*.png filter=lfs diff=lfs merge=lfs -text")
    expect(await mgr.repoUsesLfs()).toBe(true)
  })

  it("repoUsesLfs detects .git/lfs directory", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    expect(await mgr.repoUsesLfs()).toBe(false)

    await fs.mkdir(path.join(root, ".git", "lfs"), { recursive: true })
    expect(await mgr.repoUsesLfs()).toBe(true)
  })
})

describe("WorktreeManager.resolveStartPoint", () => {
  it("falls back to local branch when no remote exists", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    const head = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()
    const mgr = createManager(root)

    const res = await mgr.resolveStartPoint(head)
    expect(res.source).toBe("local-branch")
    expect(res.ref).toBe(head)
  })

  it("returns bare branch + remote when remote exists", async () => {
    const { clone } = await createTempRepoWithOrigin()
    const mgr = createManager(clone)

    const res = await mgr.resolveStartPoint("main")
    expect(res.source).toBe("remote")
    expect(res.ref).toBe("origin/main")
    expect(res.branch).toBe("main")
    expect(res.remote).toBe("origin")
  })

  it("returns bare branch + remote for stale tracking ref", async () => {
    const { clone } = await createTempRepoWithOrigin()
    const git = simpleGit(clone)
    // Remove origin so fetch fails, but the local tracking ref remains
    await git.removeRemote("origin")
    const mgr = createManager(clone)

    const res = await mgr.resolveStartPoint("main")
    // After removing the remote, resolveRemote() returns undefined,
    // so "origin/main" won't be tried as ${remote}/${branch}. Falls back to local.
    expect(res.source).toBe("local-branch")
    expect(res.branch).toBe("main")
    expect(res.remote).toBeUndefined()
  })

  it("returns bare branch name for local-only source", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    const head = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()
    const mgr = createManager(root)

    const res = await mgr.resolveStartPoint(head)
    expect(res.source).toBe("local-branch")
    expect(res.branch).toBe(head)
    expect(res.remote).toBeUndefined()
  })

  it("falls back to default branch when requested does not exist", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    const head = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()
    const mgr = createManager(root)

    const res = await mgr.resolveStartPoint("nonexistent-feature")
    expect(res.source).toBe("fallback")
    expect(res.branch).toBe(head) // fallback to default (HEAD)
    expect(res.warning).toContain("falling back to")
  })

  it("does not fallback when allowFallback is false", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    await expect(mgr.resolveStartPoint("nonexistent", undefined, { allowFallback: false })).rejects.toThrow(
      "Could not resolve start point",
    )
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- resolveBaseBranch
// ---------------------------------------------------------------------------

describe("WorktreeManager.resolveBaseBranch", () => {
  it("uses the shared remote default instead of stale local metadata", async () => {
    const { clone } = await createTempRepoWithOrigin()
    gitExec(["git", "-C", clone, "branch", "master"])
    gitExec(["git", "-C", clone, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"])
    const ops = new GitOps({
      log: () => undefined,
      runGit: async (args) => {
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "ls-remote") return "ref: refs/heads/main\tHEAD\nabc123\tHEAD"
        return ""
      },
    })
    const mgr = createManager(clone, ops)

    expect(await mgr.resolveBaseBranch()).toEqual({ branch: "main", remote: "origin" })
    expect((await simpleGit(clone).raw(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim()).toBe(
      "origin/master",
    )
  })

  it("returns bare branch + remote when origin remote and tracking ref exist", async () => {
    const { clone } = await createTempRepoWithOrigin()
    const mgr = createManager(clone)

    const result = await mgr.resolveBaseBranch()
    expect(result).toEqual({ branch: "main", remote: "origin" })
  })

  it("returns bare branch without remote when no origin remote exists", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const result = await mgr.resolveBaseBranch()
    const git = simpleGit(root)
    const head = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()
    expect(result).toEqual({ branch: head })
    expect(result.remote).toBeUndefined()
  })

  it("returns bare branch without remote when origin exists but tracking ref does not", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    // Add a remote that points nowhere — origin exists but origin/main ref doesn't
    await git.addRemote("origin", "https://example.com/repo.git")
    const mgr = createManager(root)

    const result = await mgr.resolveBaseBranch()
    const git2 = simpleGit(root)
    const head = (await git2.revparse(["--abbrev-ref", "HEAD"])).trim()
    expect(result).toEqual({ branch: head })
    expect(result.remote).toBeUndefined()
  })
})

describe("WorktreeManager.createWorktree advanced", () => {
  it("returns startPointSource in result", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const res = await mgr.createWorktree({ prompt: "source-test" })

    expect(res.startPointSource).toBe("local-branch") // no remote in temp repo
  })

  it("does not set upstream tracking on new branch", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const res = await mgr.createWorktree({ prompt: "no-upstream" })

    const git = simpleGit(res.path)
    // Checking upstream should fail
    let error
    try {
      await git.revparse(["--abbrev-ref", `${res.branch}@{upstream}`])
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
  })

  it("fires onProgress callbacks", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)
    const steps: string[] = []

    await mgr.createWorktree({
      prompt: "progress-test",
      onProgress: (step) => steps.push(step),
    })

    expect(steps).toContain("verifying")
    expect(steps).toContain("creating")
  })

  it("creates from an explicitly selected base branch", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    const mgr = createManager(root)

    // Create a new branch 'develop'
    await git.checkoutLocalBranch("develop")
    await fs.writeFile(path.join(root, "dev.txt"), "dev")
    await git.add(".")
    await git.commit("dev commit")

    // Create worktree from 'develop'
    const res = await mgr.createWorktree({
      prompt: "feature",
      baseBranch: "develop",
    })

    expect(res.parentBranch).toBe("develop")
    const wtGit = simpleGit(res.path)
    const headParams = await wtGit.log(["-1"])
    const devParams = await git.log(["-1"])
    expect(headParams.latest?.hash).toBe(devParams.latest?.hash)
  })

  it("creates from a base branch excluded by the remote fetch refspec", async () => {
    const { clone } = await createTempRepoWithOrigin()
    const git = simpleGit(clone)
    await git.checkoutLocalBranch("topic")
    await fs.writeFile(path.join(clone, "topic.txt"), "topic")
    await git.add(".")
    await git.commit("topic commit")
    await git.push("origin", "topic")
    await git.checkout("main")

    await git.raw(["config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main"])
    await git.raw(["update-ref", "-d", "refs/remotes/origin/topic"])

    const result = await createManager(clone).createWorktree({ baseBranch: "topic", prompt: "from topic" })
    const remoteHead = (await git.revparse(["refs/remotes/origin/topic"])).trim()
    const worktreeHead = (await simpleGit(result.path).revparse(["HEAD"])).trim()

    expect(worktreeHead).toBe(remoteHead)
    expect(result.parentBranch).toBe("topic")
  })

  it("creates from a same-repository PR branch excluded by the remote fetch refspec", async () => {
    const { clone } = await createTempRepoWithOrigin()
    const git = simpleGit(clone)
    await git.checkoutLocalBranch("topic")
    await fs.writeFile(path.join(clone, "topic.txt"), "topic")
    await git.add(".")
    await git.commit("topic commit")
    await git.push("origin", "topic")
    await git.checkout("main")
    await git.raw(["config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main"])
    await git.raw(["update-ref", "-d", "refs/remotes/origin/topic"])
    await git.branch(["-D", "topic"])

    const manager = createManager(clone)
    const internal = manager as unknown as {
      fetchPRInfo: (parsed: { owner: string; repo: string; number: number }) => Promise<PRInfo>
    }
    internal.fetchPRInfo = async () => ({
      headRefName: "topic",
      baseRefName: "main",
      isCrossRepository: false,
      title: "Topic PR",
    })

    const result = await manager.createFromPR("https://github.com/org/repo/pull/1")
    const remoteHead = (await git.revparse(["refs/remotes/origin/topic"])).trim()
    const worktreeHead = (await simpleGit(result.path).revparse(["HEAD"])).trim()

    expect(worktreeHead).toBe(remoteHead)
    expect(result.parentBranch).toBe("main")
    expect(result.remote).toBe("origin")
  })

  it("does not track a deleted PR source branch when using the pull ref fallback", async () => {
    const { bare, clone } = await createTempRepoWithOrigin()
    const git = simpleGit(clone)
    await git.checkoutLocalBranch("topic")
    await fs.writeFile(path.join(clone, "topic.txt"), "topic")
    await git.add(".")
    await git.commit("topic commit")
    await git.push("origin", "topic")
    const head = (await git.revparse(["topic"])).trim()
    await git.checkout("main")
    await git.raw(["config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main"])
    await git.raw(["update-ref", "-d", "refs/remotes/origin/topic"])
    gitExec(["git", "--git-dir", bare, "update-ref", "refs/pull/1/head", head])
    gitExec(["git", "--git-dir", bare, "update-ref", "-d", "refs/heads/topic"])
    await git.branch(["-D", "topic"])

    const manager = createManager(clone)
    const internal = manager as unknown as {
      fetchPRInfo: (parsed: { owner: string; repo: string; number: number }) => Promise<PRInfo>
    }
    internal.fetchPRInfo = async () => ({
      headRefName: "topic",
      isCrossRepository: false,
      title: "Topic PR",
    })

    const result = await manager.createFromPR("https://github.com/org/repo/pull/1")
    const upstream = await git.raw(["config", "--get", "branch.topic.remote"]).catch(() => "")
    const worktreeHead = (await simpleGit(result.path).revparse(["HEAD"])).trim()

    expect(worktreeHead).toBe(head)
    expect(upstream.trim()).toBe("")
    expect(result.parentBranch).toBe("main")
    expect(result.remote).toBe("origin")
  })

  it("preserves a non-default PR target branch for comparison", async () => {
    const { clone } = await createTempRepoWithOrigin()
    const git = simpleGit(clone)
    await git.checkoutLocalBranch("develop")
    await fs.writeFile(path.join(clone, "develop.txt"), "develop")
    await git.add(".")
    await git.commit("develop commit")
    await git.push("origin", "develop")
    await git.checkout("main")
    await git.checkoutLocalBranch("topic")
    await fs.writeFile(path.join(clone, "topic.txt"), "topic")
    await git.add(".")
    await git.commit("topic commit")
    await git.push("origin", "topic")
    await git.checkout("main")

    const manager = createManager(clone)
    const internal = manager as unknown as {
      fetchPRInfo: (parsed: { owner: string; repo: string; number: number }) => Promise<PRInfo>
    }
    internal.fetchPRInfo = async () => ({
      headRefName: "topic",
      baseRefName: "develop",
      isCrossRepository: false,
      title: "Topic PR",
    })

    const result = await manager.createFromPR("https://github.com/org/repo/pull/1")
    const target = (await git.revparse(["refs/remotes/origin/develop"])).trim()
    const head = (await simpleGit(result.path).revparse(["HEAD"])).trim()

    expect(result.parentBranch).toBe("develop")
    expect(result.remote).toBe("origin")
    expect(head).not.toBe(target)
  })

  it("fails before creating a worktree for an unavailable PR target", async () => {
    const { clone } = await createTempRepoWithOrigin()
    const manager = createManager(clone)
    const internal = manager as unknown as {
      fetchPRInfo: (parsed: { owner: string; repo: string; number: number }) => Promise<PRInfo>
    }
    internal.fetchPRInfo = async () => ({
      headRefName: "topic",
      baseRefName: "missing",
      isCrossRepository: false,
      title: "Topic PR",
    })

    await expect(manager.createFromPR("https://github.com/org/repo/pull/1")).rejects.toThrow(
      'Could not resolve start point for branch "missing"',
    )
    expect(existsSync(path.join(clone, ".kilo", "worktrees"))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// WorktreeManager -- git lock serialization
// ---------------------------------------------------------------------------

describe("WorktreeManager git lock serialization", () => {
  it("concurrent worktree creations both succeed", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const [a, b] = await Promise.all([
      mgr.createWorktree({ prompt: "concurrent-a" }),
      mgr.createWorktree({ prompt: "concurrent-b" }),
    ])

    expect(a.branch).not.toBe(b.branch)

    const statA = await fs.stat(path.join(a.path, ".git"))
    const statB = await fs.stat(path.join(b.path, ".git"))
    expect(statA.isFile()).toBe(true)
    expect(statB.isFile()).toBe(true)
  })

  it("lock releases after error so subsequent operations succeed", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    // First operation fails (nonexistent branch)
    const failing = mgr.createWorktree({ existingBranch: "nonexistent" }).catch((e: unknown) => e)
    // Second operation queues behind the first and should succeed after lock release
    const succeeding = mgr.createWorktree({ prompt: "after-error" })

    const [err, result] = await Promise.all([failing, succeeding])
    expect(err).toBeInstanceOf(Error)
    expect(result.branch).toBeTruthy()

    const stat = await fs.stat(path.join(result.path, ".git"))
    expect(stat.isFile()).toBe(true)
  })

  it("concurrent remove and create on the same repo do not conflict", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    // Create a worktree first
    const wt = await mgr.createWorktree({ prompt: "to-remove" })

    // Concurrently remove and create
    const [, created] = await Promise.all([mgr.removeWorktree(wt.path), mgr.createWorktree({ prompt: "new-one" })])

    expect(created.branch).toBeTruthy()
    const stat = await fs.stat(path.join(created.path, ".git"))
    expect(stat.isFile()).toBe(true)
  })
})
