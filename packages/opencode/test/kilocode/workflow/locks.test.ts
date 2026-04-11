import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { LockManager, FileLock } from "@/devilcode/workflow/locks"
import { tmpdir } from "../../fixture/fixture"

describe("workflow locks", () => {
  let tmpDir: string
  let lockManager: LockManager

  beforeEach(async () => {
    const tmp = await tmpdir()
    tmpDir = tmp.path
    lockManager = new LockManager(tmpDir)
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  describe("LockManager", () => {
    it("acquires lock for task", async () => {
      await lockManager.acquire("task-1", "worker", ["src/file.ts"])

      const locks = await lockManager.listLocks()
      expect(locks).toHaveLength(1)
      expect(locks[0].taskId).toBe("task-1")
      expect(locks[0].role).toBe("worker")
      expect(locks[0].files).toEqual(["src/file.ts"])
      expect(locks[0].lockedAt).toBeDefined()
    })

    it("re-acquires lock replacing existing", async () => {
      await lockManager.acquire("task-1", "worker", ["src/file1.ts"])
      await lockManager.acquire("task-1", "senior", ["src/file2.ts"])

      const locks = await lockManager.listLocks()
      expect(locks).toHaveLength(1)
      expect(locks[0].role).toBe("senior")
      expect(locks[0].files).toEqual(["src/file2.ts"])
    })

    it("releases lock for task", async () => {
      await lockManager.acquire("task-1", "worker", ["src/file.ts"])
      await lockManager.release("task-1")

      const locks = await lockManager.listLocks()
      expect(locks).toHaveLength(0)
    })

    it("releases all locks", async () => {
      await lockManager.acquire("task-1", "worker", ["src/file1.ts"])
      await lockManager.acquire("task-2", "senior", ["src/file2.ts"])
      await lockManager.acquire("task-3", "architect", ["src/file3.ts"])

      await lockManager.releaseAll()

      const locks = await lockManager.listLocks()
      expect(locks).toHaveLength(0)
    })

    it("checks for conflicts with locked files", async () => {
      await lockManager.acquire("task-1", "worker", ["src/file1.ts", "src/file2.ts"])

      const conflicts = await lockManager.checkConflicts(["src/file2.ts", "src/file3.ts"])
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].taskId).toBe("task-1")
    })

    it("returns empty conflicts when no overlap", async () => {
      await lockManager.acquire("task-1", "worker", ["src/file1.ts"])

      const conflicts = await lockManager.checkConflicts(["src/file2.ts", "src/file3.ts"])
      expect(conflicts).toHaveLength(0)
    })

    it("finds orphaned locks for terminal statuses", async () => {
      await lockManager.acquire("task-1", "worker", ["src/file1.ts"])
      await lockManager.acquire("task-2", "senior", ["src/file2.ts"])
      await lockManager.acquire("task-3", "worker", ["src/file3.ts"])

      const terminalStatuses = new Set(["completed", "failed"])
      const getTaskStatus = (taskId: string) => {
        if (taskId === "task-1") return "completed"
        if (taskId === "task-2") return "running"
        if (taskId === "task-3") return "failed"
        return undefined
      }

      const orphaned = await lockManager.findOrphanedLocks(terminalStatuses, getTaskStatus)
      expect(orphaned).toHaveLength(2)
      expect(orphaned.map((l) => l.taskId).sort()).toEqual(["task-1", "task-3"])
    })

    it("persists locks to file", async () => {
      await lockManager.acquire("task-1", "worker", ["src/file.ts"])

      const lockPath = path.join(tmpDir, "locks.json")
      const content = await fs.readFile(lockPath, "utf-8")
      const parsed = JSON.parse(content)

      expect(parsed.locks).toHaveLength(1)
      expect(parsed.locks[0].taskId).toBe("task-1")
    })

    it("handles concurrent lock operations", async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(lockManager.acquire(`task-${i}`, "worker", [`src/file${i}.ts`]))
      }
      await Promise.all(promises)

      const locks = await lockManager.listLocks()
      expect(locks).toHaveLength(10)
    })

    it("handles read errors gracefully", async () => {
      // Create a new manager with corrupted file
      const lockPath = path.join(tmpDir, "locks.json")
      await fs.writeFile(lockPath, "invalid json")

      const locks = await lockManager.listLocks()
      expect(locks).toEqual([])
    })
  })

  describe("FileLock schema", () => {
    it("validates correct FileLock structure", () => {
      const validLock: FileLock = {
        taskId: "task-1",
        role: "worker",
        files: ["src/file.ts"],
        lockedAt: new Date().toISOString(),
      }

      const result = FileLock.safeParse(validLock)
      expect(result.success).toBe(true)
    })

    it("rejects invalid FileLock structure", () => {
      const invalidLock = {
        taskId: "task-1",
        role: "worker",
        // missing files and lockedAt
      }

      const result = FileLock.safeParse(invalidLock)
      expect(result.success).toBe(false)
    })
  })
})
