import { describe, test, expect, beforeEach } from "bun:test"
import { LockManager, type FileLock } from "@/devilcode/workflow/locks"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("LockManager", () => {
  let tmpDir: string
  let manager: LockManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "locks-test-"))
    const planningDir = path.join(tmpDir, ".planning")
    await fs.mkdir(planningDir, { recursive: true })
    manager = new LockManager(planningDir)
  })

  test("acquire and release lock", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    const locks = await manager.listLocks()
    expect(locks).toHaveLength(1)
    expect(locks[0].taskId).toBe("T-001")
    expect(locks[0].files).toEqual(["src/foo.ts"])

    await manager.release("T-001")
    const after = await manager.listLocks()
    expect(after).toHaveLength(0)
  })

  test("detects conflicts", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts", "src/bar.ts"])
    const conflicts = await manager.checkConflicts(["src/foo.ts", "src/baz.ts"])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].taskId).toBe("T-001")
  })

  test("no conflict on different files", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    const conflicts = await manager.checkConflicts(["src/bar.ts"])
    expect(conflicts).toHaveLength(0)
  })

  test("multiple locks coexist", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    await manager.acquire("T-002", "senior", ["src/bar.ts"])
    const locks = await manager.listLocks()
    expect(locks).toHaveLength(2)
  })

  test("findOrphanedLocks returns locks for completed tasks", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    const orphans = await manager.findOrphanedLocks(new Set(["completed", "failed"]), (id) =>
      id === "T-001" ? "completed" : "pending",
    )
    expect(orphans).toHaveLength(1)
  })

  test("findOrphanedLocks ignores active tasks", async () => {
    await manager.acquire("T-001", "worker", ["src/foo.ts"])
    const orphans = await manager.findOrphanedLocks(new Set(["completed", "failed"]), (id) => "in_progress")
    expect(orphans).toHaveLength(0)
  })

  test("releaseAll clears everything", async () => {
    await manager.acquire("T-001", "worker", ["a.ts"])
    await manager.acquire("T-002", "senior", ["b.ts"])
    await manager.releaseAll()
    const locks = await manager.listLocks()
    expect(locks).toHaveLength(0)
  })
})
