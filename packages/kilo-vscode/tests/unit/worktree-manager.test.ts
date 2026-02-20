import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { WorktreeManager } from "../../src/agent-manager/WorktreeManager"
import { generateBranchName } from "../../src/agent-manager/branch-name"
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

// ---------------------------------------------------------------------------
// generateBranchName
// ---------------------------------------------------------------------------

describe("generateBranchName", () => {
  it("sanitizes special characters", () => {
    const name = generateBranchName("Fix bug #123 & add feature!")
    // Should only contain lowercase alphanumeric and hyphens (plus timestamp)
    expect(name).toMatch(/^fix-bug-123-add-feature-\d+$/)
  })

  it("truncates long prompts to 50 chars before sanitizing", () => {
    const long = "a".repeat(100)
    const name = generateBranchName(long)
    // 50 a's + hyphen + timestamp
    const prefix = name.split("-").slice(0, -1).join("-")
    expect(prefix.length).toBeLessThanOrEqual(50)
  })

  it("falls back to 'kilo' for empty input", () => {
    expect(generateBranchName("")).toMatch(/^kilo-\d+$/)
  })

  it("falls back to 'kilo' for whitespace-only input", () => {
    expect(generateBranchName("   ")).toMatch(/^kilo-\d+$/)
  })

  it("strips leading and trailing hyphens from sanitized text", () => {
    const name = generateBranchName("---hello---")
    expect(name).toMatch(/^hello-\d+$/)
  })

  it("collapses consecutive hyphens", () => {
    const name = generateBranchName("one   two   three")
    expect(name).toMatch(/^one-two-three-\d+$/)
  })

  it("lowercases input", () => {
    const name = generateBranchName("FIX BUG")
    expect(name).toMatch(/^fix-bug-\d+$/)
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

    expect(result.branch).toMatch(/^test-task-\d+$/)
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

  it("creates worktrees directory under .kilocode/worktrees/", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    const result = await mgr.createWorktree({ prompt: "test" })

    expect(result.path).toContain(path.join(".kilocode", "worktrees"))
  })

  it("records parentBranch as current branch", async () => {
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
  })

  it("does not throw when worktree path does not exist", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    // Should not throw
    await mgr.removeWorktree(path.join(root, ".kilocode", "worktrees", "nonexistent"))
  })

  it("removes orphaned directory that git does not know about", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    // Create an orphaned directory (not a real worktree)
    const orphanPath = path.join(root, ".kilocode", "worktrees", "orphan")
    await fs.mkdir(orphanPath, { recursive: true })
    await fs.writeFile(path.join(orphanPath, "file.txt"), "orphan")

    await mgr.removeWorktree(orphanPath)

    const exists = await fs
      .stat(orphanPath)
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
    const dir = path.join(result.path, ".kilocode")
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
    expect(discovered[0].sessionId).toBeUndefined()
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
})

// ---------------------------------------------------------------------------
// WorktreeManager -- ensureGitExclude
// ---------------------------------------------------------------------------

describe("WorktreeManager.ensureGitExclude", () => {
  it("adds .kilocode/worktrees/ to .git/info/exclude", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    await mgr.ensureGitExclude()

    const content = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    expect(content).toContain(".kilocode/worktrees/")
  })

  it("is idempotent -- does not duplicate entries", async () => {
    const root = await createTempRepo()
    const mgr = createManager(root)

    await mgr.ensureGitExclude()
    await mgr.ensureGitExclude()
    await mgr.ensureGitExclude()

    const content = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    const count = content.split(".kilocode/worktrees/").length - 1
    expect(count).toBe(1)
  })
})
