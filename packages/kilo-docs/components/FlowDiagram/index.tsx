"use client"

import React, { useState, useEffect, useRef } from "react"
import { diagrams } from "./diagrams"

/**
 * Re-fits the viewport whenever the React Flow container resizes.
 * Defined at module scope so its component identity is stable across
 * re-renders of FlowDiagram (otherwise React would unmount/remount it
 * on every parent render and tear down the ResizeObserver each time).
 */
function FitOnResize({
  useReactFlow,
}: {
  useReactFlow: typeof import("@xyflow/react").useReactFlow
}) {
  const { fitView } = useReactFlow()
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = containerRef.current?.closest(".react-flow") as HTMLElement | null
    if (!el) return
    const observer = new ResizeObserver(() => {
      fitView({ padding: 0.15 })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fitView])

  return <div ref={containerRef} style={{ display: "none" }} />
}

/**
 * FlowDiagram renders an interactive React Flow diagram.
 * Loaded lazily to avoid bundling the entire @xyflow/react library on pages that don't use it.
 * Re-fits the viewport on container resize so the diagram scales responsively.
 *
 * Usage in markdown:
 *   {% flowDiagram name="bead-lifecycle" /%}
 *   {% flowDiagram name="adversarial-loop" height="500px" /%}
 */
export function FlowDiagram({ name, height = "400px" }: { name: string; height?: string }) {
  const [mod, setMod] = useState<typeof import("@xyflow/react") | null>(null)
  const [cssLoaded, setCssLoaded] = useState(false)

  useEffect(() => {
    Promise.all([import("@xyflow/react"), import("@xyflow/react/dist/style.css").then(() => setCssLoaded(true))]).then(
      ([xyflow]) => {
        setMod(xyflow)
      },
    )
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

  const { ReactFlow, Background, BackgroundVariant, useReactFlow, ReactFlowProvider } = mod

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
        <ReactFlowProvider>
          <ReactFlow
            nodes={diagram.nodes}
            edges={diagram.edges}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.1}
            maxZoom={1}
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
            <FitOnResize useReactFlow={useReactFlow} />
          </ReactFlow>
        </ReactFlowProvider>
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
