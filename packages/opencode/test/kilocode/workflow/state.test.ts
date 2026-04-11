import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { WorkflowStateManager } from "@/devilcode/workflow/state"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("WorkflowStateManager", () => {
  let tmpDir: string
  let manager: WorkflowStateManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-test-"))
    manager = new WorkflowStateManager(tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test("initializes .planning/ directory structure", async () => {
    await manager.initialize("test-project")
    const exists = await fs
      .stat(path.join(tmpDir, ".planning"))
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
    const stateExists = await fs
      .stat(path.join(tmpDir, ".planning", "STATE.md"))
      .then(() => true)
      .catch(() => false)
    expect(stateExists).toBe(true)
  })

  test("reads STATE.md frontmatter", async () => {
    await manager.initialize("test-project")
    const state = await manager.readState()
    expect(state.project).toBe("test-project")
    expect(state.currentStage).toBe("plan")
  })

  test("writes and reads back state", async () => {
    await manager.initialize("test-project")
    await manager.writeState({
      project: "test-project",
      currentPhase: "01-auth",
      currentStage: "build",
      activeWave: 2,
      totalWaves: 3,
      activeTasks: [{ id: "01-02", role: "senior", status: "in_progress" }],
      lastUpdated: new Date().toISOString(),
    })
    const state = await manager.readState()
    expect(state.currentStage).toBe("build")
    expect(state.activeWave).toBe(2)
    expect(state.activeTasks.length).toBe(1)
  })

  test("creates phase directory", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth-system")
    const phaseDir = path.join(tmpDir, ".planning", "phases", "01-auth-system")
    const exists = await fs
      .stat(phaseDir)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  test("ensurePhase assigns the first numbered phase and updates state", async () => {
    await manager.initialize("test-project")
    const phase = await manager.ensurePhase("Auth & Login System")
    const state = await manager.readState()
    expect(phase).toBe("01-auth-login-system")
    expect(state.currentPhase).toBe("01-auth-login-system")
  })

  test("writes and reads phase context", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
    await manager.writePhaseContext("01-auth", "Implement authentication and session handling")
    const ctx = await manager.readPhaseContext("01-auth")
    expect(ctx).toContain("Implement authentication and session handling")
    expect(ctx).toContain("## Requirements")
  })

  test("writes and reads plan file with frontmatter", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
    await manager.writePlan("01-auth", {
      id: "01-01",
      title: "Implement JWT",
      role: "senior",
      wave: 1,
      dependsOn: [],
      estimatedComplexity: "high",
      files: ["src/auth/jwt.ts"],
      verification: ["bun test"],
      description: "Implement JWT token validation middleware.\n\nHandle expiry and refresh.",
    })
    const plan = await manager.readPlan("01-auth", "01-01")
    expect(plan.id).toBe("01-01")
    expect(plan.role).toBe("senior")
    expect(plan.wave).toBe(1)
    expect(plan.description).toContain("JWT token validation")
  })

  test("reads all plans for a phase", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
    await manager.writePlan("01-auth", {
      id: "01-01",
      title: "Task A",
      role: "worker",
      wave: 1,
      dependsOn: [],
      estimatedComplexity: "low" as const,
      files: [],
      verification: [],
      description: "First task",
    })
    await manager.writePlan("01-auth", {
      id: "01-02",
      title: "Task B",
      role: "senior",
      wave: 1,
      dependsOn: [],
      estimatedComplexity: "medium" as const,
      files: [],
      verification: [],
      description: "Second task",
    })
    const plans = await manager.readAllPlans("01-auth")
    expect(plans.length).toBe(2)
  })

  test("writes and reads review file", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
    await manager.writeReview("01-auth", {
      verdict: "pass",
      cycle: 1,
      findings: [],
      blockerCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      summary: "All clear",
    })
    const review = await manager.readReview("01-auth")
    expect(review.verdict).toBe("pass")
  })

  test("writes and reads challenge file", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
    await manager.writeChallenge("01-auth", {
      planId: "01-auth",
      verdict: "approved",
      concerns: [],
      summary: "Plan is ready to build",
    })
    const challenge = await manager.readChallenge("01-auth")
    expect(challenge.verdict).toBe("approved")
    expect(challenge.summary).toContain("ready")
  })

  test("writes and reads ship and retro files", async () => {
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
    await manager.writeShip("01-auth", {
      phase: "01-auth",
      status: "ready",
      gates: [],
      warnings: ["1 review warning remains."],
      summary: "Ship ready for 01-auth.",
      createdAt: new Date().toISOString(),
    })
    await manager.writeRetro("01-auth", {
      phase: "01-auth",
      completed: 2,
      failed: 0,
      blocked: 0,
      lessons: ["Keep auth token parsing in one module."],
      followUps: ["R-01 style cleanup"],
      summary: "Retro captured for 01-auth.",
      createdAt: new Date().toISOString(),
    })

    const ship = await manager.readShip("01-auth")
    const retro = await manager.readRetro("01-auth")
    expect(ship.status).toBe("ready")
    expect(retro.lessons).toHaveLength(1)
  })

  test("hasWorkflow returns false for uninitialized directory", async () => {
    expect(await manager.hasWorkflow()).toBe(false)
  })

  test("hasWorkflow returns true after initialization", async () => {
    await manager.initialize("test-project")
    expect(await manager.hasWorkflow()).toBe(true)
  })

  test("toPromptSection returns formatted context", async () => {
    await manager.initialize("test-project")
    await manager.writeState({
      project: "test-project",
      currentPhase: "01-auth",
      currentStage: "build",
      activeWave: 1,
      totalWaves: 2,
      activeTasks: [],
      lastUpdated: new Date().toISOString(),
    })
    const section = await manager.toPromptSection()
    expect(section).toContain("01-auth")
    expect(section).toContain("build")
  })
})
