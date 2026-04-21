/**
 * DAG schema definitions for configurable workflow overrides.
 *
 * WorkflowDAG models an explicit directed acyclic graph of workflow stages.
 * DAGOverride composes with CanonicalTeamConfig as an optional field.
 *
 * R1-01: Use z.record(z.string(), ...) with refine — z.record(WorkflowStage, ...)
 * in Zod v4 requires ALL enum keys present, which would break partial overrides.
 *
 * Phase 7 — Configurable Workflow DAG
 */

import { z } from "zod"
import { WorkflowStage } from "../../workflow/types"
import { CanonicalCapability } from "../capabilities"

export const WorkflowDAGEdge = z.object({
  from: WorkflowStage,
  to: WorkflowStage,
  condition: z.string().optional(), // Reserved for Phase 9+ conditional branching
})
export type WorkflowDAGEdge = z.infer<typeof WorkflowDAGEdge>

export const WorkflowDAG = z.object({
  stages: z.array(WorkflowStage).nonempty(),
  edges: z.array(WorkflowDAGEdge).default([]),
})
export type WorkflowDAG = z.infer<typeof WorkflowDAG>

// R1-01: z.record(WorkflowStage, ...) would require ALL enum keys — use z.record(z.string(), ...)
// with a refine to validate that keys are valid WorkflowStage values.
export const DAGOverride = z.object({
  dag: WorkflowDAG,
  capabilityOverrides: z
    .record(z.string(), z.array(CanonicalCapability))
    .optional()
    .refine(
      (overrides) =>
        !overrides ||
        Object.keys(overrides).every((k) => (WorkflowStage.options as readonly string[]).includes(k)),
      { message: "capabilityOverrides keys must be valid WorkflowStage values" },
    ),
})
export type DAGOverride = z.infer<typeof DAGOverride>
