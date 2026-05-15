import type { Node, Edge, Position } from "@xyflow/react"
import type { DiagramDefinition } from "./index"

const stateStyle = (color: string, rgb: string) => ({
  padding: "12px 20px",
  borderRadius: "8px",
  fontSize: "13px",
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
  textAlign: "center" as const,
  minWidth: "120px",
  background: `rgba(${rgb},0.1)`,
  border: `1px solid rgba(${rgb},0.5)`,
  color,
})

const nodes: Node[] = [
  {
    id: "posted",
    position: { x: 0, y: 0 },
    data: { label: "Posted" },
    sourcePosition: "right" as Position,
    targetPosition: "top" as Position,
    style: stateStyle("#22c55e", "34,197,94"),
  },
  {
    id: "claimed",
    position: { x: 200, y: 0 },
    data: { label: "Claimed" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: stateStyle("#3b82f6", "59,130,246"),
  },
  {
    id: "in_progress",
    position: { x: 400, y: 0 },
    data: { label: "In progress" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: stateStyle("#f8a020", "248,160,32"),
  },
  {
    id: "evidence_submitted",
    position: { x: 600, y: 0 },
    data: { label: "Evidence submitted" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: stateStyle("#a78bfa", "167,139,250"),
  },
  {
    id: "stamped",
    position: { x: 850, y: 0 },
    data: { label: "Stamped" },
    sourcePosition: "top" as Position,
    targetPosition: "left" as Position,
    style: stateStyle("#22c55e", "34,197,94"),
  },
  {
    id: "rejected",
    position: { x: 600, y: 160 },
    data: { label: "Rejected" },
    sourcePosition: "bottom" as Position,
    targetPosition: "top" as Position,
    style: stateStyle("#ef4444", "239,68,68"),
  },
  {
    id: "abandoned",
    position: { x: 200, y: 160 },
    data: { label: "Abandoned" },
    sourcePosition: "top" as Position,
    targetPosition: "top" as Position,
    style: stateStyle("#888", "255,255,255"),
  },
]

const labelStyle = { fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fill: "#888" }

const edges: Edge[] = [
  {
    id: "posted-claimed",
    source: "posted",
    target: "claimed",
    type: "smoothstep",
    animated: true,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "claimed-progress",
    source: "claimed",
    target: "in_progress",
    type: "smoothstep",
    animated: true,
    style: { strokeWidth: 2, stroke: "#f8a020" },
  },
  {
    id: "progress-evidence",
    source: "in_progress",
    target: "evidence_submitted",
    type: "smoothstep",
    animated: true,
    style: { strokeWidth: 2, stroke: "#a78bfa" },
  },
  {
    id: "evidence-stamped",
    source: "evidence_submitted",
    target: "stamped",
    type: "smoothstep",
    animated: true,
    style: { strokeWidth: 2, stroke: "#22c55e" },
  },
  {
    id: "evidence-rejected",
    source: "evidence_submitted",
    target: "rejected",
    type: "smoothstep",
    label: "rejects",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#ef4444", strokeDasharray: "5 3" },
  },
  {
    id: "rejected-progress",
    source: "rejected",
    target: "in_progress",
    type: "smoothstep",
    label: "rework",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#f8a020", strokeDasharray: "5 3" },
  },

  {
    id: "claimed-abandoned",
    source: "claimed",
    target: "abandoned",
    type: "smoothstep",
    style: { strokeWidth: 2, stroke: "#888", strokeDasharray: "5 3" },
  },

]

export const wantedLifecycle: DiagramDefinition = {
  nodes,
  edges,
  caption: "Wanted item lifecycle — from posted through claimed, in-progress, evidence, and stamped (or rejected)",
}
