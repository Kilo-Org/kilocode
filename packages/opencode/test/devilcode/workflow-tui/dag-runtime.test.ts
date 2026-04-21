// packages/opencode/test/devilcode/workflow-tui/dag-runtime.test.ts
// Phase 7 — Structural tests for DAG-driven runtime dispatch
// Tests DAG helpers directly; does NOT instantiate WorkflowOrchestrator (complex deps)
import { describe, it, expect } from "bun:test"
import { getNextStage, generateDefaultDAG } from "@/devilcode/team/dag"
import type { WorkflowDAG } from "@/devilcode/team/dag"
import { Workflow } from "@/devilcode/workflow"

describe("DAG-driven runtime stage ordering", () => {
  describe("default 7-stage linear DAG", () => {
    const dag = generateDefaultDAG()

    it("plan → challenge", () => {
      expect(getNextStage("plan", dag)).toBe("challenge")
    })

    it("challenge → contract", () => {
      expect(getNextStage("challenge", dag)).toBe("contract")
    })

    it("contract → build", () => {
      expect(getNextStage("contract", dag)).toBe("build")
    })

    it("build → review", () => {
      expect(getNextStage("build", dag)).toBe("review")
    })

    it("review → ship", () => {
      expect(getNextStage("review", dag)).toBe("ship")
    })

    it("ship → retro", () => {
      expect(getNextStage("ship", dag)).toBe("retro")
    })

    it("retro → null (terminal stage)", () => {
      expect(getNextStage("retro", dag)).toBe(null)
    })
  })

  describe("skip-challenge DAG: plan→contract→build→review→ship→retro", () => {
    const skipChallengeDAG: WorkflowDAG = {
      stages: ["plan", "contract", "build", "review", "ship", "retro"],
      edges: [
        { from: "plan", to: "contract" },
        { from: "contract", to: "build" },
        { from: "build", to: "review" },
        { from: "review", to: "ship" },
        { from: "ship", to: "retro" },
      ],
    }

    it("plan → contract (challenge skipped)", () => {
      expect(getNextStage("plan", skipChallengeDAG)).toBe("contract")
    })

    it("contract → build", () => {
      expect(getNextStage("contract", skipChallengeDAG)).toBe("build")
    })

    it("build → review", () => {
      expect(getNextStage("build", skipChallengeDAG)).toBe("review")
    })

    it("review → ship", () => {
      expect(getNextStage("review", skipChallengeDAG)).toBe("ship")
    })

    it("ship → retro", () => {
      expect(getNextStage("ship", skipChallengeDAG)).toBe("retro")
    })

    it("retro → null (terminal)", () => {
      expect(getNextStage("retro", skipChallengeDAG)).toBe(null)
    })
  })

  describe("minimal 3-stage DAG: plan→build→ship", () => {
    const minimalDAG: WorkflowDAG = {
      stages: ["plan", "build", "ship"],
      edges: [
        { from: "plan", to: "build" },
        { from: "build", to: "ship" },
      ],
    }

    it("plan → build", () => {
      expect(getNextStage("plan", minimalDAG)).toBe("build")
    })

    it("build → ship", () => {
      expect(getNextStage("build", minimalDAG)).toBe("ship")
    })

    it("ship → null (terminal)", () => {
      expect(getNextStage("ship", minimalDAG)).toBe(null)
    })
  })
})

// devilcode_change start — Phase 7 fix F2: runtime integration tests for Workflow.nextStage()
describe("Workflow.nextStage() — runtime integration", () => {
  it("default DAG: plan → challenge", () => {
    expect(Workflow.nextStage("plan")).toBe("challenge")
  })

  it("default DAG: retro → plan (cyclic, critical regression test)", () => {
    // Before Phase 7 fix: nextStage("retro") threw. Must return "plan".
    expect(Workflow.nextStage("retro")).toBe("plan")
  })

  it("custom skip-challenge DAG: plan → contract", () => {
    const skipChallenge: WorkflowDAG = {
      stages: ["plan", "contract", "build", "review", "ship", "retro"],
      edges: [
        { from: "plan", to: "contract" },
        { from: "contract", to: "build" },
        { from: "build", to: "review" },
        { from: "review", to: "ship" },
        { from: "ship", to: "retro" },
      ],
    }
    expect(Workflow.nextStage("plan", skipChallenge)).toBe("contract")
  })

  it("custom DAG: throws when stage is terminal (no outgoing edge)", () => {
    const minimalDAG: WorkflowDAG = {
      stages: ["plan", "ship"],
      edges: [{ from: "plan", to: "ship" }],
    }
    expect(() => Workflow.nextStage("ship", minimalDAG)).toThrow()
  })
})
// devilcode_change end
