"use client"

import React, { useState, useEffect, useMemo } from "react"
import { diagrams } from "./diagrams"

/**
 * FlowDiagram renders an interactive React Flow diagram.
 * Loaded lazily to avoid bundling the entire @xyflow/react library on pages that don't use it.
 *
 * Usage in markdown:
 *   {% flowDiagram name="bead-lifecycle" /%}
 *   {% flowDiagram name="adversarial-loop" height="500px" /%}
 */
export function FlowDiagram({ name, height = "400px" }: { name: string; height?: string }) {
  const [mod, setMod] = useState<typeof import("@xyflow/react") | null>(null)
  const [cssLoaded, setCssLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      import("@xyflow/react"),
      import("@xyflow/react/dist/style.css").then(() => setCssLoaded(true)),
    ]).then(([xyflow]) => {
      setMod(xyflow)
    })
  }, [])

  const diagram = diagrams[name]

  if (!diagram) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "8px",
          color: "var(--text-muted, #888)",
          fontFamily: "monospace",
          fontSize: "14px",
        }}
      >
        Diagram &quot;{name}&quot; not found
      </div>
    )
  }

  if (!mod || !cssLoaded) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "8px",
          background: "rgba(0,0,0,0.2)",
          color: "var(--text-muted, #888)",
        }}
      >
        Loading diagram...
      </div>
    )
  }

  const { ReactFlow, Background, BackgroundVariant } = mod

  return (
    <figure style={{ margin: "24px 0" }}>
      <div
        style={{
          height,
          width: "100%",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        <ReactFlow
          nodes={diagram.nodes}
          edges={diagram.edges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          style={{ background: "#08080c" }}
        >
          <Background variant={BackgroundVariant.Dots} color="rgba(248,160,32,0.15)" gap={20} size={1} />
        </ReactFlow>
      </div>
      {diagram.caption && (
        <figcaption
          style={{
            textAlign: "center",
            fontSize: "13px",
            color: "var(--text-muted, #888)",
            marginTop: "8px",
            fontStyle: "italic",
          }}
        >
          {diagram.caption}
        </figcaption>
      )}
    </figure>
  )
}
