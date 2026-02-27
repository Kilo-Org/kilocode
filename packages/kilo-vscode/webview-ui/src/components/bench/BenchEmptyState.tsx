import { Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"

interface CheckpointInfo {
  models: string[]
  phase: string
  progress: string
}

interface BenchEmptyStateProps {
  onStartBenchmark: () => void
  checkpoint?: CheckpointInfo | null
  onResume?: () => void
  onDiscardCheckpoint?: () => void
}

export function BenchEmptyState(props: BenchEmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        height: "100%",
        gap: "16px",
        padding: "0 24px",
        "text-align": "center",
      }}
    >
      {/* Resume banner */}
      <Show when={props.checkpoint}>
        {(cp) => (
          <div
            style={{
              width: "100%",
              "max-width": "360px",
              padding: "12px 16px",
              "border-radius": "6px",
              border: "1px solid var(--vscode-editorWarning-foreground, #cca700)",
              background: "var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.1))",
              "text-align": "left",
              "margin-bottom": "8px",
            }}
          >
            <div style={{ "font-size": "13px", "font-weight": "500", color: "var(--vscode-foreground)", "margin-bottom": "4px" }}>
              Interrupted Benchmark
            </div>
            <div style={{ "font-size": "12px", color: "var(--text-weak, var(--vscode-descriptionForeground))", "margin-bottom": "8px" }}>
              {cp().progress} — stopped during {cp().phase} phase.
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <Button size="small" onClick={() => props.onResume?.()}>
                <Icon name="chevron-right" />
                Resume
              </Button>
              <Button variant="ghost" size="small" onClick={() => props.onDiscardCheckpoint?.()}>
                Discard
              </Button>
            </div>
          </div>
        )}
      </Show>

      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          width: "48px",
          height: "48px",
          "border-radius": "8px",
          background: "var(--surface-interactive-hover, var(--vscode-list-hoverBackground))",
          color: "var(--icon-base, var(--vscode-foreground))",
        }}
      >
        <Icon name="layers" size="large" />
      </div>

      <div>
        <h3 style={{ "font-size": "16px", "font-weight": "600", margin: "0 0 8px 0", color: "var(--vscode-foreground)" }}>
          Benchmark Your Models
        </h3>
        <p style={{ "font-size": "13px", color: "var(--vscode-descriptionForeground)", margin: 0, "max-width": "320px" }}>
          Test AI models against your codebase across all 5 Kilo modes. Auto-generates problems, runs each model, and
          scores results with an AI judge.
        </p>
      </div>

      <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "max-width": "320px", "text-align": "left" }}>
        <div style={{ display: "flex", "align-items": "flex-start", gap: "8px", "margin-bottom": "6px" }}>
          <span style={{ color: "var(--vscode-foreground)", "font-weight": "500", "flex-shrink": 0 }}>1.</span>
          <span>Select models to benchmark</span>
        </div>
        <div style={{ display: "flex", "align-items": "flex-start", gap: "8px", "margin-bottom": "6px" }}>
          <span style={{ color: "var(--vscode-foreground)", "font-weight": "500", "flex-shrink": 0 }}>2.</span>
          <span>Problems are auto-generated from your workspace</span>
        </div>
        <div style={{ display: "flex", "align-items": "flex-start", gap: "8px", "margin-bottom": "6px" }}>
          <span style={{ color: "var(--vscode-foreground)", "font-weight": "500", "flex-shrink": 0 }}>3.</span>
          <span>Each model runs every problem using real Kilo mode prompts</span>
        </div>
        <div style={{ display: "flex", "align-items": "flex-start", gap: "8px" }}>
          <span style={{ color: "var(--vscode-foreground)", "font-weight": "500", "flex-shrink": 0 }}>4.</span>
          <span>An AI judge scores quality, relevance, speed, and cost</span>
        </div>
      </div>

      <Button onClick={() => props.onStartBenchmark()} style={{ "margin-top": "8px" }}>
        Run Benchmark
      </Button>
    </div>
  )
}
