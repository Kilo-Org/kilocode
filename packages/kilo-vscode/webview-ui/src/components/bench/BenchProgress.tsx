import { createMemo, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Progress } from "@kilocode/kilo-ui/progress"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { BenchProgress } from "../../types/messages"

interface BenchProgressProps {
  progress: BenchProgress
  isCreditError?: boolean
  onCancel: () => void
  onResume?: () => void
}

export function BenchProgressView(props: BenchProgressProps) {
  const isError = () => props.progress.phase === "error"
  const isRunning = () => props.progress.phase === "running"
  const isGenerating = () => props.progress.phase === "generating"
  const isEvaluating = () => props.progress.phase === "evaluating"
  const isComplete = () => props.progress.phase === "complete"

  const progressPercent = createMemo(() => {
    if (isGenerating()) return 10
    if (isRunning() && props.progress.totalModels && props.progress.totalProblems) {
      const totalWork = props.progress.totalModels * props.progress.totalProblems
      const doneWork =
        (props.progress.modelsCompleted || 0) * props.progress.totalProblems + (props.progress.currentProblem || 0)
      return 10 + (doneWork / totalWork) * 70
    }
    if (isEvaluating()) return 85
    if (isComplete()) return 100
    return 0
  })

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        height: "100%",
        gap: "20px",
        padding: "0 24px",
      }}
    >
      {/* Icon */}
      <div style={{ color: isError() ? "var(--vscode-errorForeground)" : "var(--vscode-foreground)" }}>
        <Show when={isError()}>
          <Icon name="circle-x" size="large" />
        </Show>
        <Show when={isComplete()}>
          <Icon name="circle-check" size="large" />
        </Show>
        <Show when={!isError() && !isComplete()}>
          <Icon name="dot-grid" size="large" />
        </Show>
      </div>

      {/* Phase label */}
      <div style={{ "text-align": "center" }}>
        <div style={{ "font-size": "14px", "font-weight": "500", color: "var(--vscode-foreground)", "margin-bottom": "4px" }}>
          <Show when={isGenerating()}>Generating Problems</Show>
          <Show when={isRunning()}>Running Benchmark</Show>
          <Show when={isEvaluating()}>Evaluating Results</Show>
          <Show when={isComplete()}>Complete</Show>
          <Show when={isError() && !props.isCreditError}>Error</Show>
          <Show when={isError() && props.isCreditError}>Credits Exhausted</Show>
        </div>
        <Show when={props.progress.message}>
          <div style={{ "font-size": "12px", color: "var(--text-weak, var(--vscode-descriptionForeground))", "max-width": "320px" }}>
            {props.progress.message}
          </div>
        </Show>
      </div>

      {/* Progress bar */}
      <Show when={!isError() && !isComplete()}>
        <div style={{ width: "100%", "max-width": "280px" }}>
          <Progress value={progressPercent()} />
          <Show when={isRunning()}>
            <div
              style={{
                display: "flex",
                "justify-content": "space-between",
                "font-size": "10px",
                color: "var(--text-weak, var(--vscode-descriptionForeground))",
                "margin-top": "6px",
              }}
            >
              <Show when={props.progress.currentModel}>
                <span
                  style={{
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                    "max-width": "200px",
                  }}
                >
                  {props.progress.currentModel}
                </span>
              </Show>
              <Show when={props.progress.totalModels}>
                <span>
                  Model {(props.progress.modelsCompleted || 0) + 1}/{props.progress.totalModels}
                </span>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "8px", "margin-top": "8px" }}>
        <Show when={isError() && props.isCreditError && props.onResume}>
          <Button variant="secondary" size="small" onClick={() => props.onResume?.()}>
            <Icon name="chevron-right" />
            Resume Benchmark
          </Button>
        </Show>
        <Button variant="ghost" size="small" onClick={() => props.onCancel()}>
          {isError() ? "Back" : "Cancel"}
        </Button>
      </div>
    </div>
  )
}
