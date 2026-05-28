import type { Node, Edge, Position } from "@xyflow/react"
import type { DiagramDefinition } from "./index"

const stageStyle = (color: string) => ({
  padding: "12px 18px",
  borderRadius: "8px",
  fontSize: "12px",
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
  background: `rgba(${color},0.1)`,
  border: `1px solid rgba(${color},0.5)`,
  textAlign: "center" as const,
  minWidth: "140px",
})

const closedColor = "139,92,246"
const activeColor = "59,130,246"
const pendingColor = "255,255,255"
const reviewColor = "251,191,36"
const mergeColor = "34,197,94"

const nodes: Node[] = [
  {
    id: "bead1",
    position: { x: 0, y: 0 },
    data: { label: "1. Explore codebase" },
    sourcePosition: "bottom" as Position,
    targetPosition: "left" as Position,
    style: { ...stageStyle(closedColor), color: "#8b5cf6" },
  },
  {
    id: "review1",
    position: { x: 0, y: 100 },
    data: { label: "✓ reviewed" },
    sourcePosition: "right" as Position,
    targetPosition: "top" as Position,
    style: { ...stageStyle(mergeColor), color: "#22c55e", minWidth: "140px", fontSize: "11px" },
  },
  {
    id: "bead2",
    position: { x: 200, y: 0 },
    data: { label: "2. Design schema" },
    sourcePosition: "bottom" as Position,
    targetPosition: "left" as Position,
    style: { ...stageStyle(closedColor), color: "#8b5cf6" },
  },
  {
    id: "review2",
    position: { x: 200, y: 100 },
    data: { label: "✓ reviewed" },
    sourcePosition: "right" as Position,
    targetPosition: "top" as Position,
    style: { ...stageStyle(mergeColor), color: "#22c55e", minWidth: "140px", fontSize: "11px" },
  },
  {
    id: "bead3",
    position: { x: 400, y: 0 },
    data: { label: "3. Implement API" },
    sourcePosition: "bottom" as Position,
    targetPosition: "left" as Position,
    style: { ...stageStyle(activeColor), color: "#3b82f6" },
  },
  {
    id: "review3",
    position: { x: 400, y: 100 },
    data: { label: "⟳ in review" },
    sourcePosition: "right" as Position,
    targetPosition: "top" as Position,
    style: { ...stageStyle(reviewColor), color: "#fbbf24", minWidth: "140px", fontSize: "11px" },
  },
  {
    id: "bead4",
    position: { x: 600, y: 0 },
    data: { label: "4. Write tests" },
    sourcePosition: "bottom" as Position,
    targetPosition: "left" as Position,
    style: { ...stageStyle(pendingColor), color: "#666", opacity: 0.6 },
  },
  {
    id: "landing",
    position: { x: 800, y: 35 },
    data: { label: "Landing Review" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: {
      ...stageStyle(reviewColor),
      color: "#fbbf24",
      minWidth: "140px",
      opacity: 0.4,
      border: "1px dashed rgba(251,191,36,0.4)",
    },
  },
  {
    id: "main",
    position: { x: 990, y: 35 },
    data: { label: "→ main" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: {
      ...stageStyle(mergeColor),
      color: "#22c55e",
      minWidth: "100px",
      opacity: 0.4,
      border: "1px dashed rgba(34,197,94,0.4)",
    },
  },
]

const edges: Edge[] = [
  {
    id: "b1-r1",
    source: "bead1",
    target: "review1",
    type: "smoothstep",
    style: { strokeWidth: 2, stroke: "#8b5cf6" },
  },
  {
    id: "r1-b2",
    source: "review1",
    target: "bead2",
    animated: true,
    style: { strokeWidth: 2, stroke: "#22c55e" },
    label: "builds on",
    labelStyle: { fontSize: 9, fontFamily: "'JetBrains Mono', monospace", fill: "#666" },
  },
  {
    id: "b2-r2",
    source: "bead2",
    target: "review2",
    type: "smoothstep",
    style: { strokeWidth: 2, stroke: "#8b5cf6" },
  },
  {
    id: "r2-b3",
    source: "review2",
    target: "bead3",
    animated: true,
    style: { strokeWidth: 2, stroke: "#22c55e" },
    label: "builds on",
    labelStyle: { fontSize: 9, fontFamily: "'JetBrains Mono', monospace", fill: "#666" },
  },
  {
    id: "b3-r3",
    source: "bead3",
    target: "review3",
    type: "smoothstep",
    animated: true,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "r3-b4",
    source: "review3",
    target: "bead4",
    style: { strokeWidth: 1, stroke: "#444", strokeDasharray: "4 4" },
  },
  {
    id: "b4-landing",
    source: "bead4",
    target: "landing",
    style: { strokeWidth: 1, stroke: "#444", strokeDasharray: "4 4" },
  },
  {
    id: "landing-main",
    source: "landing",
    target: "main",
    style: { strokeWidth: 1, stroke: "#444", strokeDasharray: "4 4" },
  },
]

export const convoyExecution: DiagramDefinition = {
  nodes,
  edges,
  caption: "A convoy executing — each bead builds on reviewed work from previous stages",
}
