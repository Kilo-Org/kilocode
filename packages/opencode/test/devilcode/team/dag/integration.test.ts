/**
 * Integration tests for 3 synthetic non-default DAG configurations.
 *
 * Each test:
 * - Constructs a DAG programmatically
 * - Validates via validateDAG() with appropriate role capabilities
 * - Verifies getNextStage() traversal produces the expected sequence
 *
 * Phase 7 — Configurable Workflow DAG
 */

import { describe, it, expect } from "bun:test"
import { validateDAG } from "@/devilcode/team/dag/validator"
import { getNextStage, getEntryStage } from "@/devilcode/team/dag/helpers"
import { WorkflowDAG } from "@/devilcode/team/dag/schema"
import type { CanonicalCapability } from "@/devilcode/team/capabilities"
// devilcode_change start — Phase 7 fix F3: CanonicalTeamConfig workflowOverride schema enforcement tests
import { CanonicalTeamConfig } from "@/devilcode/team/config"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
import { stableStringify } from "@/devilcode/team/checksum"
// devilcode_change end

// ---------------------------------------------------------------------------
// Capability helpers
// ---------------------------------------------------------------------------

function caps(...capabilities: CanonicalCapability[]): Map<CanonicalCapability, boolean> {
  return new Map(capabilities.map((c) => [c, true] as [CanonicalCapability, boolean]))
}

function traverseDAG(entry: string, dag: WorkflowDAG): string[] {
  const path: string[] = []
  let current: string | null = entry
  while (current !== null) {
    path.push(current)
    current = getNextStage(current as WorkflowDAG["stages"][number], dag)
  }
  return path
}

// ---------------------------------------------------------------------------
// Synthetic DAG 1 — Skip-challenge
//
// Standard 7-stage workflow with "challenge" stage removed.
// Useful for teams that bypass the adversarial challenge step.
// plan → contract → build → review → ship → retro
// ---------------------------------------------------------------------------

