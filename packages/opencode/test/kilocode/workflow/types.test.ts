import { describe, expect, test } from "bun:test"
import {
  WorkflowStage,
  PlanTask,
  PlanChallenge,
  ReviewFinding,
  ReviewVerdict,
  WorkflowState,
} from "@/devilcode/workflow/types"

describe("WorkflowStage", () => {
  test("accepts all valid stages", () => {
    for (const stage of ["plan", "challenge", "build", "review", "ship", "retro"]) {
      expect(WorkflowStage.parse(stage)).toBe(stage)
    }
  })
  test("rejects invalid stage", () => {
    expect(() => WorkflowStage.parse("deploy")).toThrow()
  })
})

describe("PlanTask", () => {
  test("parses a valid plan task", () => {
    const result = PlanTask.parse({
      id: "01-02",
      title: "Implement JWT validation",
      role: "senior",
      wave: 1,
      dependsOn: [],
      estimatedComplexity: "high",
      files: ["src/auth/jwt.ts"],
      verification: ["bun test test/auth/jwt.test.ts"],
      description: "Implement JWT token validation middleware",
    })
    expect(result.id).toBe("01-02")
    expect(result.wave).toBe(1)
    expect(result.role).toBe("senior")
  })
  test("applies defaults for optional fields", () => {
    const result = PlanTask.parse({
      id: "01-01",
      title: "Task",
      role: "worker",
      wave: 1,
      description: "Do something",
    })
    expect(result.dependsOn).toEqual([])
    expect(result.files).toEqual([])
    expect(result.verification).toEqual([])
    expect(result.estimatedComplexity).toBe("medium")
  })
})

describe("PlanChallenge", () => {
  test("parses an approved challenge", () => {
    const result = PlanChallenge.parse({
      planId: "01",
      verdict: "approved",
      concerns: [],
      summary: "Plan looks solid",
    })
    expect(result.verdict).toBe("approved")
  })
  test("parses a challenge with concerns", () => {
    const result = PlanChallenge.parse({
      planId: "01",
      verdict: "revise",
      concerns: [{
        severity: "critical",
        category: "file-conflict",
        description: "Tasks 01-02 and 01-03 both modify auth.ts in wave 1",
        suggestedChange: "Move 01-03 to wave 2",
        affectedTasks: ["01-02", "01-03"],
      }],
      alternativeApproach: "Consider using existing auth middleware",
      summary: "File conflict in wave 1",
    })
    expect(result.concerns.length).toBe(1)
    expect(result.concerns[0].severity).toBe("critical")
    expect(result.alternativeApproach).toBeDefined()
  })
  test("validates concern categories", () => {
    expect(() => PlanChallenge.parse({
      planId: "01",
      verdict: "revise",
      concerns: [{
        severity: "critical",
        category: "invalid-category",
        description: "x",
        suggestedChange: "y",
        affectedTasks: [],
      }],
      summary: "x",
    })).toThrow()
  })
})

describe("ReviewFinding", () => {
  test("parses a valid finding", () => {
    const result = ReviewFinding.parse({
      id: "R-01",
      severity: "blocker",
      category: "security",
      file: "src/auth/jwt.ts",
      line: 14,
      description: "JWT secret hardcoded",
      suggestedFix: "Move to env var",
      suggestedRole: "senior",
      verificationCommand: "grep -r hardcoded src/auth/",
    })
    expect(result.severity).toBe("blocker")
    expect(result.category).toBe("security")
  })
})

describe("ReviewVerdict", () => {
  test("parses a pass verdict", () => {
    const result = ReviewVerdict.parse({
      verdict: "pass",
      cycle: 1,
      findings: [],
      blockerCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      summary: "All clear",
    })
    expect(result.verdict).toBe("pass")
  })
})

describe("WorkflowState", () => {
  test("parses a valid workflow state", () => {
    const result = WorkflowState.parse({
      project: "my-project",
      currentPhase: "01-auth",
      currentStage: "build",
      activeWave: 2,
      totalWaves: 3,
      activeTasks: [
        { id: "01-02", role: "senior", status: "in_progress" },
      ],
      lastUpdated: "2026-04-06T14:30:00Z",
    })
    expect(result.currentStage).toBe("build")
    expect(result.activeTasks.length).toBe(1)
  })
})
