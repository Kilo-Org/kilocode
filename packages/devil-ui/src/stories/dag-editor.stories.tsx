/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { DAGEditor } from "../primitives/dag-editor"
import type { WorkflowDAG, DAGError } from "../primitives/dag-editor"

const meta: Meta = {
  title: "Primitives/DAGEditor",
}

export default meta
type Story = StoryObj

// ─── Sample DAGs ─────────────────────────────────────────────────────────────

const defaultDAG: WorkflowDAG = {
  stages: ["plan", "challenge", "contract", "build", "review", "ship", "retro"],
  edges: [
    { from: "plan", to: "challenge" },
    { from: "challenge", to: "contract" },
    { from: "contract", to: "build" },
    { from: "build", to: "review" },
    { from: "review", to: "ship" },
    { from: "ship", to: "retro" },
  ],
}

const cycleDAG: WorkflowDAG = {
  stages: ["plan", "build", "review"],
  edges: [
    { from: "plan", to: "build" },
    { from: "build", to: "review" },
    { from: "review", to: "build" }, // creates a cycle
  ],
}

const cycleErrors: DAGError[] = [{ kind: "cycle", nodes: ["build", "review"] }]

// ─── Stories ──────────────────────────────────────────────────────────────────

export const Default: Story = {
  render: () => (
    <div style={{ padding: "24px", background: "#1e1e2e", "min-height": "200px" }}>
      <p style={{ color: "#cdd6f4", "font-size": "13px", "margin-bottom": "12px" }}>
        Default 7-stage linear DAG (read-only)
      </p>
      <DAGEditor dag={defaultDAG} readOnly={true} />
    </div>
  ),
}

export const WithErrors: Story = {
  render: () => (
    <div style={{ padding: "24px", background: "#1e1e2e", "min-height": "200px" }}>
      <p style={{ color: "#cdd6f4", "font-size": "13px", "margin-bottom": "12px" }}>
        DAG with cycle error highlighted
      </p>
      <DAGEditor dag={cycleDAG} errors={cycleErrors} readOnly={true} />
    </div>
  ),
}
