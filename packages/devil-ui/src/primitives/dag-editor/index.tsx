/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js"
import type { DAGEditorProps, DAGError, WorkflowStage } from "./types"

export type { WorkflowStage, WorkflowDAG, WorkflowDAGEdge, DAGError, DAGEditorProps } from "./types"

export function DAGEditor(props: DAGEditorProps) {
  const stageNodes = createMemo(() =>
    props.dag.stages.map((stage, i) => ({
      stage,
      index: i,
      nextEdge: props.dag.edges.find((e) => e.from === stage),
    })),
  )

  const hasError = (stage: string) =>
    props.errors?.some(
      (e) =>
        (e.kind === "cycle" && "nodes" in e && (e.nodes as string[]).includes(stage)) ||
        (e.kind === "unreachable" && "stages" in e && (e.stages as string[]).includes(stage)) ||
        (e.kind === "self-loop" && "stage" in e && e.stage === stage),
    ) ?? false

  return (
    <div class={`dag-editor${props.class ? ` ${props.class}` : ""}`} aria-label="Workflow DAG editor">
      <div class="dag-stages" role="list">
        <For each={stageNodes()}>
          {(node) => (
            <div
              class={`dag-node${hasError(node.stage) ? " dag-node-error" : ""}`}
              data-stage={node.stage}
              role="listitem"
            >
              <span class="dag-node-label">{node.stage}</span>
              <Show when={node.nextEdge}>
                <span class="dag-node-arrow" aria-hidden="true">
                  →
                </span>
                <span class="dag-node-target">{node.nextEdge!.to}</span>
              </Show>
            </div>
          )}
        </For>
      </div>
      <Show when={(props.errors?.length ?? 0) > 0}>
        <div class="dag-errors" role="alert" aria-live="polite">
          <For each={props.errors}>
            {(err) => <div class="dag-error">{localFormatDAGError(err)}</div>}
          </For>
        </div>
      </Show>
    </div>
  )
}

function localFormatDAGError(err: DAGError): string {
  switch (err.kind) {
    case "cycle":
      return `Cycle detected: ${(err.nodes as WorkflowStage[]).join(" → ")}`
    case "unreachable":
      return `Unreachable stages: ${(err.stages as WorkflowStage[]).join(", ")}`
    case "self-loop":
      return `Self-loop on ${err.stage}`
    case "no-entry":
      return "No entry stage (all stages have incoming edges)"
    case "multiple-entries":
      return `Multiple entry stages: ${err.stages.join(", ")}`
    case "missing-capability":
      return `Missing capability for ${err.stage}: ${err.required.join(", ")}`
    case "unknown-stage":
      return `Unknown stage: ${err.stage}`
    default:
      return "Unknown DAG error"
  }
}
