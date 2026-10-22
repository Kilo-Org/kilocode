import type { Node, Edge, Position } from "@xyflow/react"
import type { DiagramDefinition } from "./index"

const baseStyle = {
  padding: "14px 22px",
  borderRadius: "8px",
  fontSize: "13px",
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
  textAlign: "center" as const,
  minWidth: "160px",
}

const nodes: Node[] = [
  {
    id: "polecat-write",
    position: { x: 0, y: 80 },
    data: { label: "Polecat writes code" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: {
      ...baseStyle,
      background: "rgba(59,130,246,0.1)",
      border: "1px solid rgba(59,130,246,0.5)",
      color: "#3b82f6",
    },
  },
  {
    id: "push",
    position: { x: 240, y: 80 },
    data: { label: "Push branch" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: {
      ...baseStyle,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.15)",
      color: "#ccc",
      minWidth: "120px",
    },
  },
  {
    id: "refinery-review",
    position: { x: 440, y: 80 },
    data: { label: "Refinery reviews" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: {
      ...baseStyle,
      background: "rgba(251,191,36,0.1)",
      border: "1px solid rgba(251,191,36,0.5)",
      color: "#fbbf24",
    },
  },
  {
    id: "approve",
    position: { x: 680, y: 20 },
    data: { label: "✓ Approve & Merge" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: {
      ...baseStyle,
      background: "rgba(34,197,94,0.1)",
      border: "1px solid rgba(34,197,94,0.5)",
      color: "#22c55e",
    },
  },
  {
    id: "feedback",
    position: { x: 680, y: 140 },
    data: { label: "✗ Send feedback" },
    sourcePosition: "bottom" as Position,
    targetPosition: "left" as Position,
    style: {
      ...baseStyle,
      background: "rgba(249,115,22,0.1)",
      border: "1px solid rgba(249,115,22,0.5)",
      color: "#f97316",
    },
  },
  {
    id: "revise",
    position: { x: 240, y: 220 },
    data: { label: "Polecat revises" },
    sourcePosition: "right" as Position,
    targetPosition: "top" as Position,
    style: {
      ...baseStyle,
      background: "rgba(59,130,246,0.1)",
      border: "1px solid rgba(59,130,246,0.5)",
      color: "#3b82f6",
    },
  },
]

const edges: Edge[] = [
  {
    id: "write-push",
    source: "polecat-write",
    target: "push",
    animated: true,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "push-review",
    source: "push",
    target: "refinery-review",
    animated: true,
    style: { strokeWidth: 2, stroke: "#fbbf24" },
  },
  {
    id: "review-approve",
    source: "refinery-review",
    target: "approve",
    type: "smoothstep",
    animated: true,
    style: { strokeWidth: 2, stroke: "#22c55e" },
  },
  {
    id: "review-feedback",
    source: "refinery-review",
    target: "feedback",
    type: "smoothstep",
    style: { strokeWidth: 2, stroke: "#f97316", strokeDasharray: "5 3" },
  },
  {
    id: "feedback-revise",
    source: "feedback",
    target: "revise",
    type: "smoothstep",
    style: { strokeWidth: 2, stroke: "#f97316", strokeDasharray: "5 3" },
  },
  {
    id: "revise-review",
    source: "revise",
    target: "refinery-review",
    type: "smoothstep",
    animated: true,
    label: "re-submit",
    labelStyle: { fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fill: "#888" },
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
]

export const adversarialLoop: DiagramDefinition = {
  nodes,
  edges,
  caption: "The micro-adversarial loop — write, review, revise until quality is met",
}
