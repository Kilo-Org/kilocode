import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

describe("WorktreeStateManager sections", () => {
  let root: string
  let mgr: WorktreeStateManager

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "wtsm-sec-"))
    fs.mkdirSync(path.join(root, ".kilo"), { recursive: true })
    mgr = new WorktreeStateManager(root, () => {})
  })

  afterEach(async () => {
    await mgr.flush()
    fs.rmSync(root, { recursive: true, force: true })
  })

  describe("addSection", () => {
    it("creates a section with correct defaults", () => {
      const sec = mgr.addSection("Backend", "Blue")
      expect(sec.id).toMatch(/^sec-/)
      expect(sec.name).toBe("Backend")
      expect(sec.color).toBe("Blue")
      expect(sec.collapsed).toBe(false)
      expect(mgr.getWorktreeOrder()).toContain(sec.id)
    })

    it("adds section id to worktreeOrder", () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      mgr.setWorktreeOrder([wt.id])
      const sec = mgr.addSection("Infra", null)
      expect(mgr.getWorktreeOrder()).toEqual([wt.id, sec.id])
    })

    it("moves specified worktrees into the section", () => {
      const wt1 = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const wt2 = mgr.addWorktree({ branch: "b", path: "/tmp/b", parentBranch: "main" })
      mgr.setWorktreeOrder([wt1.id, wt2.id])

      const sec = mgr.addSection("Group", "Red", [wt1.id])
      expect(mgr.getWorktree(wt1.id)?.sectionId).toBe(sec.id)
      expect(mgr.getWorktree(wt2.id)?.sectionId).toBeUndefined()
      // Worktree ids stay in the persisted order so section member order can be restored.
      expect(mgr.getWorktreeOrder()).toContain(wt1.id)
      expect(mgr.getWorktreeOrder()).toContain(wt2.id)
    })
  })

  describe("renameSection", () => {
    it("updates the name", () => {
      const sec = mgr.addSection("Old", null)
      mgr.renameSection(sec.id, "New")
      expect(mgr.getSection(sec.id)?.name).toBe("New")
    })

    it("rejects empty string", () => {
      const sec = mgr.addSection("Keep", null)
      mgr.renameSection(sec.id, "")
      expect(mgr.getSection(sec.id)?.name).toBe("Keep")
    })

    it("is a no-op for unknown id", () => {
      mgr.renameSection("nonexistent", "Foo")
      expect(mgr.getSections()).toHaveLength(0)
    })
  })

  describe("setSectionColor", () => {
    it("updates color", () => {
      const sec = mgr.addSection("X", null)
      mgr.setSectionColor(sec.id, "Green")
      expect(mgr.getSection(sec.id)?.color).toBe("Green")
    })

    it("accepts null for default", () => {
      const sec = mgr.addSection("X", "Red")
      mgr.setSectionColor(sec.id, null)
      expect(mgr.getSection(sec.id)?.color).toBeNull()
    })
  })

  describe("toggleSection", () => {
    it("flips collapsed state", () => {
      const sec = mgr.addSection("T", null)
      expect(sec.collapsed).toBe(false)

      mgr.toggleSection(sec.id)
      expect(mgr.getSection(sec.id)?.collapsed).toBe(true)

      mgr.toggleSection(sec.id)
      expect(mgr.getSection(sec.id)?.collapsed).toBe(false)
    })
  })

  describe("deleteSection", () => {
    it("removes section and ungroups its worktrees", () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const sec = mgr.addSection("Del", null, [wt.id])
      expect(mgr.getWorktree(wt.id)?.sectionId).toBe(sec.id)

      mgr.deleteSection(sec.id)
      expect(mgr.getSection(sec.id)).toBeUndefined()
      // worktree still exists but sectionId cleared
      expect(mgr.getWorktree(wt.id)).toBeTruthy()
      expect(mgr.getWorktree(wt.id)?.sectionId).toBeUndefined()
    })

    it("removes section from worktreeOrder", () => {
      const sec = mgr.addSection("Gone", null)
      expect(mgr.getWorktreeOrder()).toContain(sec.id)
      mgr.deleteSection(sec.id)
      expect(mgr.getWorktreeOrder()).not.toContain(sec.id)
    })

    it("is a no-op for unknown id", () => {
      mgr.deleteSection("nonexistent")
      expect(mgr.getSections()).toHaveLength(0)
    })
  })

  describe("moveToSection", () => {
    it("sets sectionId and keeps worktreeOrder for section member sorting", () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      mgr.setWorktreeOrder([wt.id])
      const sec = mgr.addSection("Target", null)

      mgr.moveToSection([wt.id], sec.id)
      expect(mgr.getWorktree(wt.id)?.sectionId).toBe(sec.id)
      expect(mgr.getWorktreeOrder()).toContain(wt.id)
    })

    it("ungroups worktrees with null sectionId and keeps them in order", () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      mgr.addSection("Temp", null, [wt.id])
      expect(mgr.getWorktreeOrder()).toContain(wt.id)

      mgr.moveToSection([wt.id], null)
      expect(mgr.getWorktree(wt.id)?.sectionId).toBeUndefined()
      expect(mgr.getWorktreeOrder()).toContain(wt.id)
    })

    it("expands to multi-version siblings with same groupId", () => {
      const wt1 = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main", groupId: "g1" })
      const wt2 = mgr.addWorktree({ branch: "b", path: "/tmp/b", parentBranch: "main", groupId: "g1" })
      const wt3 = mgr.addWorktree({ branch: "c", path: "/tmp/c", parentBranch: "main" })
      mgr.setWorktreeOrder([wt1.id, wt2.id, wt3.id])
      const sec = mgr.addSection("Multi", null)

      // Move only wt1 — wt2 should follow because of shared groupId
      mgr.moveToSection([wt1.id], sec.id)
      expect(mgr.getWorktree(wt1.id)?.sectionId).toBe(sec.id)
      expect(mgr.getWorktree(wt2.id)?.sectionId).toBe(sec.id)
      expect(mgr.getWorktree(wt3.id)?.sectionId).toBeUndefined()
    })

    it("does not duplicate in worktreeOrder when ungrouping already-present id", () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      mgr.setWorktreeOrder([wt.id])
      // Ungroup when already in order
      mgr.moveToSection([wt.id], null)
      const count = mgr.getWorktreeOrder().filter((id) => id === wt.id).length
      expect(count).toBe(1)
    })
  })

  describe("getSections", () => {
    it("returns all sections", () => {
      mgr.addSection("A", null)
      mgr.addSection("B", "Red")
      mgr.addSection("C", "Blue")
      expect(mgr.getSections()).toHaveLength(3)
    })

    it("returns empty array when no sections", () => {
      expect(mgr.getSections()).toEqual([])
    })
  })

  describe("moveSection", () => {
    it("moves a section up within mixed top-level order", () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      mgr.setWorktreeOrder([wt.id])
      const a = mgr.addSection("A", null)
      const b = mgr.addSection("B", null)
      expect(mgr.getWorktreeOrder()).toEqual([wt.id, a.id, b.id])
      mgr.moveSection(b.id, -1)
      expect(mgr.getWorktreeOrder()).toEqual([wt.id, b.id, a.id])
    })

    it("moves a section down within mixed top-level order", () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      mgr.setWorktreeOrder([wt.id])
      const a = mgr.addSection("A", null)
      const b = mgr.addSection("B", null)
      expect(mgr.getWorktreeOrder()).toEqual([wt.id, a.id, b.id])
      mgr.moveSection(a.id, 1)
      expect(mgr.getWorktreeOrder()).toEqual([wt.id, b.id, a.id])
    })

    it("is a no-op at boundaries", () => {
      const a = mgr.addSection("A", null)
      const b = mgr.addSection("B", null)
      mgr.moveSection(a.id, -1)
      expect(mgr.getWorktreeOrder()).toEqual([a.id, b.id])
      mgr.moveSection(b.id, 1)
      expect(mgr.getWorktreeOrder()).toEqual([a.id, b.id])
    })

    it("does not change section membership", () => {
      const wt1 = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const wt2 = mgr.addWorktree({ branch: "b", path: "/tmp/b", parentBranch: "main" })
      const a = mgr.addSection("A", null, [wt1.id, wt2.id])
      const b = mgr.addSection("B", null)
      mgr.moveSection(b.id, -1)
      expect(mgr.getWorktree(wt1.id)?.sectionId).toBe(a.id)
      expect(mgr.getWorktree(wt2.id)?.sectionId).toBe(a.id)
    })

    it("persists reordered sections across save/load", async () => {
      const a = mgr.addSection("A", null)
      const b = mgr.addSection("B", null)
      mgr.moveSection(b.id, -1)
      await mgr.flush()
      await mgr.save()
      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()
      expect(loaded.getWorktreeOrder()).toEqual([b.id, a.id])
    })

    it("updates section order fields when moving", () => {
      const a = mgr.addSection("A", null)
      const b = mgr.addSection("B", null)

      mgr.moveSection(b.id, -1)

      expect(mgr.getSection(b.id)?.order).toBe(0)
      expect(mgr.getSection(a.id)?.order).toBe(1)
    })

    it("repairs stale orders missing section ids before moving", () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const a = mgr.addSection("A", null)
      const b = mgr.addSection("B", null)

      mgr.setWorktreeOrder([wt.id])
      mgr.moveSection(b.id, -1)

      expect(mgr.getWorktreeOrder()).toContain(a.id)
      expect(mgr.getWorktreeOrder()).toContain(b.id)
      expect(mgr.getWorktreeOrder().indexOf(b.id)).toBeLessThan(mgr.getWorktreeOrder().indexOf(a.id))
    })
  })

  describe("persistence", () => {
    it("saves and loads sections", async () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const sec = mgr.addSection("Persist", "Green", [wt.id])
      mgr.toggleSection(sec.id)
      await mgr.flush()
      await mgr.save()

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()

      const secs = loaded.getSections()
      expect(secs).toHaveLength(1)
      const first = secs[0]!
      expect(first.name).toBe("Persist")
      expect(first.color).toBe("Green")
      expect(first.collapsed).toBe(true)
      expect(loaded.getWorktree(wt.id)?.sectionId).toBe(sec.id)
    })

    it("normalizes worktreeOrder on load to include missing section IDs", async () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const sec = mgr.addSection("S", null)
      await mgr.flush()
      await mgr.save()
      // Simulate stale data: manually remove section from worktreeOrder
      const file = path.join(root, ".kilo", "agent-manager.json")
      const data = JSON.parse(fs.readFileSync(file, "utf-8"))
      data.worktreeOrder = [wt.id] // section ID missing
      fs.writeFileSync(file, JSON.stringify(data))

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()
      expect(loaded.getWorktreeOrder()).toContain(sec.id)
      expect(loaded.getWorktreeOrder()).toContain(wt.id)
    })

    it("normalizes worktreeOrder on load to include missing ungrouped worktrees", async () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      await mgr.flush()
      await mgr.save()
      const file = path.join(root, ".kilo", "agent-manager.json")
      const data = JSON.parse(fs.readFileSync(file, "utf-8"))
      data.worktreeOrder = [] // worktree ID missing
      fs.writeFileSync(file, JSON.stringify(data))

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()
      expect(loaded.getWorktreeOrder()).toContain(wt.id)
    })

    it("normalizes worktreeOrder on load to include section member worktrees", async () => {
      const wt = mgr.addWorktree({ branch: "a", path: "/tmp/a", parentBranch: "main" })
      const sec = mgr.addSection("S", null, [wt.id])
      await mgr.flush()
      await mgr.save()
      const file = path.join(root, ".kilo", "agent-manager.json")
      const data = JSON.parse(fs.readFileSync(file, "utf-8"))
      data.worktreeOrder = [sec.id]
      fs.writeFileSync(file, JSON.stringify(data))

      const loaded = new WorktreeStateManager(root, () => {})
      await loaded.load()
      expect(loaded.getWorktreeOrder()).toContain(wt.id)
    })
  })
})
