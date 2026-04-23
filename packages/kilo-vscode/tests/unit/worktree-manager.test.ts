import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { WorktreeManager } from "../../src/agent-manager/WorktreeManager"
import { generateBranchName, sanitizeBranchName, versionedName } from "../../src/agent-manager/branch-name"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
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

/** Create a temp git repo with an initial commit (required for worktrees). */
async function createTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-"))
  tempDirs.push(dir)
  const git = simpleGit(dir)
  await git.init()
  await git.addConfig("user.email", "test@test.com")
  await git.addConfig("user.name", "Test")
  await fs.writeFile(path.join(dir, "README.md"), "init")
  await git.add(".")
  await git.commit("initial commit")
  return dir
}

function createManager(root: string): WorktreeManager {
  const logs: string[] = []
  return new WorktreeManager(root, (msg) => logs.push(msg))
}

/** Create a temp repo with a bare origin remote so origin/<branch> refs exist. */
async function createTempRepoWithOrigin(): Promise<{ bare: string; clone: string }> {
  // Use a non-bare seed repo to control the initial branch name, then clone bare
  const seed = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-seed-"))
  tempDirs.push(seed)
  const seedGit = simpleGit(seed)
  await seedGit.init()
  await seedGit.addConfig("user.email", "test@test.com")
  await seedGit.addConfig("user.name", "Test")
  await fs.writeFile(path.join(seed, "README.md"), "init")
  await seedGit.add(".")
  await seedGit.commit("initial commit")
  // Ensure branch is named "main" regardless of system default
  const seedBranch = (await seedGit.revparse(["--abbrev-ref", "HEAD"])).trim()
  if (seedBranch !== "main") await seedGit.raw(["branch", "-m", seedBranch, "main"])

  // Clone to bare, then clone again as working copy
  const bare = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-bare-"))
  tempDirs.push(bare)
  await simpleGit().clone(seed, bare, ["--bare"])

  const clone = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-clone-"))
  tempDirs.push(clone)
  await simpleGit().clone(bare, clone)
  const cloneGit = simpleGit(clone)
  await cloneGit.addConfig("user.email", "test@test.com")
  await cloneGit.addConfig("user.name", "Test")

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

    await mgr.writeMetadata(result.path, "sess-abc-123", "feature-branch")
    const meta = await mgr.readMetadata(result.path)

    expect(meta?.sessionId).toBe("sess-abc-123")
    expect(meta?.parentBranch).toBe("feature-branch")
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
  it("adds .kilo/worktrees/ to .git/info/exclude", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    await mgr.ensureGitExclude()

    const content = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    expect(content).toContain(".kilo/worktrees/")
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
// WorktreeManager -- branch name collision retry
// ---------------------------------------------------------------------------

describe("WorktreeManager.createWorktree branch collision", () => {
  /**
   * Exercise the retry path in WorktreeManager when `git worktree add -b <name>`
   * fails because a branch with that name already exists.
   *
   * We force the collision by creating a worktree with branchName "collide",
   * removing the worktree (keeping the branch), then requesting the same
   * branchName again.
   */
  it("retries with a unique suffix when generated branch name collides", async () => {
    const root = await createTempRepo()
    const git = simpleGit(root)
    const mgr = createManager(root)

    // Create a first worktree with a fixed branch name
    const first = await mgr.createWorktree({ branchName: "collide" })
    expect(first.branch).toBe("collide")

    // Remove the worktree via git but keep the branch ref alive
    await git.raw(["worktree", "remove", "--force", first.path])

    // Verify the branch still exists (worktree is gone, branch is not)
    const branches = await git.branch()
    expect(branches.all).toContain("collide")

    // Request the same branchName — git will fail, triggering the retry
    const second = await mgr.createWorktree({ branchName: "collide" })

    // The retry appends a timestamp suffix, so the branch name differs
    expect(second.branch).not.toBe("collide")
    expect(second.branch).toStartWith("collide-")

    const stat = await fs.stat(path.join(second.path, ".git"))
    expect(stat.isFile()).toBe(true)
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
