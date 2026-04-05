import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as cp from "child_process"
import { capture, apply } from "../../src/agent-manager/git-transfer"

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile("git", args, { cwd, encoding: "utf8" }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

const noop = () => {}

describe("git-transfer", () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "git-transfer-test-"))
    await git(["init", "-b", "main"], dir)
    await git(["config", "user.email", "test@test.com"], dir)
    await git(["config", "user.name", "Test"], dir)
    // Initial commit so HEAD exists
    await fs.writeFile(path.join(dir, "init.txt"), "init\n")
    await git(["add", "."], dir)
    await git(["commit", "-m", "initial"], dir)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  describe("capture", () => {
    it("captures branch and head", async () => {
      const snapshot = await capture(dir, noop)
      expect(snapshot.branch).toBe("main")
      expect(snapshot.head).toMatch(/^[0-9a-f]{40}$/)
    })

    it("captures unstaged changes", async () => {
      await fs.writeFile(path.join(dir, "init.txt"), "modified\n")
      const snapshot = await capture(dir, noop)
      expect(snapshot.unstaged).toContain("modified")
      expect(snapshot.staged).toBeNull()
    })

    it("captures staged changes", async () => {
      await fs.writeFile(path.join(dir, "init.txt"), "staged\n")
      await git(["add", "init.txt"], dir)
      const snapshot = await capture(dir, noop)
      expect(snapshot.staged).toContain("staged")
      expect(snapshot.unstaged).toBeNull()
    })

    it("captures both staged and unstaged", async () => {
      await fs.writeFile(path.join(dir, "init.txt"), "staged\n")
      await git(["add", "init.txt"], dir)
      await fs.writeFile(path.join(dir, "init.txt"), "unstaged on top\n")
      const snapshot = await capture(dir, noop)
      expect(snapshot.staged).toContain("staged")
      expect(snapshot.unstaged).toContain("unstaged on top")
    })

    it("captures untracked files", async () => {
      await fs.writeFile(path.join(dir, "new.txt"), "brand new\n")
      const snapshot = await capture(dir, noop)
      expect(snapshot.untracked).toHaveLength(1)
      expect(snapshot.untracked[0].path).toBe("new.txt")
      expect(snapshot.untracked[0].content.toString()).toBe("brand new\n")
    })

    it("captures untracked files in subdirectories", async () => {
      await fs.mkdir(path.join(dir, "sub"), { recursive: true })
      await fs.writeFile(path.join(dir, "sub", "deep.txt"), "deep\n")
      const snapshot = await capture(dir, noop)
      expect(snapshot.untracked).toHaveLength(1)
      expect(snapshot.untracked[0].path).toBe("sub/deep.txt")
    })

    it("returns null patches when working tree is clean", async () => {
      const snapshot = await capture(dir, noop)
      expect(snapshot.unstaged).toBeNull()
      expect(snapshot.staged).toBeNull()
      expect(snapshot.untracked).toHaveLength(0)
    })
  })

  describe("apply", () => {
    let target: string

    beforeEach(async () => {
      // Create a target as a git worktree from the same repo (same commit)
      target = path.join(os.tmpdir(), `git-transfer-target-${Date.now()}`)
      await git(["worktree", "add", "-b", "test-wt", target, "HEAD"], dir)
    })

    afterEach(async () => {
      await git(["worktree", "remove", "--force", target], dir).catch(() => {})
      await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    })

    it("applies unstaged changes", async () => {
      await fs.writeFile(path.join(dir, "init.txt"), "modified\n")
      const snapshot = await capture(dir, noop)
      const result = await apply(snapshot, target, noop)
      expect(result.ok).toBe(true)
      const content = await fs.readFile(path.join(target, "init.txt"), "utf8")
      expect(content).toBe("modified\n")
      // Should show as modified in target
      const status = await git(["status", "--porcelain"], target)
      expect(status).toContain("M init.txt")
    })

    it("applies staged changes and re-stages them", async () => {
      await fs.writeFile(path.join(dir, "init.txt"), "staged\n")
      await git(["add", "init.txt"], dir)
      const snapshot = await capture(dir, noop)
      const result = await apply(snapshot, target, noop)
      expect(result.ok).toBe(true)
      const content = await fs.readFile(path.join(target, "init.txt"), "utf8")
      expect(content).toBe("staged\n")
      // Should be staged in target
      const status = await git(["status", "--porcelain"], target)
      expect(status).toContain("M  init.txt")
    })

    it("writes untracked files", async () => {
      await fs.writeFile(path.join(dir, "new.txt"), "brand new\n")
      const snapshot = await capture(dir, noop)
      const result = await apply(snapshot, target, noop)
      expect(result.ok).toBe(true)
      const content = await fs.readFile(path.join(target, "new.txt"), "utf8")
      expect(content).toBe("brand new\n")
    })

    it("creates subdirectories for untracked files", async () => {
      await fs.mkdir(path.join(dir, "a", "b"), { recursive: true })
      await fs.writeFile(path.join(dir, "a", "b", "c.txt"), "nested\n")
      const snapshot = await capture(dir, noop)
      const result = await apply(snapshot, target, noop)
      expect(result.ok).toBe(true)
      const content = await fs.readFile(path.join(target, "a", "b", "c.txt"), "utf8")
      expect(content).toBe("nested\n")
    })

    it("returns error when patch cannot be applied", async () => {
      await fs.writeFile(path.join(dir, "init.txt"), "modified\n")
      const snapshot = await capture(dir, noop)
      // Make target diverge so the patch fails
      await fs.writeFile(path.join(target, "init.txt"), "conflicting\n")
      await git(["add", "init.txt"], target)
      await git(["commit", "-m", "diverge"], target)
      const result = await apply(snapshot, target, noop)
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it("applies empty snapshot without error", async () => {
      const snapshot = await capture(dir, noop)
      const result = await apply(snapshot, target, noop)
      expect(result.ok).toBe(true)
    })
  })

  describe("round-trip", () => {
    let target: string

    beforeEach(async () => {
      target = path.join(os.tmpdir(), `git-transfer-rt-${Date.now()}`)
      await git(["worktree", "add", "-b", `rt-${Date.now()}`, target, "HEAD"], dir)
    })

    afterEach(async () => {
      await git(["worktree", "remove", "--force", target], dir).catch(() => {})
      await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    })

    it("preserves staged + unstaged + untracked in one round-trip", async () => {
      // Stage a change
      await fs.writeFile(path.join(dir, "init.txt"), "staged version\n")
      await git(["add", "init.txt"], dir)
      // Make an unstaged change on top
      await fs.writeFile(path.join(dir, "init.txt"), "unstaged version\n")
      // Add an untracked file
      await fs.writeFile(path.join(dir, "extra.txt"), "extra\n")

      const snapshot = await capture(dir, noop)
      const result = await apply(snapshot, target, noop)
      expect(result.ok).toBe(true)

      // Unstaged content should be the working tree version
      const content = await fs.readFile(path.join(target, "init.txt"), "utf8")
      expect(content).toBe("unstaged version\n")

      // Untracked file should exist
      const extra = await fs.readFile(path.join(target, "extra.txt"), "utf8")
      expect(extra).toBe("extra\n")
    })

    it("does not modify the source directory", async () => {
      await fs.writeFile(path.join(dir, "init.txt"), "changed\n")
      await fs.writeFile(path.join(dir, "new.txt"), "new\n")
      const before = await git(["status", "--porcelain"], dir)

      await capture(dir, noop)

      const after = await git(["status", "--porcelain"], dir)
      expect(after).toBe(before)
    })
  })
})