describe("Synthetic DAG 1 — skip-challenge", () => {
  const skipChallengeDag = WorkflowDAG.parse({
    stages: ["plan", "contract", "build", "review", "ship", "retro"],
    edges: [
      { from: "plan", to: "contract" },
      { from: "contract", to: "build" },
      { from: "build", to: "review" },
      { from: "review", to: "ship" },
      { from: "ship", to: "retro" },
    ],
  })

  // Capabilities: planning (plan), design (contract), implementation (build),
  //               review (review), release (ship), retrospective (retro)
  const roleCaps = caps("planning", "design", "implementation", "review", "release", "retrospective")

  it("validates with no errors", () => {
    const errors = validateDAG(skipChallengeDag, roleCaps)
    expect(errors).toEqual([])
  })

  it("has exactly one entry stage: plan", () => {
    const entry = getEntryStage(skipChallengeDag)
    expect(entry).toBe("plan")
  })

  it("traversal produces correct 6-stage sequence", () => {
    const path = traverseDAG("plan", skipChallengeDag)
    expect(path).toEqual(["plan", "contract", "build", "review", "ship", "retro"])
  })

  it("terminal stage (retro) has no successor", () => {
    expect(getNextStage("retro", skipChallengeDag)).toBeNull()
  })

  it("contains 6 stages and 5 edges", () => {
    expect(skipChallengeDag.stages).toHaveLength(6)
    expect(skipChallengeDag.edges).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// Synthetic DAG 2 — Minimal
//
// Stripped-down 3-stage workflow for rapid prototyping or hotfix flows.
// plan → build → ship
// ---------------------------------------------------------------------------

describe("Synthetic DAG 2 — minimal (plan → build → ship)", () => {
  const minimalDag = WorkflowDAG.parse({
    stages: ["plan", "build", "ship"],
    edges: [
      { from: "plan", to: "build" },
      { from: "build", to: "ship" },
    ],
  })

  // Capabilities: planning, implementation, release
  const roleCaps = caps("planning", "implementation", "release")

  it("validates with no errors", () => {
    const errors = validateDAG(minimalDag, roleCaps)
    expect(errors).toEqual([])
  })

  it("has exactly one entry stage: plan", () => {
    const entry = getEntryStage(minimalDag)
    expect(entry).toBe("plan")
  })

  it("traversal produces correct 3-stage sequence", () => {
    const path = traverseDAG("plan", minimalDag)
    expect(path).toEqual(["plan", "build", "ship"])
  })

  it("ship is terminal — no successor", () => {
    expect(getNextStage("ship", minimalDag)).toBeNull()
  })

  it("contains 3 stages and 2 edges", () => {
    expect(minimalDag.stages).toHaveLength(3)
    expect(minimalDag.edges).toHaveLength(2)
  })

  it("skipped stages (challenge, contract, review, retro) not present", () => {
    for (const absent of ["challenge", "contract", "review", "retro"]) {
      expect(minimalDag.stages).not.toContain(absent)
    }
  })
})

// ---------------------------------------------------------------------------
// Synthetic DAG 3 — With capability override
//
// Reordered workflow where "retro" stage is placed early (before build)
// and its capability requirement is overridden from "retrospective" → "research".
// This models a team that uses a discovery/research phase before building.
//
// plan → retro → build → review → ship
// capabilityOverrides: { retro: ["research"] }
// ---------------------------------------------------------------------------

describe("Synthetic DAG 3 — capability override (retro with research capability)", () => {
  const withOverrideDag = WorkflowDAG.parse({
    stages: ["plan", "retro", "build", "review", "ship"],
    edges: [
      { from: "plan", to: "retro" },
      { from: "retro", to: "build" },
      { from: "build", to: "review" },
      { from: "review", to: "ship" },
    ],
  })

  // roleCaps includes "research" but NOT "retrospective"
  // Without override, retro would require "retrospective" and fail.
  const roleCaps = caps("planning", "research", "implementation", "review", "release")

  const capabilityOverrides: Record<string, CanonicalCapability[]> = {
    retro: ["research"],
  }

  it("validates with no errors when override maps retro to research", () => {
    const errors = validateDAG(withOverrideDag, roleCaps, capabilityOverrides)
    expect(errors).toEqual([])
  })

  it("fails capability check without the override (retro requires retrospective)", () => {
    // Without override, retro needs "retrospective" which is not in roleCaps
    const errors = validateDAG(withOverrideDag, roleCaps)
    const missingCap = errors.find((e) => e.kind === "missing-capability" && (e as any).stage === "retro")
    expect(missingCap).toBeDefined()
  })

  it("has exactly one entry stage: plan", () => {
    const entry = getEntryStage(withOverrideDag)
    expect(entry).toBe("plan")
  })

  it("traversal produces correct 5-stage sequence", () => {
    const path = traverseDAG("plan", withOverrideDag)
    expect(path).toEqual(["plan", "retro", "build", "review", "ship"])
  })

  it("retro appears before build in traversal (reordered from default)", () => {
    const path = traverseDAG("plan", withOverrideDag)
    const retroIdx = path.indexOf("retro")
    const buildIdx = path.indexOf("build")
    expect(retroIdx).toBeLessThan(buildIdx)
  })

  it("ship is terminal — no successor", () => {
    expect(getNextStage("ship", withOverrideDag)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// devilcode_change start — Phase 7 fix F3: CanonicalTeamConfig workflowOverride schema enforcement
//
// Exercises the superRefine block in config.ts that validates the DAG against
// team capabilities when workflowOverride is present.
// ---------------------------------------------------------------------------

describe("CanonicalTeamConfig — workflowOverride schema enforcement", () => {
  // Helper: base config from a quickstart template that has broad capability coverage
  const baseConfig = () => loadQuickstartTemplates()["solo-enhanced"].team

  it("valid workflowOverride (simple 3-stage DAG) parses successfully", () => {
    const config = {
      ...baseConfig(),
      workflowOverride: {
        dag: {
          stages: ["plan", "build", "ship"],
          edges: [
            { from: "plan", to: "build" },
            { from: "build", to: "ship" },
          ],
        },
      },
    }
    const result = CanonicalTeamConfig.safeParse(config)
    expect(result.success).toBe(true)
  })

  it("structurally invalid DAG (no-entry due to all nodes having incoming edges) fails safeParse", () => {
    const config = {
      ...baseConfig(),
      workflowOverride: {
        dag: {
          stages: ["plan", "build"],
          edges: [
            { from: "plan", to: "build" },
            { from: "build", to: "plan" }, // both nodes have in-degree 1 → no-entry, not Kahn's cycle
          ],
        },
      },
    }
    const result = CanonicalTeamConfig.safeParse(config)
    expect(result.success).toBe(false)
  })

  it("cyclic DAG with valid entry fails safeParse (exercises Kahn's cycle detection)", () => {
    // plan is entry (in-degree 0); build↔review form a 2-node cycle reachable from plan
    // Kahn's: plan gets sorted, then build and review both remain with in-degree > 0 → cycle detected
    const base = loadQuickstartTemplates()["solo-enhanced"].team
    const result = CanonicalTeamConfig.safeParse({
      ...base,
      workflowOverride: {
        dag: {
          stages: ["plan", "build", "review"],
          edges: [
            { from: "plan", to: "build" },
            { from: "build", to: "review" },
            { from: "review", to: "build" }, // cycle: build ↔ review
          ],
        },
      },
    })
    expect(result.success).toBe(false)
  })

  it("valid team config with workflowOverride round-trips through CanonicalTeamConfig.parse", () => {
    const base = baseConfig()
    const withOverride: CanonicalTeamConfig = {
      ...base,
      workflowOverride: {
        dag: {
          stages: ["plan", "build", "ship"],
          edges: [
            { from: "plan", to: "build" },
            { from: "build", to: "ship" },
          ],
        },
      },
    }
    const parsed = CanonicalTeamConfig.parse(withOverride)
    expect(stableStringify(parsed)).toBe(stableStringify(withOverride))
    expect(parsed.workflowOverride?.dag.stages).toEqual(["plan", "build", "ship"])
  })
})
// devilcode_change end
