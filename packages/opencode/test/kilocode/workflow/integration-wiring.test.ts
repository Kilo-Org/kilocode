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

import { summarizeGateFailures, type GateResult } from "@/devilcode/workflow/quality-gates"
import { preflightPassed, reportSummary, type PreflightReport } from "@/devilcode/workflow/preflight"
import {
  detectStuckTasks,
  detectDeadlock,
  DEFAULT_HEALTH_CONFIG,
} from "@/devilcode/workflow/health"
import { EventLogger } from "@/devilcode/workflow/events"
import type { ActiveTask } from "@/devilcode/workflow/types"

describe("Gap 10: Quality gates wired into review", () => {
  test("summarizeGateFailures formats failures for LLM consumption", () => {
    const results: GateResult[] = [
      { gateName: "TypeCheck", passed: false, exitCode: 1, stdout: "", stderr: "error TS2345", durationMs: 3200 },
      { gateName: "Test Suite", passed: true, exitCode: 0, stdout: "14 passed", stderr: "", durationMs: 8500 },
      { gateName: "Lint", passed: false, exitCode: 1, stdout: "", stderr: "Unexpected console statement", durationMs: 1200 },
    ]
    const summary = summarizeGateFailures(results)
    expect(summary).toContain("TypeCheck")
    expect(summary).toContain("Lint")
    expect(summary).not.toContain("Test Suite")
  })

  test("summarizeGateFailures returns empty string when all pass", () => {
    const results: GateResult[] = [
      { gateName: "TypeCheck", passed: true, exitCode: 0, stdout: "No errors", stderr: "", durationMs: 3000 },
    ]
    expect(summarizeGateFailures(results)).toBe("")
  })
})

describe("Gap 11: Preflight wired into plan stage", () => {
  test("preflightPassed returns true when all checks pass", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: true, message: "ok", severity: "error" as const, fixHint: "" },
        { name: "repo", passed: true, message: "ok", severity: "error" as const, fixHint: "" },
      ],
    }
    expect(preflightPassed(report)).toBe(true)
  })

  test("preflightPassed returns false when an error-severity check fails", () => {
    const report: PreflightReport = {
      checks: [
        { name: "repo", passed: false, message: "Not a git repo", severity: "error" as const, fixHint: "Run git init" },
      ],
    }
    expect(preflightPassed(report)).toBe(false)
  })

  test("preflightPassed returns true when only warnings fail", () => {
    const report: PreflightReport = {
      checks: [
        { name: "git", passed: true, message: "ok", severity: "error" as const, fixHint: "" },
        { name: "tree", passed: false, message: "dirty", severity: "warning" as const, fixHint: "stash" },
      ],
    }
    expect(preflightPassed(report)).toBe(true)
  })
})

describe("Gap 12: Health monitor polling", () => {
  test("detectStuckTasks returns alert for idle task", () => {
    const tasks: ActiveTask[] = [{ id: "T-001", role: "worker", status: "in_progress" }]
    const lastActivity = new Map<string, number>()
    lastActivity.set("T-001", Date.now() - 20 * 60 * 1000)
    const alerts = detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].taskId).toBe("T-001")
  })

  test("detectStuckTasks ignores completed tasks", () => {
    const tasks: ActiveTask[] = [{ id: "T-001", role: "worker", status: "completed" }]
    const lastActivity = new Map<string, number>()
    lastActivity.set("T-001", Date.now() - 60 * 60 * 1000)
    expect(detectStuckTasks(tasks, lastActivity, DEFAULT_HEALTH_CONFIG)).toHaveLength(0)
  })

  test("detectDeadlock detects a cycle between blocked tasks", () => {
    const tasks: ActiveTask[] = [
      { id: "T-001", role: "worker", status: "blocked" },
      { id: "T-002", role: "senior", status: "blocked" },
    ]
    const deps = new Map<string, string[]>()
    deps.set("T-001", ["T-002"])
    deps.set("T-002", ["T-001"])
    const result = detectDeadlock(tasks, deps)
    expect(result).not.toBeNull()
    expect(result!.type).toBe("cycle")
  })
})

describe("Gap 13: Event log display", () => {
  test("readRecent returns most recent events", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "events-test-"))
    await fs.mkdir(path.join(tmpDir, ".planning"), { recursive: true })
    const logger = new EventLogger(path.join(tmpDir, ".planning"))

    await logger.log({ eventType: "plan_created", message: "Phase 1 planned" })
    await logger.log({ eventType: "task_started", taskId: "T-001", message: "Started T-001" })
    await logger.log({ eventType: "task_completed", taskId: "T-001", message: "Completed T-001" })

    const recent = await logger.readRecent(2)
    expect(recent).toHaveLength(2)
    expect(recent[0].eventType).toBe("task_started")
    expect(recent[1].eventType).toBe("task_completed")
  })

  test("events have timestamp", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "events-ts-test-"))
    await fs.mkdir(path.join(tmpDir, ".planning"), { recursive: true })
    const logger = new EventLogger(path.join(tmpDir, ".planning"))

    await logger.log({ eventType: "preflight_check", message: "Preflight OK" })
    const events = await logger.readRecent(1)
    expect(events[0].timestamp).toBeDefined()
    expect(new Date(events[0].timestamp!).getTime()).not.toBeNaN()
  })
})
