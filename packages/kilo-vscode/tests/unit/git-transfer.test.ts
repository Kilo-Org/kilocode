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

    it("preserves both sides of a staged rename and later unstaged edits", async () => {
      await git(["mv", "init.txt", "renamed.txt"], dir)
      await fs.writeFile(path.join(dir, "renamed.txt"), "unstaged after rename\n")
      const tree = await git(["write-tree"], dir)
      const status = await git(["status", "--porcelain"], dir)
      const snapshot = await capture(dir, noop)

      expect(await apply(snapshot, target, noop)).toEqual({ ok: true })

      expect(await git(["write-tree"], target)).toBe(tree)
      expect(await git(["ls-files"], target)).toBe("renamed.txt")
      expect(await git(["show", ":renamed.txt"], target)).toBe("init")
      expect(await fs.readFile(path.join(target, "renamed.txt"), "utf8")).toBe("unstaged after rename\n")
      expect(await git(["status", "--porcelain"], target)).toBe(status)
      expect(await git(["write-tree"], dir)).toBe(tree)
      expect(await git(["status", "--porcelain"], dir)).toBe(status)
      expect(await fs.readFile(path.join(dir, "renamed.txt"), "utf8")).toBe("unstaged after rename\n")
    })

    it("preserves a staged deletion", async () => {
      await git(["rm", "init.txt"], dir)
      const tree = await git(["write-tree"], dir)
      const status = await git(["status", "--porcelain"], dir)
      const snapshot = await capture(dir, noop)

      expect(await apply(snapshot, target, noop)).toEqual({ ok: true })

      expect(await git(["write-tree"], target)).toBe(tree)
      expect(await git(["diff"], target)).toBe("")
      expect(await git(["status", "--porcelain"], target)).toBe(status)
      await expect(fs.stat(path.join(target, "init.txt"))).rejects.toThrow()
      expect(await git(["write-tree"], dir)).toBe(tree)
      expect(await git(["status", "--porcelain"], dir)).toBe(status)
    })

    it.skipIf(process.platform === "win32")("preserves a staged executable mode change", async () => {
      await git(["config", "core.fileMode", "true"], dir)
      await fs.chmod(path.join(dir, "init.txt"), 0o755)
      await git(["add", "init.txt"], dir)
      const tree = await git(["write-tree"], dir)
      const status = await git(["status", "--porcelain"], dir)
      const snapshot = await capture(dir, noop)

      expect(await apply(snapshot, target, noop)).toEqual({ ok: true })

      expect(await git(["write-tree"], target)).toBe(tree)
      expect(await git(["ls-files", "--stage"], target)).toStartWith("100755 ")
      expect((await fs.stat(path.join(target, "init.txt"))).mode & 0o111).toBe(0o111)
      expect(await git(["diff"], target)).toBe("")
      expect(await git(["write-tree"], dir)).toBe(tree)
      expect(await git(["status", "--porcelain"], dir)).toBe(status)
    })

    it("preserves separate staged and unstaged binary contents", async () => {
      const staged = Buffer.from([0, 1, 2, 3, 255])
      const unstaged = Buffer.from([0, 1, 4, 255])
      await fs.writeFile(path.join(dir, "binary.dat"), staged)
      await git(["add", "binary.dat"], dir)
      await fs.writeFile(path.join(dir, "binary.dat"), unstaged)
      const tree = await git(["write-tree"], dir)
      const status = await git(["status", "--porcelain"], dir)
      const snapshot = await capture(dir, noop)

      expect(snapshot.staged).toContain("GIT binary patch")
      expect(snapshot.unstaged).toContain("GIT binary patch")
      expect(await apply(snapshot, target, noop)).toEqual({ ok: true })

      expect(await git(["write-tree"], target)).toBe(tree)
      expect(await fs.readFile(path.join(target, "binary.dat"))).toEqual(unstaged)
      expect(await git(["status", "--porcelain"], target)).toBe(status)
      expect(await git(["write-tree"], dir)).toBe(tree)
      expect(await git(["status", "--porcelain"], dir)).toBe(status)
      expect(await fs.readFile(path.join(dir, "binary.dat"))).toEqual(unstaged)
    })

    it("rejects a staged transfer when the destination index and working tree disagree", async () => {
      await fs.writeFile(path.join(dir, "init.txt"), "staged\n")
      await git(["add", "init.txt"], dir)
      const snapshot = await capture(dir, noop)
      await fs.writeFile(path.join(target, "init.txt"), "destination changes\n")
      const tree = await git(["write-tree"], target)

      const result = await apply(snapshot, target, noop)

      expect(result.ok).toBe(false)
      expect(result.error).toContain("Staged patch failed")
      expect(await git(["write-tree"], target)).toBe(tree)
      expect(await fs.readFile(path.join(target, "init.txt"), "utf8")).toBe("destination changes\n")
      expect(await git(["show", ":init.txt"], dir)).toBe("staged")
      expect(await fs.readFile(path.join(dir, "init.txt"), "utf8")).toBe("staged\n")
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
      const tree = await git(["write-tree"], dir)
      const status = await git(["status", "--porcelain"], dir)

      const snapshot = await capture(dir, noop)
      const result = await apply(snapshot, target, noop)
      expect(result.ok).toBe(true)

      // Unstaged content should be the working tree version
      const content = await fs.readFile(path.join(target, "init.txt"), "utf8")
      expect(content).toBe("unstaged version\n")

      // Untracked file should exist
      const extra = await fs.readFile(path.join(target, "extra.txt"), "utf8")
      expect(extra).toBe("extra\n")
      expect(await git(["show", ":init.txt"], target)).toBe("staged version")
      expect(await git(["write-tree"], target)).toBe(tree)
      expect(await git(["status", "--porcelain"], target)).toBe(status)
      expect(await git(["write-tree"], dir)).toBe(tree)
      expect(await git(["status", "--porcelain"], dir)).toBe(status)
      expect(await fs.readFile(path.join(dir, "init.txt"), "utf8")).toBe("unstaged version\n")
      expect(await fs.readFile(path.join(dir, "extra.txt"), "utf8")).toBe("extra\n")
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
