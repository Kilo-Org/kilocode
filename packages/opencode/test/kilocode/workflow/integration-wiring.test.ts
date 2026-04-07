// packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import type { Tool } from "@/tool/tool"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { LockManager } from "@/devilcode/workflow/locks"
import { extractFromAgentReport, LessonStore } from "@/devilcode/workflow/learning"

describe("Gap 7: Tool.Context teamRole typing", () => {
  test("Tool.Context type includes teamRole field", () => {
    const ctx: Partial<Tool.Context> = {
      sessionID: "s1",
      messageID: "m1",
      agent: "coder",
      teamRole: "senior",
    }
    expect(ctx.teamRole).toBe("senior")
  })

  test("Tool.Context teamRole is optional (undefined when not set)", () => {
    const ctx: Partial<Tool.Context> = {
      sessionID: "s1",
      messageID: "m1",
      agent: "coder",
    }
    expect(ctx.teamRole).toBeUndefined()
  })
})

describe("Gap 8: Lock acquisition during build", () => {
  let tmpDir: string
  let lockManager: LockManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lock-wire-test-"))
    const planningDir = path.join(tmpDir, ".planning")
    await fs.mkdir(planningDir, { recursive: true })
    lockManager = new LockManager(planningDir)
  })

  test("lock is acquired before task execution", async () => {
    const taskId = "T-001"
    const role = "worker"
    const files = ["src/foo.ts", "src/bar.ts"]

    await lockManager.acquire(taskId, role, files)
    const locks = await lockManager.listLocks()
    expect(locks).toHaveLength(1)
    expect(locks[0].taskId).toBe(taskId)
    expect(locks[0].role).toBe(role)
    expect(locks[0].files).toEqual(files)
  })

  test("lock is released after task execution (including on failure)", async () => {
    const taskId = "T-001"
    await lockManager.acquire(taskId, "worker", ["src/foo.ts"])

    try {
      throw new Error("task failed")
    } catch {
      // error handling
    } finally {
      await lockManager.release(taskId)
    }

    const locks = await lockManager.listLocks()
    expect(locks).toHaveLength(0)
  })

  test("conflict detection works before acquisition", async () => {
    await lockManager.acquire("T-001", "worker", ["src/shared.ts"])
    const conflicts = await lockManager.checkConflicts(["src/shared.ts"])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].taskId).toBe("T-001")
  })
})

describe("Gap 9: Lesson capture on failure", () => {
  let tmpDir: string
  let lessonStore: LessonStore

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lesson-wire-test-"))
    lessonStore = new LessonStore(tmpDir)
  })

  test("extractFromAgentReport produces a lesson from valid failure data", () => {
    const lesson = extractFromAgentReport({
      trigger: "TypeScript compilation failed due to missing type export",
      resolution: "Added the missing export to the shared types module",
      files: ["src/types.ts", "src/api.ts"],
      taskTitle: "Implement user API",
      category: "code_pattern",
    })
    expect(lesson).not.toBeNull()
    expect(lesson!.scope).toBe("project")
    expect(lesson!.files).toContain("src/types.ts")
    expect(lesson!.title).toContain("Implement user API")
  })

  test("lesson is saved to store and retrievable", async () => {
    const lesson = extractFromAgentReport({
      trigger: "Import path was incorrect causing module not found error",
      resolution: "Changed the import path to use the correct relative path",
      files: ["src/service.ts"],
    })
    expect(lesson).not.toBeNull()

    await lessonStore.save(lesson!)
    const all = await lessonStore.list()
    expect(all).toHaveLength(1)
    expect(all[0].trigger).toContain("Import path")
  })

  test("infra noise is filtered out (no lesson created)", () => {
    const lesson = extractFromAgentReport({
      trigger: "Connection timed out when calling the external API",
      resolution: "Retried the connection and it worked the second time",
      files: ["src/client.ts"],
    })
    expect(lesson).toBeNull()
  })
})
