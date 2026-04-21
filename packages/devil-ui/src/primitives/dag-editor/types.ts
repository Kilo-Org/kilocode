/**
 * Local type definitions for the DAGEditor primitive.
 *
 * R2-02: Types defined locally — do NOT import from @devilcode/cli.
 * These mirror shapes from packages/opencode/src/devilcode/team/dag/schema.ts and validator.ts.
 * Phase 9 may extract to a shared types package if cross-package friction surfaces.
 */

export type WorkflowStage = "plan" | "challenge" | "contract" | "build" | "review" | "ship" | "retro"

export interface WorkflowDAGEdge {
  from: WorkflowStage
  to: WorkflowStage
  condition?: string
}

export interface WorkflowDAG {
  stages: WorkflowStage[]
  edges: WorkflowDAGEdge[]
}

export type DAGError =
  | { kind: "cycle"; nodes: WorkflowStage[] }
  | { kind: "unreachable"; stages: WorkflowStage[] }
  | { kind: "missing-capability"; stage: WorkflowStage; required: string[] }
  | { kind: "no-entry" }
  | { kind: "multiple-entries"; stages: WorkflowStage[] }
  | { kind: "unknown-stage"; stage: string }
  | { kind: "self-loop"; stage: WorkflowStage }

export interface DAGEditorProps {
  dag: WorkflowDAG
  onChange?: (dag: WorkflowDAG) => void
  errors?: DAGError[]
  readOnly?: boolean
  class?: string
}
