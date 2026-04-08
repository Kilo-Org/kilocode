// packages/opencode/test/kilocode/e2e/workflow-state.e2e.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { WorkflowStateManager } from "@/devilcode/workflow/state"
import { Workflow } from "@/devilcode/workflow"
import { groupByWave, validateWaveIntegrity, detectFileConflicts } from "@/devilcode/workflow/executor"
import { triageFindings } from "@/devilcode/workflow/reviewer"
import { LockManager } from "@/devilcode/workflow/locks"
import { LessonStore, extractFromAgentReport, formatLessonsForPrompt } from "@/devilcode/workflow/learning"
import { EventLogger } from "@/devilcode/workflow/events"
import type { PlanTask } from "@/devilcode/workflow/types"

describe("e2e: workflow state round-trip", () => {
  let tmpDir: string
  let planningDir: string
  let manager: WorkflowStateManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-e2e-"))
    planningDir = path.join(tmpDir, ".planning")
    manager = new WorkflowStateManager(tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test("full lifecycle: init -> plan -> challenge -> contract -> build -> review -> ship -> retro", async () => {
    // 1. Initialize
    await manager.initialize("e2e-project")
    expect(await manager.hasWorkflow()).toBe(true)

    const initialState = await manager.readState()
    expect(initialState.project).toBe("e2e-project")
    expect(initialState.currentStage).toBe("plan")

    // 2. Create phase and write plans
    await manager.createPhase("01-auth")
    const task1: PlanTask = {
      id: "01-01",
      title: "Implement auth middleware",
      role: "senior",
      wave: 1,
      dependsOn: [],
      estimatedComplexity: "high",
      files: ["src/auth/middleware.ts", "src/auth/jwt.ts"],
      verification: ["bun test test/auth/"],
      description: "Implement JWT-based authentication middleware with token validation, refresh, and revocation.",
    }
    const task2: PlanTask = {
      id: "01-02",
      title: "Add login endpoint",
      role: "worker",
      wave: 1,
      dependsOn: [],
      estimatedComplexity: "medium",
      files: ["src/routes/login.ts"],
      verification: ["bun test test/routes/login.test.ts"],
      description: "Create POST /login endpoint with email/password validation and JWT issuance.",
    }
    const task3: PlanTask = {
      id: "01-03",
      title: "Add protected route guard",
      role: "worker",
      wave: 2,
      dependsOn: ["01-01"],
      estimatedComplexity: "low",
      files: ["src/routes/guard.ts"],
      verification: ["bun test test/routes/guard.test.ts"],
      description: "Wrap protected routes with the auth middleware from task 01-01.",
    }

    await manager.writePlan("01-auth", task1)
    await manager.writePlan("01-auth", task2)
    await manager.writePlan("01-auth", task3)

    // Verify plans round-trip correctly
    const plans = await manager.readAllPlans("01-auth")
    expect(plans.length).toBe(3)
    expect(plans[0].id).toBe("01-01")
    expect(plans[0].description).toContain("JWT-based authentication")

    // Verify wave grouping
    const waves = groupByWave(plans)
    expect(waves.size).toBe(2)
    expect(waves.get(1)!.length).toBe(2)
    expect(waves.get(2)!.length).toBe(1)

    // Verify wave integrity
    const integrityErrors = validateWaveIntegrity(plans)
    expect(integrityErrors).toEqual([])

    // Verify no file conflicts within a wave
    const conflicts = detectFileConflicts(plans)
    expect(conflicts).toEqual([])

    // 3. Set current phase before advancing stages
    await manager.writeState({
      ...initialState,
      currentPhase: "01-auth",
      currentStage: "plan",
      lastUpdated: new Date().toISOString(),
    })

    // plan -> challenge
    const afterChallenge = await Workflow.advanceStage(manager, "challenge")
    expect(afterChallenge.currentStage).toBe("challenge")

    // challenge -> contract
    const afterContract = await Workflow.advanceStage(manager, "contract")
    expect(afterContract.currentStage).toBe("contract")

    // contract -> build
    const afterBuild = await Workflow.advanceStage(manager, "build")
    expect(afterBuild.currentStage).toBe("build")

    // build -> review
    const afterReview = await Workflow.advanceStage(manager, "review")
    expect(afterReview.currentStage).toBe("review")

    // 4. Write and read review
    await manager.writeReview("01-auth", {
      verdict: "pass",
      cycle: 1,
      findings: [
        {
          id: "R-01",
          severity: "suggestion",
          category: "style",
          file: "src/auth/middleware.ts",
          line: 42,
          description: "Consider extracting magic number to constant",
          suggestedFix: "const TOKEN_EXPIRY_MS = 3600000",
        },
      ],
      blockerCount: 0,
      warningCount: 0,
      suggestionCount: 1,
      summary: "Clean implementation with one style suggestion.",
    })
    const review = await manager.readReview("01-auth")
    expect(review.verdict).toBe("pass")
    expect(review.findings.length).toBe(1)
    expect(review.findings[0].severity).toBe("suggestion")

    // Triage findings
    const { blockers, warnings, suggestions } = triageFindings(review.findings)
    expect(blockers.length).toBe(0)
    expect(warnings.length).toBe(0)
    expect(suggestions.length).toBe(1)

    // review -> ship
    const afterShip = await Workflow.advanceStage(manager, "ship")
    expect(afterShip.currentStage).toBe("ship")

    // ship -> retro
    const afterRetro = await Workflow.advanceStage(manager, "retro")
    expect(afterRetro.currentStage).toBe("retro")

    // retro -> plan (new cycle)
    const afterNewPlan = await Workflow.advanceStage(manager, "plan")
    expect(afterNewPlan.currentStage).toBe("plan")
  })

  test("invalid stage transition throws", async () => {
    await manager.initialize("e2e-project")
    await manager.writeState({
      project: "e2e-project",
      currentPhase: "01-auth",
      currentStage: "plan",
      activeTasks: [],
      lastUpdated: new Date().toISOString(),
    })

    // plan -> build should fail (must go plan -> challenge first)
    expect(Workflow.advanceStage(manager, "build")).rejects.toThrow()
  })

  test("lock manager round-trip with conflict detection", async () => {
    await fs.mkdir(planningDir, { recursive: true })
    const locks = new LockManager(planningDir)

    // Acquire locks
    await locks.acquire("01-01", "senior", ["src/auth/middleware.ts", "src/auth/jwt.ts"])
    await locks.acquire("01-02", "worker", ["src/routes/login.ts"])

    // List all locks
    const allLocks = await locks.listLocks()
    expect(allLocks.length).toBe(2)

    // Check conflicts — file owned by 01-01 lock
    const conflicting = await locks.checkConflicts(["src/auth/jwt.ts"])
    expect(conflicting.length).toBe(1)
    expect(conflicting[0].taskId).toBe("01-01")

    // No conflict on unrelated file
    const noConflict = await locks.checkConflicts(["src/unrelated.ts"])
    expect(noConflict.length).toBe(0)

    // Release one lock and verify
    await locks.release("01-01")
    const afterRelease = await locks.listLocks()
    expect(afterRelease.length).toBe(1)
    expect(afterRelease[0].taskId).toBe("01-02")

    // Release all locks
    await locks.releaseAll()
    expect((await locks.listLocks()).length).toBe(0)
  })

  test("lesson store round-trip with search and hit counting", async () => {
    await fs.mkdir(planningDir, { recursive: true })
    const store = new LessonStore(planningDir)

    // Extract lesson from agent report
    const lesson = extractFromAgentReport({
      trigger: "TypeError: Cannot read property 'id' of undefined when user has no sessions",
      resolution: "Added null check before accessing session.id — used optional chaining",
      files: ["src/session/handler.ts"],
      taskTitle: "Fix session handler crash",
      category: "code_pattern",
    })
    expect(lesson).not.toBeNull()

    // Save and list
    await store.save(lesson!)
    const lessons = await store.list()
    expect(lessons.length).toBe(1)
    expect(lessons[0].trigger).toContain("Cannot read property")

    // Search — should find by trigger text
    const found = await store.search("TypeError")
    expect(found.length).toBe(1)

    // Search — should find nothing for unrelated query
    const notFound = await store.search("completely unrelated query xyz")
    expect(notFound.length).toBe(0)

    // Hit counting — increment and verify confidence increased
    await store.incrementHit(lesson!.id)
    const updated = await store.list()
    expect(updated[0].hitCount).toBe(2)
    expect(updated[0].confidence).toBeGreaterThan(0.5)

    // Format for prompt — should produce structured markdown
    const prompt = formatLessonsForPrompt(updated)
    expect(prompt).toContain("Lessons Learned")
    expect(prompt).toContain("code_pattern")
  })

  test("event logger round-trip with append and recent reads", async () => {
    await fs.mkdir(planningDir, { recursive: true })
    const events = new EventLogger(planningDir)

    // Log events
    await events.log({ eventType: "plan_created", message: "Phase 01-auth planned" })
    await events.log({ eventType: "task_started", taskId: "01-01", role: "senior", message: "Task started" })
    await events.log({ eventType: "task_completed", taskId: "01-01", role: "senior", message: "Task done", durationMs: 5000 })
    await events.log({ eventType: "quality_gate_passed", message: "TypeCheck: PASS", durationMs: 1200 })

    // Read all events
    const all = await events.readAll()
    expect(all.length).toBe(4)
    expect(all[0].eventType).toBe("plan_created")
    expect(all[2].durationMs).toBe(5000)

    // Read recent N events
    const recent = await events.readRecent(2)
    expect(recent.length).toBe(2)
    expect(recent[0].eventType).toBe("task_completed")
    expect(recent[1].eventType).toBe("quality_gate_passed")

    // Verify JSONL format on disk — each line must be valid JSON
    const raw = await fs.readFile(path.join(planningDir, "events.jsonl"), "utf-8")
    const lines = raw.split("\n").filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(4)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  test("prompt section includes workflow context", async () => {
    await manager.initialize("e2e-project")
    await manager.writeState({
      project: "e2e-project",
      currentPhase: "01-auth",
      currentStage: "build",
      activeWave: 1,
      totalWaves: 3,
      activeTasks: [
        { id: "01-01", role: "senior", status: "in_progress" },
        { id: "01-02", role: "worker", status: "pending" },
      ],
      lastUpdated: new Date().toISOString(),
    })

    const section = await manager.toPromptSection()
    expect(section).toBeDefined()
    expect(section).toContain("<workflow_context>")
    expect(section).toContain("e2e-project")
    expect(section).toContain("01-auth")
    expect(section).toContain("build")
    expect(section).toContain("Wave: 1/3")
    expect(section).toContain("01-01")
    expect(section).toContain("in_progress")
    expect(section).toContain("</workflow_context>")
  })
})
