import type { Node, Edge } from "@xyflow/react"
import { beadLifecycle } from "./bead-lifecycle"
import { adversarialLoop } from "./adversarial-loop"
import { convoyExecution } from "./convoy-execution"

export interface DiagramDefinition {
  nodes: Node[]
  edges: Edge[]
  caption?: string
}

export const diagrams: Record<string, DiagramDefinition> = {
  "bead-lifecycle": beadLifecycle,
  "adversarial-loop": adversarialLoop,
  "convoy-execution": convoyExecution,
}
