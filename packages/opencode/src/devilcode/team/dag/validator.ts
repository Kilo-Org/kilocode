/**
 * DAG validator using Kahn's topological sort algorithm for cycle detection.
 *
 * Validates:
 * 1. Self-loops (from === to)
 * 2. Edge endpoints exist in dag.stages
 * 3. Exactly one entry stage (in-degree 0)
 * 4. No cycles (Kahn's algorithm)
 * 5. All stages reachable from entry (BFS)
 * 6. Capability coverage for each stage
 *
 * Phase 7 — Configurable Workflow DAG
 */

import { STAGE_CAPABILITY_REQUIREMENTS } from "../capabilities"
import type { CanonicalCapability } from "../capabilities"
import type { WorkflowDAG } from "./schema"
import type { WorkflowStage } from "../../workflow/types"

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type DAGError =
  | { kind: "cycle"; nodes: WorkflowStage[] }
  | { kind: "unreachable"; stages: WorkflowStage[] }
  | { kind: "missing-capability"; stage: WorkflowStage; required: CanonicalCapability[] }
  | { kind: "no-entry" }
  | { kind: "multiple-entries"; stages: WorkflowStage[] }
  | { kind: "unknown-stage"; stage: string }
  | { kind: "self-loop"; stage: WorkflowStage }

// ---------------------------------------------------------------------------
// Error formatter
// ---------------------------------------------------------------------------

/**
 * R1-02: Human-readable description of a DAGError.
 */
export function formatDAGError(err: DAGError): string {
  switch (err.kind) {
    case "cycle":
      return `DAG contains a cycle involving stages: ${err.nodes.join(", ")}`
    case "unreachable":
      return `DAG has unreachable stages: ${err.stages.join(", ")}`
    case "missing-capability":
      return `Stage "${err.stage}" requires capability [${err.required.join(", ")}] but no role provides it`
    case "no-entry":
      return "DAG has no entry stage (all stages have incoming edges)"
    case "multiple-entries":
      return `DAG has multiple entry stages (in-degree 0): ${err.stages.join(", ")}`
    case "unknown-stage":
      return `Edge references unknown stage: "${err.stage}"`
    case "self-loop":
      return `Stage "${err.stage}" has a self-loop edge`
  }
}

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

/**
 * Validates a WorkflowDAG against the team's role capabilities.
 *
 * @param dag - The DAG to validate
 * @param roleCapabilities - Map of capabilities available across all roles (cap → true)
 * @param capabilityOverrides - Optional per-stage capability requirement overrides
 * @returns Array of DAGErrors (empty = valid)
 */
export function validateDAG(
  dag: WorkflowDAG,
  roleCapabilities: Map<CanonicalCapability, boolean>,
  capabilityOverrides?: Record<string, CanonicalCapability[]>,
): DAGError[] {
  const errors: DAGError[] = []
  const stageSet = new Set<string>(dag.stages)

  // 1. Self-loop check + edge endpoint validation
  for (const edge of dag.edges) {
    if (edge.from === edge.to) {
      errors.push({ kind: "self-loop", stage: edge.from as WorkflowStage })
      continue
    }
    if (!stageSet.has(edge.from)) {
      errors.push({ kind: "unknown-stage", stage: edge.from })
    }
    if (!stageSet.has(edge.to)) {
      errors.push({ kind: "unknown-stage", stage: edge.to })
    }
  }

  // If we have unknown stages, structural checks below are unreliable — stop early
  const hasUnknownStage = errors.some((e) => e.kind === "unknown-stage")
  if (hasUnknownStage) return errors

  // 2. Build adjacency list and in-degree map (Kahn's algorithm preparation)
  //    Exclude self-loop edges from in-degree counting (already reported)
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const stage of dag.stages) {
    inDegree.set(stage, 0)
    adjacency.set(stage, [])
  }

  for (const edge of dag.edges) {
    if (edge.from === edge.to) continue // self-loops already reported
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
    adjacency.get(edge.from)!.push(edge.to)
  }

  // 3. Entry stage validation — exactly one node with in-degree 0
  const entryStages = dag.stages.filter((s) => inDegree.get(s) === 0)
  if (entryStages.length === 0) {
    errors.push({ kind: "no-entry" })
    return errors // Cannot proceed — no anchor for BFS or Kahn's
  }
  if (entryStages.length > 1) {
    errors.push({ kind: "multiple-entries", stages: entryStages as WorkflowStage[] })
    // Continue structural checks but note entry is ambiguous
  }

  // 4. BFS reachability from entry stage(s)
  //    Detect both unreachable nodes AND separate genuine cycles from disconnected nodes.
  const reachableFromEntry = new Set<string>()
  const bfsStart = entryStages.length === 1 ? [entryStages[0]] : entryStages
  const bfsQueue: string[] = [...bfsStart]
  for (const s of bfsStart) reachableFromEntry.add(s)

  while (bfsQueue.length > 0) {
    const current = bfsQueue.shift()!
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!reachableFromEntry.has(neighbor)) {
        reachableFromEntry.add(neighbor)
        bfsQueue.push(neighbor)
      }
    }
  }

  const unreachable = dag.stages.filter((s) => !reachableFromEntry.has(s))
  if (unreachable.length > 0) {
    errors.push({ kind: "unreachable", stages: unreachable as WorkflowStage[] })
  }

  // 5. Kahn's algorithm for cycle detection (only among reachable nodes)
  //    We run Kahn's only on reachable nodes so disconnected nodes aren't reported as cycles.
  const reachableStages = dag.stages.filter((s) => reachableFromEntry.has(s))
  const workingInDegree = new Map<string, number>()
  for (const stage of reachableStages) {
    workingInDegree.set(stage, inDegree.get(stage) ?? 0)
  }

  const kahnQueue: string[] = reachableStages.filter((s) => workingInDegree.get(s) === 0)
  const sorted: string[] = []

  while (kahnQueue.length > 0) {
    const node = kahnQueue.shift()!
    sorted.push(node)
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!reachableFromEntry.has(neighbor)) continue // skip unreachable neighbors
      const newDegree = (workingInDegree.get(neighbor) ?? 0) - 1
      workingInDegree.set(neighbor, newDegree)
      if (newDegree === 0) {
        kahnQueue.push(neighbor)
      }
    }
  }

  // Reachable nodes not in sorted list form genuine cycles
  if (sorted.length < reachableStages.length) {
    const cycleNodes = reachableStages.filter((s) => !sorted.includes(s))
    errors.push({ kind: "cycle", nodes: cycleNodes as WorkflowStage[] })
  }

  // 6. Capability coverage — each stage must be coverable by at least one role
  for (const stage of dag.stages) {
    const required: CanonicalCapability[] = capabilityOverrides?.[stage] ??
      [STAGE_CAPABILITY_REQUIREMENTS[stage as WorkflowStage]]

    const covered = required.some((cap) => roleCapabilities.has(cap) && roleCapabilities.get(cap) === true)
    if (!covered) {
      errors.push({ kind: "missing-capability", stage: stage as WorkflowStage, required })
    }
  }

  return errors
}
