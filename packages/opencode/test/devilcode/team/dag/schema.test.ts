import { describe, it, expect } from "bun:test"
import { WorkflowDAG, WorkflowDAGEdge, DAGOverride } from "@/devilcode/team/dag/schema"

describe("WorkflowDAGEdge", () => {
  it("parses a valid edge", () => {
    const result = WorkflowDAGEdge.safeParse({ from: "plan", to: "build" })
    expect(result.success).toBe(true)
  })

  it("parses edge with optional condition", () => {
    const result = WorkflowDAGEdge.safeParse({ from: "plan", to: "build", condition: "if-approved" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.condition).toBe("if-approved")
  })

  it("rejects invalid stage value in from", () => {
    const result = WorkflowDAGEdge.safeParse({ from: "nonexistent", to: "build" })
    expect(result.success).toBe(false)
  })

  it("rejects invalid stage value in to", () => {
    const result = WorkflowDAGEdge.safeParse({ from: "plan", to: "nonexistent" })
    expect(result.success).toBe(false)
  })
})

describe("WorkflowDAG", () => {
  it("parses a minimal valid DAG", () => {
    const result = WorkflowDAG.safeParse({
      stages: ["plan", "build"],
      edges: [{ from: "plan", to: "build" }],
    })
    expect(result.success).toBe(true)
  })

  it("defaults edges to empty array when omitted", () => {
    const result = WorkflowDAG.safeParse({ stages: ["plan", "build"] })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.edges).toEqual([])
  })

  it("rejects empty stages array (nonempty constraint)", () => {
    const result = WorkflowDAG.safeParse({ stages: [] })
    expect(result.success).toBe(false)
  })

  it("parses the full 7-stage default shape", () => {
    const result = WorkflowDAG.safeParse({
      stages: ["plan", "challenge", "contract", "build", "review", "ship", "retro"],
      edges: [
        { from: "plan", to: "challenge" },
        { from: "challenge", to: "contract" },
        { from: "contract", to: "build" },
        { from: "build", to: "review" },
        { from: "review", to: "ship" },
        { from: "ship", to: "retro" },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.stages).toHaveLength(7)
      expect(result.data.edges).toHaveLength(6)
    }
  })

  it("rejects an invalid stage in the stages array", () => {
    const result = WorkflowDAG.safeParse({ stages: ["plan", "unknown-stage"], edges: [] })
    expect(result.success).toBe(false)
  })
})

describe("DAGOverride", () => {
  it("parses a DAGOverride with no capabilityOverrides", () => {
    const result = DAGOverride.safeParse({
      dag: {
        stages: ["plan", "build", "ship"],
        edges: [{ from: "plan", to: "build" }, { from: "build", to: "ship" }],
      },
    })
    expect(result.success).toBe(true)
  })

  it("parses a DAGOverride with valid capabilityOverrides", () => {
    const result = DAGOverride.safeParse({
      dag: {
        stages: ["plan", "build", "ship"],
        edges: [{ from: "plan", to: "build" }, { from: "build", to: "ship" }],
      },
      capabilityOverrides: {
        build: ["implementation", "review"],
      },
    })
    expect(result.success).toBe(true)
  })

  it("rejects capabilityOverrides with invalid stage key", () => {
    const result = DAGOverride.safeParse({
      dag: {
        stages: ["plan", "build", "ship"],
        edges: [{ from: "plan", to: "build" }, { from: "build", to: "ship" }],
      },
      capabilityOverrides: {
        "not-a-stage": ["implementation"],
      },
    })
    expect(result.success).toBe(false)
  })

  it("rejects capabilityOverrides with invalid capability value", () => {
    const result = DAGOverride.safeParse({
      dag: {
        stages: ["plan", "build"],
        edges: [{ from: "plan", to: "build" }],
      },
      capabilityOverrides: {
        build: ["not-a-capability"],
      },
    })
    expect(result.success).toBe(false)
  })
})
