import type { Node, Edge, Position } from "@xyflow/react"
import type { DiagramDefinition } from "./index"

const townStyle = {
  padding: "10px 16px",
  borderRadius: "8px",
  fontSize: "12px",
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
  textAlign: "center" as const,
  minWidth: "130px",
  background: "rgba(59,130,246,0.1)",
  border: "1px solid rgba(59,130,246,0.5)",
  color: "#3b82f6",
}

const wastelandStyle = {
  padding: "14px 24px",
  borderRadius: "10px",
  fontSize: "13px",
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 700,
  textAlign: "center" as const,
  minWidth: "180px",
  background: "rgba(248,160,32,0.1)",
  border: "1px solid rgba(248,160,32,0.5)",
  color: "#f8a020",
}

const dbStyle = {
  padding: "10px 18px",
  borderRadius: "6px",
  fontSize: "11px",
  fontFamily: "'JetBrains Mono', monospace",
  fontWeight: 600,
  textAlign: "center" as const,
  minWidth: "140px",
  background: "rgba(139,92,246,0.08)",
  border: "1px solid rgba(139,92,246,0.4)",
  color: "#8b5cf6",
}

const nodes: Node[] = [
  {
    id: "town-you",
    position: { x: -60, y: 0 },
    data: { label: "Your Town" },
    sourcePosition: "bottom" as Position,
    targetPosition: "top" as Position,
    style: townStyle,
  },
  {
    id: "town-acme",
    position: { x: 140, y: 0 },
    data: { label: "Acme Eng Town" },
    sourcePosition: "bottom" as Position,
    targetPosition: "top" as Position,
    style: townStyle,
  },
  {
    id: "town-oss",
    position: { x: 360, y: 0 },
    data: { label: "Open Source Town" },
    sourcePosition: "bottom" as Position,
    targetPosition: "top" as Position,
    style: townStyle,
  },
  {
    id: "commons-wl",
    position: { x: 60, y: 180 },
    data: { label: "Commons Wasteland" },
    sourcePosition: "bottom" as Position,
    targetPosition: "top" as Position,
    style: wastelandStyle,
  },
  {
    id: "commons-db",
    position: { x: 80, y: 340 },
    data: { label: "DoltHub DB" },
    sourcePosition: "top" as Position,
    targetPosition: "top" as Position,
    style: dbStyle,
  },
  {
    id: "private-wl",
    position: { x: 520, y: 180 },
    data: { label: "Private Team\nWasteland" },
    sourcePosition: "bottom" as Position,
    targetPosition: "top" as Position,
    style: wastelandStyle,
  },
  {
    id: "private-town1",
    position: { x: 540, y: 0 },
    data: { label: "Private Town" },
    sourcePosition: "bottom" as Position,
    targetPosition: "top" as Position,
    style: townStyle,
  },
  {
    id: "private-db",
    position: { x: 540, y: 340 },
    data: { label: "DoltHub DB" },
    sourcePosition: "top" as Position,
    targetPosition: "top" as Position,
    style: dbStyle,
  },
]

const labelStyle = { fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fill: "#888" }

const edges: Edge[] = [
  {
    id: "town-you-wl",
    source: "town-you",
    target: "commons-wl",
    type: "smoothstep",
    animated: true,
    label: "claim / submit",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "town-acme-wl",
    source: "town-acme",
    target: "commons-wl",
    type: "smoothstep",
    animated: true,
    label: "claim / submit",
    labelStyle,
    zIndex: 10,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "town-oss-wl",
    source: "town-oss",
    target: "commons-wl",
    type: "smoothstep",
    animated: true,
    labelStyle,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "commons-wl-db",
    source: "commons-wl",
    target: "commons-db",
    type: "smoothstep",
    label: "persist",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#8b5cf6" },
  },
  {
    id: "private-town1-wl",
    source: "private-town1",
    target: "private-wl",
    type: "smoothstep",
    animated: true,
    label: "claim / submit",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#3b82f6" },
  },
  {
    id: "private-wl-db",
    source: "private-wl",
    target: "private-db",
    type: "smoothstep",
    label: "persist",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#8b5cf6" },
  },
  {
    id: "wl-federation",
    source: "commons-wl",
    target: "private-wl",
    type: "smoothstep",
    label: "portable identity",
    labelStyle,
    style: { strokeWidth: 2, stroke: "#f8a020", strokeDasharray: "6 3" },
  },
]

export const wastelandFederation: DiagramDefinition = {
  nodes,
  edges,
  caption: "Federated Wasteland architecture — towns connect to shared Wasteland instances backed by DoltHub",
}
