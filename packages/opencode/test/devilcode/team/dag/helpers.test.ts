import { describe, it, expect } from "bun:test"
import { getNextStage, getEntryStage, generateDefaultDAG } from "@/devilcode/team/dag/helpers"
import type { WorkflowDAG } from "@/devilcode/team/dag/schema"

function dag(stages: string[], edges: { from: string; to: string }[]): WorkflowDAG {
  return { stages: stages as WorkflowDAG["stages"], edges: edges as WorkflowDAG["edges"] }
}

describe("getNextStage", () => {
  it("returns the next stage along the first matching outgoing edge", () => {
    const d = dag(["plan", "build", "ship"], [{ from: "plan", to: "build" }, { from: "build", to: "ship" }])
    expect(getNextStage("plan", d)).toBe("build")
    expect(getNextStage("build", d)).toBe("ship")
  })

  it("returns null for terminal stage (no outgoing edge)", () => {
    const d = dag(["plan", "build", "ship"], [{ from: "plan", to: "build" }, { from: "build", to: "ship" }])
    expect(getNextStage("ship", d)).toBeNull()
  })

  it("returns null for a stage with no outgoing edges in a single-node dag", () => {
    const d = dag(["plan"], [])
    expect(getNextStage("plan", d)).toBeNull()
  })

  it("returns the first edge match when multiple outgoing edges exist (non-branching use)", () => {
    const d = dag(
      ["plan", "build", "review"],
      [{ from: "plan", to: "build" }, { from: "plan", to: "review" }],
    )
    // getNextStage returns first match — deterministic based on edge order
    expect(getNextStage("plan", d)).toBe("build")
  })
})

describe("getEntryStage", () => {
  it("returns the single in-degree-0 node", () => {
    const d = dag(["plan", "build", "ship"], [{ from: "plan", to: "build" }, { from: "build", to: "ship" }])
    expect(getEntryStage(d)).toBe("plan")
  })

  it("returns null when there are multiple entries", () => {
    // plan and build both have in-degree 0
    const d = dag(["plan", "build", "ship"], [{ from: "plan", to: "ship" }, { from: "build", to: "ship" }])
    expect(getEntryStage(d)).toBeNull()
  })

  it("returns null when all nodes have incoming edges (cycle, no entry)", () => {
    const d = dag(["plan", "build"], [{ from: "plan", to: "build" }, { from: "build", to: "plan" }])
    expect(getEntryStage(d)).toBeNull()
  })

  it("handles self-loops without counting them as incoming edges", () => {
    const d = dag(["plan", "build"], [{ from: "plan", to: "plan" }, { from: "plan", to: "build" }])
    // plan has a self-loop but self-loops don't affect in-degree
    expect(getEntryStage(d)).toBe("plan")
  })
})

describe("generateDefaultDAG", () => {
  it("produces 7 stages in correct order", () => {
    const d = generateDefaultDAG()
    expect(d.stages).toEqual(["plan", "challenge", "contract", "build", "review", "ship", "retro"])
  })

  it("produces 6 edges connecting all consecutive stages", () => {
    const d = generateDefaultDAG()
    expect(d.edges).toHaveLength(6)
  })

  it("edges form a valid linear chain", () => {
    const d = generateDefaultDAG()
    const expectedEdges = [
      { from: "plan", to: "challenge" },
      { from: "challenge", to: "contract" },
      { from: "contract", to: "build" },
      { from: "build", to: "review" },
      { from: "review", to: "ship" },
      { from: "ship", to: "retro" },
    ]
    for (const expected of expectedEdges) {
      expect(d.edges.some((e) => e.from === expected.from && e.to === expected.to)).toBe(true)
    }
  })

  it("getNextStage traversal from entry reaches retro", () => {
    const d = generateDefaultDAG()
    const traversal: string[] = []
    let current: string | null = "plan"
    while (current !== null) {
      traversal.push(current)
      current = getNextStage(current as WorkflowDAG["stages"][number], d)
    }
    expect(traversal).toEqual(["plan", "challenge", "contract", "build", "review", "ship", "retro"])
  })
})
