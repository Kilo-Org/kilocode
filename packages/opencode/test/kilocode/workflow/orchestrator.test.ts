import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { WorkflowStateManager } from "@/devilcode/workflow/state"
import { WorkflowOrchestrator } from "@/devilcode/workflow-tui/orchestrator"

describe("WorkflowOrchestrator ship and retro", () => {
  let tmpDir: string
  let manager: WorkflowStateManager
  let orchestrator: WorkflowOrchestrator

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-orch-"))
    manager = new WorkflowStateManager(tmpDir)
    orchestrator = new WorkflowOrchestrator(tmpDir)
    await manager.initialize("test-project")
    await manager.createPhase("01-auth")
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test("executeShip writes a persisted readiness report and updates the roadmap", async () => {
    await manager.writeState({
      project: "test-project",
      currentPhase: "01-auth",
      currentStage: "review",
      activeTasks: [
        { id: "01-01", role: "senior", status: "completed" },
        { id: "01-02", role: "worker", status: "completed" },
      ],
      lastUpdated: new Date().toISOString(),
    })
    await manager.writeReview("01-auth", {
      verdict: "pass",
      cycle: 1,
      findings: [],
      blockerCount: 0,
      warningCount: 1,
      suggestionCount: 1,
      summary: "Ready to ship.",
    })

    const report = await orchestrator.executeShip()
    const saved = await manager.readShip("01-auth")
    const roadmap = await fs.readFile(path.join(tmpDir, ".planning", "ROADMAP.md"), "utf-8")

    expect(report.status).toBe("ready")
    expect(saved.summary).toContain("Ship ready")
    expect(roadmap).toContain("- [x] 01-auth")
  })

  test("executeRetro writes a persisted retrospective report", async () => {
    await manager.writeState({
      project: "test-project",
      currentPhase: "01-auth",
      currentStage: "ship",
      activeTasks: [
        { id: "01-01", role: "senior", status: "completed" },
        { id: "01-02", role: "worker", status: "failed" },
        { id: "01-03", role: "worker", status: "blocked" },
      ],
      lastUpdated: new Date().toISOString(),
    })
    await manager.writeReview("01-auth", {
      verdict: "pass",
      cycle: 1,
      findings: [
        {
          id: "R-01",
          severity: "suggestion",
          category: "style",
          file: "src/auth.ts",
          description: "Extract a constant for token expiry.",
        },
      ],
      blockerCount: 0,
      warningCount: 0,
      suggestionCount: 1,
      summary: "Ready to ship.",
    })
    await manager.writeShip("01-auth", {
      phase: "01-auth",
      status: "ready",
      gates: [],
      warnings: ["1 review suggestion remains."],
      summary: "Ship ready for 01-auth.",
      createdAt: new Date().toISOString(),
    })

    const report = await orchestrator.executeRetro()
    const saved = await manager.readRetro("01-auth")

    expect(report.completed).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.blocked).toBe(1)
    expect(saved.followUps[0]).toContain("R-01")
  })
})
