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

  afterEach(async () => {
    await manager.flush()
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
      // Flush fire-and-forget saves from mutations, then do a final save
      await manager.flush()
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
      await mgr.flush()
      await mgr.save()

      expect(fs.existsSync(path.join(fresh, ".kilocode", "agent-manager.json"))).toBe(true)
    })
  })

  describe("tab order", () => {
    it("sets and gets tab order for a key", () => {
      manager.setTabOrder("wt-1", ["s1", "s2", "s3"])
      expect(manager.getTabOrder()["wt-1"]).toEqual(["s1", "s2", "s3"])
    })

    it("overwrites existing tab order", () => {
      manager.setTabOrder("wt-1", ["s1", "s2"])
      manager.setTabOrder("wt-1", ["s2", "s1"])
      expect(manager.getTabOrder()["wt-1"]).toEqual(["s2", "s1"])
    })

    it("removes tab order for a key", () => {
      manager.setTabOrder("wt-1", ["s1"])
      manager.removeTabOrder("wt-1")
      expect(manager.getTabOrder()["wt-1"]).toBeUndefined()
    })

    it("removeTabOrder is a no-op for missing key", () => {
      manager.removeTabOrder("nonexistent")
      expect(Object.keys(manager.getTabOrder())).toHaveLength(0)
    })

    it("cleans up tab order when worktree is removed", () => {
      const wt = manager.addWorktree({ branch: "fix", path: "/tmp/fix", parentBranch: "main" })
      manager.addSession("s1", wt.id)
      manager.setTabOrder(wt.id, ["s1"])

      manager.removeWorktree(wt.id)
      expect(manager.getTabOrder()[wt.id]).toBeUndefined()
    })

    it("removes session from tab order arrays when session is removed", () => {
      const wt = manager.addWorktree({ branch: "fix", path: "/tmp/fix", parentBranch: "main" })
      manager.addSession("s1", wt.id)
      manager.addSession("s2", wt.id)
      manager.setTabOrder(wt.id, ["s1", "s2"])

      manager.removeSession("s1")
      expect(manager.getTabOrder()[wt.id]).toEqual(["s2"])
    })

    it("removes tab order entry when last session in order is removed", () => {
      manager.addSession("s1", null)
      manager.setTabOrder("local", ["s1"])

      manager.removeSession("s1")
      expect(manager.getTabOrder()["local"]).toBeUndefined()
    })

    it("persists and loads tab order", async () => {
      const wt = manager.addWorktree({ branch: "fix", path: "/tmp/fix", parentBranch: "main" })
      manager.setTabOrder(wt.id, ["s2", "s1"])
      manager.setTabOrder("local", ["s3", "s4"])
      await manager.flush()
      await manager.save()

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()

      expect(loaded.getTabOrder()[wt.id]).toEqual(["s2", "s1"])
      expect(loaded.getTabOrder()["local"]).toEqual(["s3", "s4"])
    })

    it("does not persist empty tab order", async () => {
      manager.addWorktree({ branch: "fix", path: "/tmp/fix", parentBranch: "main" })
      await manager.flush()
      await manager.save()

      const content = fs.readFileSync(path.join(root, ".kilocode", "agent-manager.json"), "utf-8")
      const data = JSON.parse(content)
      expect(data.tabOrder).toBeUndefined()
    })
  })

  describe("sessionsCollapsed", () => {
    it("defaults to false", () => {
      expect(manager.getSessionsCollapsed()).toBe(false)
    })

    it("sets and gets collapsed state", () => {
      manager.setSessionsCollapsed(true)
      expect(manager.getSessionsCollapsed()).toBe(true)

      manager.setSessionsCollapsed(false)
      expect(manager.getSessionsCollapsed()).toBe(false)
    })

    it("persists and loads collapsed state", async () => {
      manager.setSessionsCollapsed(true)
      await manager.flush()
      await manager.save()

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()
      expect(loaded.getSessionsCollapsed()).toBe(true)
    })

    it("does not persist when false", async () => {
      manager.setSessionsCollapsed(false)
      await manager.flush()
      await manager.save()

      const content = fs.readFileSync(path.join(root, ".kilocode", "agent-manager.json"), "utf-8")
      const data = JSON.parse(content)
      expect(data.sessionsCollapsed).toBeUndefined()
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

  describe("concurrent save serialization", () => {
    it("rapid mutations do not lose data after flush", async () => {
      // Fire many mutations without awaiting saves individually
      for (let i = 0; i < 20; i++) {
        manager.addWorktree({ branch: `b-${i}`, path: `/tmp/b-${i}`, parentBranch: "main" })
      }
      for (let i = 0; i < 20; i++) {
        manager.addSession(`s-${i}`, null)
      }

      // Wait for all fire-and-forget saves to settle
      await manager.flush()
      await manager.save()

      // Reload from disk and verify all data persisted
      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()

      expect(loaded.getWorktrees()).toHaveLength(20)
      expect(loaded.getSessions()).toHaveLength(20)
      for (let i = 0; i < 20; i++) {
        expect(loaded.getWorktrees().find((w) => w.branch === `b-${i}`)).toBeTruthy()
        expect(loaded.getSession(`s-${i}`)).toBeTruthy()
      }
    })

    it("interleaved add and remove persists correctly", async () => {
      const wt1 = manager.addWorktree({ branch: "keep", path: "/tmp/keep", parentBranch: "main" })
      const wt2 = manager.addWorktree({ branch: "remove", path: "/tmp/remove", parentBranch: "main" })
      manager.addSession("s1", wt1.id)
      manager.addSession("s2", wt2.id)
      manager.removeWorktree(wt2.id)
      manager.addSession("s3", wt1.id)

      await manager.flush()
      await manager.save()

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()

      expect(loaded.getWorktrees()).toHaveLength(1)
      expect(loaded.getWorktrees()[0].branch).toBe("keep")
      // s2 was orphaned when wt2 was removed, s1 and s3 belong to wt1
      expect(loaded.getSession("s1")?.worktreeId).toBe(wt1.id)
      expect(loaded.getSession("s2")?.worktreeId).toBeNull()
      expect(loaded.getSession("s3")?.worktreeId).toBe(wt1.id)
    })

    it("concurrent save() calls resolve without data loss", async () => {
      manager.addWorktree({ branch: "first", path: "/tmp/first", parentBranch: "main" })

      // Trigger multiple saves concurrently — the second should queue behind the first
      const p1 = manager.save()
      manager.addWorktree({ branch: "second", path: "/tmp/second", parentBranch: "main" })
      const p2 = manager.save()
      await Promise.all([p1, p2])

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()
      expect(loaded.getWorktrees()).toHaveLength(2)
    })

    it("flush resolves after in-flight save completes", async () => {
      manager.addWorktree({ branch: "flush-test", path: "/tmp/flush", parentBranch: "main" })
      // Don't await — let save fire in background
      void manager.save()
      // flush must wait for it
      await manager.flush()

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()
      expect(loaded.getWorktrees().find((w) => w.branch === "flush-test")).toBeTruthy()
    })
  })

  describe("load with corrupt data", () => {
    it("handles malformed JSON gracefully", async () => {
      const file = path.join(root, ".kilocode", "agent-manager.json")
      fs.writeFileSync(file, "not-valid-json{{{", "utf-8")

      await manager.load()

      // State should be empty — no crash
      expect(manager.getWorktrees()).toHaveLength(0)
      expect(manager.getSessions()).toHaveLength(0)
      // Should have logged an error
      expect(logs.some((l) => l.includes("Failed to load state"))).toBe(true)
    })

    it("handles partial data with missing sessions key", async () => {
      const file = path.join(root, ".kilocode", "agent-manager.json")
      fs.writeFileSync(
        file,
        JSON.stringify({
          worktrees: { "wt-1": { branch: "a", path: "/a", parentBranch: "main", createdAt: new Date().toISOString() } },
        }),
        "utf-8",
      )

      await manager.load()

      expect(manager.getWorktrees()).toHaveLength(1)
      expect(manager.getWorktrees()[0].branch).toBe("a")
      expect(manager.getSessions()).toHaveLength(0)
    })

    it("handles partial data with missing worktrees key", async () => {
      const file = path.join(root, ".kilocode", "agent-manager.json")
      fs.writeFileSync(
        file,
        JSON.stringify({ sessions: { "s-1": { worktreeId: null, createdAt: new Date().toISOString() } } }),
        "utf-8",
      )

      await manager.load()

      expect(manager.getWorktrees()).toHaveLength(0)
      expect(manager.getSessions()).toHaveLength(1)
    })
  })
})
