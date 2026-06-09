import type { Node, Edge, Position } from "@xyflow/react"
import type { DiagramDefinition } from "./index"

const laneStyle = (rgb: string, color: string) => ({
  padding: "10px 18px",
  borderRadius: "8px",
  fontSize: "12px",
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
  textAlign: "center" as const,
  minWidth: "140px",
  background: `rgba(${rgb},0.1)`,
  border: `1px solid rgba(${rgb},0.5)`,
  color,
})

const gt = laneStyle("59,130,246", "#3b82f6")
const wl = laneStyle("248,160,32", "#f8a020")
const val = laneStyle("167,139,250", "#a78bfa")
const rep = laneStyle("34,197,94", "#22c55e")

const nodes: Node[] = [
  {
    id: "browse",
    position: { x: 0, y: 0 },
    data: { label: "Mayor browse" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: gt,
  },
  {
    id: "wl-return",
    position: { x: 250, y: 0 },
    data: { label: "Wasteland returns\nwanted items" },
    sourcePosition: "bottom" as Position,
    targetPosition: "left" as Position,
    style: wl,
  },
  {
    id: "claim",
    position: { x: 0, y: 100 },
    data: { label: "Mayor claim" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: gt,
  },
  {
    id: "wl-lock",
    position: { x: 250, y: 100 },
    data: { label: "Wasteland locks\nitem → DoltHub PR" },
    sourcePosition: "bottom" as Position,
    targetPosition: "left" as Position,
    style: wl,
  },
  {
    id: "work",
    position: { x: 0, y: 210 },
    data: { label: "Polecats work\n→ push branch" },
    sourcePosition: "right" as Position,
    targetPosition: "top" as Position,
    style: gt,
  },
  {
    id: "done",
    position: { x: 0, y: 320 },
    data: { label: "Mayor done\n(evidence)" },
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    style: gt,
  },
  {
    id: "wl-attach",
    position: { x: 250, y: 320 },
    data: { label: "Wasteland attaches\nevidence to PR" },
    sourcePosition: "bottom" as Position,
    targetPosition: "left" as Position,
    style: wl,
  },
  {
    id: "review",
    position: { x: 500, y: 320 },
    data: { label: "Validator\nreviews PR" },
    sourcePosition: "bottom" as Position,
    targetPosition: "left" as Position,
    style: val,
  },
  {
    id: "stamp",
    position: { x: 500, y: 450 },
    data: { label: "Stamps:\nquality · reliability\n· creativity" },
    sourcePosition: "bottom" as Position,
    targetPosition: "top" as Position,
    style: val,
  },
  {
    id: "reputation",
    position: { x: 250, y: 560 },
    data: { label: "Reputation ledger\nupdates" },
    sourcePosition: "bottom" as Position,
    targetPosition: "top" as Position,
    style: rep,
  },
  {
    id: "identity",
    position: { x: 0, y: 560 },
    data: { label: "Portable\nidentity" },
    sourcePosition: "top" as Position,
    targetPosition: "right" as Position,
    style: rep,
  },
]

const labelStyle = { fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fill: "#888" }

const edges: Edge[] = [
  {
    id: "browse-return",
    source: "browse",
    target: "wl-return",
    type: "smoothstep",
    animated: true,
    label: "1 browse",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "claim-lock",
    source: "claim",
    target: "wl-lock",
    type: "smoothstep",
    animated: true,
    label: "2 claim",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "lock-work",
    source: "wl-lock",
    target: "work",
    type: "smoothstep",
    label: "3 work",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#f8a020" },
  },
  {
    id: "work-done",
    source: "work",
    target: "done",
    type: "smoothstep",
    animated: true,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "done-attach",
    source: "done",
    target: "wl-attach",
    type: "smoothstep",
    animated: true,
    label: "4 evidence",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "attach-review",
    source: "wl-attach",
    target: "review",
    type: "smoothstep",
    animated: true,
    label: "5 review",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#a78bfa" },
  },
  {
    id: "review-stamp",
    source: "review",
    target: "stamp",
    type: "smoothstep",
    animated: true,
    style: { strokeWidth: 2, stroke: "#a78bfa" },
  },
  {
    id: "stamp-rep",
    source: "stamp",
    target: "reputation",
    type: "smoothstep",
    animated: true,
    label: "6 reputation",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#22c55e" },
  },
  {
    id: "rep-identity",
    source: "reputation",
    target: "identity",
    type: "smoothstep",
    animated: true,
    style: { strokeWidth: 2, stroke: "#22c55e" },
  },
  {
    id: "return-claim",
    source: "wl-return",
    target: "wl-lock",
    type: "smoothstep",
    style: { strokeWidth: 1, stroke: "#f8a020", strokeDasharray: "4 4" },
  },
]

export const claimToStamp: DiagramDefinition = {
  nodes,
  edges,
  caption:
    "Claim-to-stamp flow — from browsing wanted items through claiming, working, submitting evidence, and earning stamps",
}
