import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

describe("WorktreeStateManager", () => {
  let root: string
  let manager: WorktreeStateManager
  const logs: string[] = []

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "wtsm-test-"))
    // Pre-create .kilocode dir so fire-and-forget saves don't race on mkdir
    fs.mkdirSync(path.join(root, ".kilocode"), { recursive: true })
    logs.length = 0
    manager = new WorktreeStateManager(root, (msg) => logs.push(msg))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  describe("worktree CRUD", () => {
    it("adds and retrieves worktrees", () => {
      const wt = manager.addWorktree({ branch: "fix-123", path: "/tmp/wt", parentBranch: "main" })
      expect(wt.id).toMatch(/^wt-/)
      expect(wt.branch).toBe("fix-123")
      expect(wt.createdAt).toBeTruthy()

      expect(manager.getWorktrees()).toHaveLength(1)
      expect(manager.getWorktree(wt.id)).toEqual(wt)
    })

    it("finds worktree by path", () => {
      manager.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const b = manager.addWorktree({ branch: "b", path: "/tmp/b", parentBranch: "main" })

      expect(manager.findWorktreeByPath("/tmp/b")?.id).toBe(b.id)
      expect(manager.findWorktreeByPath("/tmp/c")).toBeUndefined()
    })

    it("removes worktree and orphans sessions", () => {
      const wt = manager.addWorktree({ branch: "fix", path: "/tmp/fix", parentBranch: "main" })
      manager.addSession("s1", wt.id)
      manager.addSession("s2", wt.id)

      const orphaned = manager.removeWorktree(wt.id)
      expect(orphaned).toHaveLength(2)
      expect(manager.getWorktrees()).toHaveLength(0)
      // Sessions still exist but with null worktreeId
      expect(manager.getSession("s1")?.worktreeId).toBeNull()
      expect(manager.getSession("s2")?.worktreeId).toBeNull()
    })

    it("returns empty array when removing nonexistent worktree", () => {
      expect(manager.removeWorktree("nonexistent")).toHaveLength(0)
    })
  })

  describe("session CRUD", () => {
    it("adds and retrieves sessions", () => {
      const wt = manager.addWorktree({ branch: "fix", path: "/tmp/fix", parentBranch: "main" })
      const s = manager.addSession("sess-1", wt.id)

      expect(s.id).toBe("sess-1")
      expect(s.worktreeId).toBe(wt.id)
      expect(manager.getSession("sess-1")).toEqual(s)
    })

    it("adds session with null worktreeId", () => {
      const s = manager.addSession("local-1", null)
      expect(s.worktreeId).toBeNull()
    })

    it("filters sessions by worktreeId", () => {
      const wt1 = manager.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const wt2 = manager.addWorktree({ branch: "b", path: "/tmp/b", parentBranch: "main" })
      manager.addSession("s1", wt1.id)
      manager.addSession("s2", wt1.id)
      manager.addSession("s3", wt2.id)

      expect(manager.getSessions(wt1.id)).toHaveLength(2)
      expect(manager.getSessions(wt2.id)).toHaveLength(1)
      expect(manager.getSessions()).toHaveLength(3)
    })

    it("moves session to a different worktree", () => {
      const wt1 = manager.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const wt2 = manager.addWorktree({ branch: "b", path: "/tmp/b", parentBranch: "main" })
      manager.addSession("s1", wt1.id)

      manager.moveSession("s1", wt2.id)
      expect(manager.getSession("s1")?.worktreeId).toBe(wt2.id)
    })

    it("moveSession is a no-op for nonexistent session", () => {
      manager.moveSession("nonexistent", "wt-1")
      expect(manager.getSessions()).toHaveLength(0)
    })

    it("removes session", () => {
      manager.addSession("s1", null)
      manager.removeSession("s1")
      expect(manager.getSession("s1")).toBeUndefined()
    })
  })

  describe("directoryFor", () => {
    it("returns worktree path for worktree session", () => {
      const wt = manager.addWorktree({ branch: "fix", path: "/tmp/fix", parentBranch: "main" })
      manager.addSession("s1", wt.id)
      expect(manager.directoryFor("s1")).toBe("/tmp/fix")
    })

    it("returns undefined for local session", () => {
      manager.addSession("s1", null)
      expect(manager.directoryFor("s1")).toBeUndefined()
    })

    it("returns undefined for unknown session", () => {
      expect(manager.directoryFor("nonexistent")).toBeUndefined()
    })
  })

  describe("worktreeSessionIds", () => {
    it("returns only session IDs that belong to worktrees", () => {
      const wt = manager.addWorktree({ branch: "fix", path: "/tmp/fix", parentBranch: "main" })
      manager.addSession("s1", wt.id)
      manager.addSession("s2", null)
      manager.addSession("s3", wt.id)

      const ids = manager.worktreeSessionIds()
      expect(ids.size).toBe(2)
      expect(ids.has("s1")).toBe(true)
      expect(ids.has("s3")).toBe(true)
      expect(ids.has("s2")).toBe(false)
    })
  })

  describe("persistence", () => {
    it("saves and loads state", async () => {
      const wt = manager.addWorktree({ branch: "fix", path: "/tmp/fix", parentBranch: "main" })
      manager.addSession("s1", wt.id)
      manager.addSession("s2", null)
      // Wait for fire-and-forget saves from mutations to settle
      await new Promise((r) => setTimeout(r, 200))
      await manager.save()

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()

      expect(loaded.getWorktrees()).toHaveLength(1)
      expect(loaded.getWorktrees()[0].branch).toBe("fix")
      expect(loaded.getSessions()).toHaveLength(2)
      expect(loaded.getSession("s1")?.worktreeId).toBe(wt.id)
      expect(loaded.getSession("s2")?.worktreeId).toBeNull()
    })

    it("load is a no-op when file does not exist", async () => {
      await manager.load()
      expect(manager.getWorktrees()).toHaveLength(0)
      expect(manager.getSessions()).toHaveLength(0)
    })

    it("creates .kilocode directory if missing", async () => {
      const fresh = path.join(root, "subdir")
      const mgr = new WorktreeStateManager(fresh, () => {})
      mgr.addWorktree({ branch: "test", path: "/tmp/test", parentBranch: "main" })
      await mgr.save()

      expect(fs.existsSync(path.join(fresh, ".kilocode", "agent-manager.json"))).toBe(true)
    })
  })

  describe("validate", () => {
    it("removes worktrees whose directories do not exist", async () => {
      const existing = path.join(root, "wt-exists")
      fs.mkdirSync(existing, { recursive: true })

      manager.addWorktree({ branch: "exists", path: existing, parentBranch: "main" })
      manager.addWorktree({ branch: "gone", path: path.join(root, "wt-gone"), parentBranch: "main" })
      manager.addSession("s1", manager.getWorktrees()[1].id)

      await manager.validate(root)

      expect(manager.getWorktrees()).toHaveLength(1)
      expect(manager.getWorktrees()[0].branch).toBe("exists")
      // Session orphaned (worktreeId set to null)
      expect(manager.getSession("s1")?.worktreeId).toBeNull()
    })

    it("resolves relative paths against root", async () => {
      const relative = ".kilocode/worktrees/test-branch"
      const absolute = path.join(root, relative)
      fs.mkdirSync(absolute, { recursive: true })

      manager.addWorktree({ branch: "test", path: relative, parentBranch: "main" })
      await manager.validate(root)

      expect(manager.getWorktrees()).toHaveLength(1)
    })
  })
})
