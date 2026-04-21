import { describe, it, expect } from "bun:test"
import { validateDAG, formatDAGError } from "@/devilcode/team/dag/validator"
import type { DAGError } from "@/devilcode/team/dag/validator"
import type { WorkflowDAG } from "@/devilcode/team/dag/schema"
import type { CanonicalCapability } from "@/devilcode/team/capabilities"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Full capability set — covers all 7 stages */
function allCaps(): Map<CanonicalCapability, boolean> {
  return new Map<CanonicalCapability, boolean>([
    ["planning", true],
    ["design", true],
    ["implementation", true],
    ["review", true],
    ["release", true],
    ["testing", true],
    ["research", true],
    ["retrospective", true],
  ])
}

function caps(...capabilities: CanonicalCapability[]): Map<CanonicalCapability, boolean> {
  return new Map(capabilities.map((c) => [c, true] as [CanonicalCapability, boolean]))
}

function dag(stages: string[], edges: { from: string; to: string }[]): WorkflowDAG {
  return { stages: stages as WorkflowDAG["stages"], edges: edges as WorkflowDAG["edges"] }
}

// ---------------------------------------------------------------------------
// Self-loop detection
// ---------------------------------------------------------------------------

describe("validateDAG — self-loop", () => {
  it("detects a self-loop edge", () => {
    const d = dag(["plan", "build"], [{ from: "plan", to: "plan" }, { from: "plan", to: "build" }])
    const errors = validateDAG(d, allCaps())
    const selfLoop = errors.find((e) => e.kind === "self-loop") as Extract<DAGError, { kind: "self-loop" }>
    expect(selfLoop).toBeDefined()
    expect(selfLoop.stage).toBe("plan")
  })

  it("reports no self-loop for normal edges", () => {
    const d = dag(["plan", "build"], [{ from: "plan", to: "build" }])
    const errors = validateDAG(d, allCaps())
    expect(errors.filter((e) => e.kind === "self-loop")).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Unknown stage detection
// ---------------------------------------------------------------------------

describe("validateDAG — unknown-stage", () => {
  it("detects edge referencing a stage not in dag.stages", () => {
    const d: WorkflowDAG = {
      stages: ["plan"] as unknown as WorkflowDAG["stages"],
      edges: [{ from: "plan", to: "build" }],
    }
    const errors = validateDAG(d, allCaps())
    const unknown = errors.find((e) => e.kind === "unknown-stage") as Extract<DAGError, { kind: "unknown-stage" }>
    expect(unknown).toBeDefined()
    expect(unknown.stage).toBe("build")
  })
})

// ---------------------------------------------------------------------------
// Entry stage validation
// ---------------------------------------------------------------------------

describe("validateDAG — entry detection", () => {
  it("rejects DAG with no entry (all stages have incoming edges — cycle)", () => {
    // A cycle: plan → build → plan — both nodes have in-degree 1 when cycle detected
    const d = dag(["plan", "build"], [{ from: "build", to: "plan" }, { from: "plan", to: "build" }])
    const errors = validateDAG(d, allCaps())
    // The cycle makes Kahn's not find an entry — we get no-entry + cycle
    const kinds = errors.map((e) => e.kind)
    expect(kinds).toContain("no-entry")
    // The cycle prevents Kahn's from running — no-entry fires and returns early
    // so "cycle" kind should NOT appear (early return after no-entry)
    expect(kinds).not.toContain("cycle")
  })

  // devilcode_change start — Phase 7 fix F6: duplicate stages — documents known limitation
  it("duplicate stages in stages[] — validator does not deduplicate (known limitation)", () => {
    // Zod does not reject duplicates; validator does not deduplicate
    // This test documents the current behavior (not a regression)
    const d = dag(["plan", "plan", "build"], [{ from: "plan", to: "build" }])
    // Should not throw — validator handles it without panicking
    expect(() => validateDAG(d, allCaps())).not.toThrow()
  })
  // devilcode_change end

  it("rejects DAG with multiple entry nodes", () => {
    // plan has no incoming edges; build has no incoming edges; no edge between them → no cycles
    const d = dag(["plan", "build", "ship"], [{ from: "plan", to: "ship" }, { from: "build", to: "ship" }])
    const errors = validateDAG(d, allCaps())
    const multiEntry = errors.find((e) => e.kind === "multiple-entries") as Extract<
      DAGError,
      { kind: "multiple-entries" }
    >
    expect(multiEntry).toBeDefined()
    expect(multiEntry.stages).toContain("plan")
    expect(multiEntry.stages).toContain("build")
  })

  it("accepts DAG with exactly one entry", () => {
    const d = dag(["plan", "build", "ship"], [{ from: "plan", to: "build" }, { from: "build", to: "ship" }])
    const errors = validateDAG(d, allCaps())
    expect(errors.filter((e) => e.kind === "no-entry" || e.kind === "multiple-entries")).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Cycle detection (Kahn's algorithm)
// ---------------------------------------------------------------------------

describe("validateDAG — cycle detection", () => {
  it("detects a 2-node cycle reachable from entry", () => {
    // contract (entry) → build ↔ review (cycle), ship also reachable from build
    // build→review, review→build form the cycle; contract is the entry with in-degree 0
    const d = dag(
      ["contract", "build", "review", "ship"],
      [
        { from: "contract", to: "build" },
        { from: "build", to: "review" },
        { from: "review", to: "build" }, // cycle between build ↔ review
        { from: "build", to: "ship" },
      ],
    )
    const errors = validateDAG(d, allCaps())
    const cycle = errors.find((e) => e.kind === "cycle") as Extract<DAGError, { kind: "cycle" }>
    expect(cycle).toBeDefined()
    expect(cycle.nodes).toContain("build")
    expect(cycle.nodes).toContain("review")
  })

  it("detects a 3-node cycle reachable from entry", () => {
    // plan (entry) → build → review → contract → build (3-node cycle: build,review,contract)
    const d = dag(
      ["plan", "build", "review", "contract", "ship"],
      [
        { from: "plan", to: "build" },
        { from: "build", to: "review" },
        { from: "review", to: "contract" },
        { from: "contract", to: "build" }, // closes the 3-cycle
        { from: "build", to: "ship" },
      ],
    )
    const errors = validateDAG(d, allCaps())
    const cycle = errors.find((e) => e.kind === "cycle") as Extract<DAGError, { kind: "cycle" }>
    expect(cycle).toBeDefined()
    expect(cycle.nodes.length).toBeGreaterThanOrEqual(2)
  })

  it("passes for a valid linear DAG with no cycles", () => {
    const d = dag(
      ["plan", "challenge", "contract", "build", "review", "ship", "retro"],
      [
        { from: "plan", to: "challenge" },
        { from: "challenge", to: "contract" },
        { from: "contract", to: "build" },
        { from: "build", to: "review" },
        { from: "review", to: "ship" },
        { from: "ship", to: "retro" },
      ],
    )
    const errors = validateDAG(d, allCaps())
    expect(errors.filter((e) => e.kind === "cycle")).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Reachability check
// ---------------------------------------------------------------------------

describe("validateDAG — unreachable stages", () => {
  it("detects stages unreachable from entry (isolated sub-cycle)", () => {
    // plan (entry) → build is the main path.
    // ship ↔ retro form an isolated cycle — neither is reachable from plan.
    // ship in-deg=1 (from retro), retro in-deg=1 (from ship) → neither is an extra entry.
    const d = dag(
      ["plan", "build", "ship", "retro"],
      [
        { from: "plan", to: "build" },
        { from: "ship", to: "retro" },
        { from: "retro", to: "ship" }, // isolated cycle unreachable from plan
      ],
    )
    const errors = validateDAG(d, allCaps())
    const unreachable = errors.find((e) => e.kind === "unreachable") as Extract<
      DAGError,
      { kind: "unreachable" }
    >
    expect(unreachable).toBeDefined()
    expect(unreachable.stages).toContain("ship")
    expect(unreachable.stages).toContain("retro")
  })

  it("passes when all stages are reachable", () => {
    const d = dag(
      ["plan", "build", "ship"],
      [{ from: "plan", to: "build" }, { from: "build", to: "ship" }],
    )
    const errors = validateDAG(d, allCaps())
    expect(errors.filter((e) => e.kind === "unreachable")).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Capability coverage
// ---------------------------------------------------------------------------

describe("validateDAG — capability coverage", () => {
  it("reports missing-capability when role lacks required capability", () => {
    // plan requires "planning" — provide only "implementation"
    const d = dag(["plan", "build"], [{ from: "plan", to: "build" }])
    const limitedCaps = caps("implementation")
    const errors = validateDAG(d, limitedCaps)
    const missing = errors.filter((e) => e.kind === "missing-capability") as Extract<
      DAGError,
      { kind: "missing-capability" }
    >[]
    expect(missing.length).toBeGreaterThan(0)
    const planMissing = missing.find((e) => e.stage === "plan")
    expect(planMissing).toBeDefined()
  })

  it("passes when all stages are covered", () => {
    const d = dag(["plan", "build", "ship"], [{ from: "plan", to: "build" }, { from: "build", to: "ship" }])
    const required = caps("planning", "implementation", "release")
    const errors = validateDAG(d, required)
    expect(errors.filter((e) => e.kind === "missing-capability")).toHaveLength(0)
  })

  it("uses capabilityOverrides when provided", () => {
    // retro normally requires "retrospective" — override to require "research"
    const d = dag(["plan", "retro"], [{ from: "plan", to: "retro" }])
    const researchOnlyCaps = caps("planning", "research")
    const errors = validateDAG(d, researchOnlyCaps, { retro: ["research"] })
    expect(errors.filter((e) => e.kind === "missing-capability")).toHaveLength(0)
  })

  it("falls back to STAGE_CAPABILITY_REQUIREMENTS when no override for a stage", () => {
    const d = dag(["plan", "build"], [{ from: "plan", to: "build" }])
    const implementationOnly = caps("implementation")
    // Override only for build; plan still uses default "planning"
    const errors = validateDAG(d, implementationOnly, { build: ["implementation"] })
    const planMissing = errors.find((e) => e.kind === "missing-capability" && (e as any).stage === "plan")
    expect(planMissing).toBeDefined()
  })

  // devilcode_change start — Phase 7 fix F9: capabilityOverride for unknown stage is silently ignored
  it("capabilityOverride for unknown stage is silently ignored (not in dag.stages)", () => {
    // Override specifies "retro" which is NOT in this DAG's stages
    const d = dag(["plan", "build"], [{ from: "plan", to: "build" }])
    const required = caps("planning", "implementation")
    // "retro" override should be ignored since retro is not in dag.stages
    const errors = validateDAG(d, required, { retro: ["retrospective"] })
    expect(errors.filter((e) => e.kind === "missing-capability")).toHaveLength(0)
  })
  // devilcode_change end
})

// ---------------------------------------------------------------------------
// formatDAGError
// ---------------------------------------------------------------------------

describe("formatDAGError", () => {
  it("formats cycle error", () => {
    const msg = formatDAGError({ kind: "cycle", nodes: ["plan", "build"] })
    expect(msg).toContain("cycle")
    expect(msg).toContain("plan")
  })

  it("formats unreachable error", () => {
    const msg = formatDAGError({ kind: "unreachable", stages: ["retro"] })
    expect(msg).toContain("unreachable")
    expect(msg).toContain("retro")
  })

  it("formats missing-capability error", () => {
    const msg = formatDAGError({ kind: "missing-capability", stage: "plan", required: ["planning"] })
    expect(msg).toContain("plan")
    expect(msg).toContain("planning")
  })

  it("formats no-entry error", () => {
    const msg = formatDAGError({ kind: "no-entry" })
    expect(msg).toContain("entry")
  })

  it("formats multiple-entries error", () => {
    const msg = formatDAGError({ kind: "multiple-entries", stages: ["plan", "build"] })
    expect(msg).toContain("multiple")
  })

  it("formats unknown-stage error", () => {
    const msg = formatDAGError({ kind: "unknown-stage", stage: "ghost" })
    expect(msg).toContain("ghost")
  })

  it("formats self-loop error", () => {
    const msg = formatDAGError({ kind: "self-loop", stage: "plan" })
    expect(msg).toContain("plan")
    expect(msg).toContain("self-loop")
  })
})
