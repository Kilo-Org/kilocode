import type { Node, Edge, Position } from "@xyflow/react"
import type { DiagramDefinition } from "./index"

const nodeBase = {
  style: {
    padding: "12px 20px",
    borderRadius: "8px",
    fontSize: "13px",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600,
    border: "1px solid",
    textAlign: "center" as const,
    minWidth: "120px",
  },
} as const satisfies Pick<Node, "style">

const nodes = [
  {
    id: "open",
    position: { x: 0, y: 120 },
    data: { label: "open" },
    // not sure why, but using Position.Top results in everything breaking at runtime
    // we just settle for casing as Position instead
    sourcePosition: "right" as Position,
    targetPosition: "top" as Position,
    style: {
      ...nodeBase.style,
      background: "rgba(34,197,94,0.1)",
      borderColor: "rgba(34,197,94,0.5)",
      color: "#22c55e",
    },
  },
  {
    id: "in_progress",
    position: { x: 200, y: 120 },
    data: { label: "in_progress" },
    sourcePosition: "right" as Position,
    targetPosition: "top" as Position,
    style: {
      ...nodeBase.style,
      background: "rgba(59,130,246,0.1)",
      borderColor: "rgba(59,130,246,0.5)",
      color: "#3b82f6",
    },
  },
  {
    id: "in_review",
    position: { x: 420, y: 120 },
    data: { label: "in_review" },
    sourcePosition: "right" as Position,
    targetPosition: "top" as Position,
    style: {
      ...nodeBase.style,
      background: "rgba(251,191,36,0.1)",
      borderColor: "rgba(251,191,36,0.5)",
      color: "#fbbf24",
    },
  },
  {
    id: "closed",
    position: { x: 640, y: 120 },
    data: { label: "closed" },
    sourcePosition: "top" as Position,
    targetPosition: "top" as Position,
    style: {
      ...nodeBase.style,
      background: "rgba(139,92,246,0.1)",
      borderColor: "rgba(139,92,246,0.5)",
      color: "#8b5cf6",
    },
  },
  {
    id: "failed",
    position: { x: 310, y: 280 },
    data: { label: "failed" },
    sourcePosition: "top" as Position,
    targetPosition: "top" as Position,
    style: {
      ...nodeBase.style,
      background: "rgba(239,68,68,0.1)",
      borderColor: "rgba(239,68,68,0.5)",
      color: "#ef4444",
    },
  },
] as const satisfies Node[]

const edgeBase = {
  style: { strokeWidth: 2 },
  animated: true,
}

const edges = [
  {
    id: "open-progress",
    source: "open",
    target: "in_progress",
    type: "smoothstep",
    label: "agent dispatched",
    labelStyle: { fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fill: "#888" },
    ...edgeBase,
    style: { ...edgeBase.style, stroke: "#3b82f6" },
  },
  {
    id: "progress-review",
    source: "in_progress",
    target: "in_review",
    type: "smoothstep",
    label: "work complete",
    labelStyle: { fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fill: "#888", zIndex: 10 },
    ...edgeBase,
    style: { ...edgeBase.style, stroke: "#fbbf24" },
  },
  {
    id: "review-closed",
    source: "in_review",
    target: "closed",
    type: "smoothstep",
    label: "approved & merged",
    labelStyle: { fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fill: "#888" },
    ...edgeBase,
    style: { ...edgeBase.style, stroke: "#8b5cf6" },
  },
  {
    id: "progress-failed",
    source: "in_progress",
    target: "failed",
    type: "smoothstep",
    label: "max retries",
    labelStyle: { fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fill: "#888", marginTop: "100px" },
    ...edgeBase,
    style: { ...edgeBase.style, strokeWidth: 2, stroke: "#ef4444", strokeDasharray: "5 3" },
  },
] as const satisfies Edge[]

export const beadLifecycle = {
  nodes,
  edges,
  caption: "The bead lifecycle — from open to closed, with adversarial review in between",
} as const satisfies DiagramDefinition
