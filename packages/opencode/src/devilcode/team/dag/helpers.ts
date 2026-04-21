/**
 * DAG helper functions for workflow stage traversal and default DAG generation.
 *
 * Phase 7 — Configurable Workflow DAG
 */

import type { WorkflowDAG, WorkflowDAGEdge } from "./schema"
import type { WorkflowStage } from "../../workflow/types"

/**
 * Returns the next stage after `current` in the given DAG, or null if `current`
 * is the terminal node (no outgoing edge).
 */
export function getNextStage(current: WorkflowStage, dag: WorkflowDAG): WorkflowStage | null {
  const edge = dag.edges.find((e) => e.from === current)
  return (edge?.to ?? null) as WorkflowStage | null
}

/**
 * Returns the entry stage of the DAG (the unique node with in-degree 0),
 * or null if the DAG has zero or multiple entry nodes.
 *
 * Callers should run validateDAG() first to ensure exactly one entry exists.
 */
export function getEntryStage(dag: WorkflowDAG): WorkflowStage | null {
  const inDegree = new Map<string, number>()
  for (const s of dag.stages) inDegree.set(s, 0)
  for (const e of dag.edges) {
    if (e.from === e.to) continue // self-loops don't affect in-degree
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
  }
  const entries = dag.stages.filter((s) => inDegree.get(s) === 0)
  return entries.length === 1 ? (entries[0] as WorkflowStage) : null
}

/**
 * Generates the default 7-stage linear DAG:
 * plan → challenge → contract → build → review → ship → retro
 */
export function generateDefaultDAG(): WorkflowDAG {
  const stages: WorkflowStage[] = ["plan", "challenge", "contract", "build", "review", "ship", "retro"]
  const edges: WorkflowDAGEdge[] = []
  for (let i = 0; i < stages.length - 1; i++) {
    edges.push({ from: stages[i], to: stages[i + 1] })
  }
  return { stages, edges }
}
