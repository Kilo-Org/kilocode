import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Workflow } from "@/devilcode/workflow"
import { WorkflowStateManager } from "@/devilcode/workflow/state"

describe("Workflow action resolution", () => {
  test("maps approve and revise actions through the canonical transition table", () => {
    expect(Workflow.resolveAction("challenge", "approve")).toBe("contract")
    expect(Workflow.resolveAction("contract", "approve")).toBe("build")
    expect(Workflow.resolveAction("review", "approve")).toBe("ship")
    expect(Workflow.resolveAction("review", "revise")).toBe("build")
    expect(Workflow.resolveAction("build", "approve")).toBeUndefined()
  })
})

describe("Workflow stage rollover", () => {
  let tmpDir: string
  let manager: WorkflowStateManager

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-index-"))
    manager = new WorkflowStateManager(tmpDir)
    await manager.initialize("test-project")
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test("clears the current phase when rolling from retro back to plan", async () => {
    await manager.writeState({
      project: "test-project",
      currentPhase: "01-auth",
      currentStage: "retro",
      activeWave: 2,
      totalWaves: 2,
      activeTasks: [{ id: "01-01", role: "worker", status: "completed" }],
      lastUpdated: new Date().toISOString(),
    })

    const next = await Workflow.advanceStage(manager, "plan")
    expect(next.currentPhase).toBe("")
    expect(next.activeWave).toBeUndefined()
    expect(next.activeTasks).toEqual([])
  })

  test("preserves build task state when advancing from review to ship", async () => {
    await manager.writeState({
      project: "test-project",
      currentPhase: "01-auth",
      currentStage: "review",
      activeWave: 2,
      totalWaves: 2,
      activeTasks: [{ id: "01-01", role: "worker", status: "completed" }],
      lastUpdated: new Date().toISOString(),
    })

    const next = await Workflow.advanceStage(manager, "ship")
    expect(next.activeWave).toBe(2)
    expect(next.activeTasks).toEqual([{ id: "01-01", role: "worker", status: "completed" }])
  })
})
