import { createMemo, For, Show } from "solid-js"
import { MODEL_COLORS } from "./BenchRadarChart"

interface ModelResult {
  modelId: string
  modelName: string
  modeScores: Record<string, number>
}

interface BenchModeBreakdownProps {
  results: ModelResult[]
}

const MODE_LABELS: Record<string, string> = {
  architect: "Architect",
  code: "Code",
  debug: "Debug",
  ask: "Ask",
  orchestrator: "Orchestrator",
}

export function BenchModeBreakdown(props: BenchModeBreakdownProps) {
  const modes = createMemo(() => {
    const allModes = new Set<string>()
    props.results.forEach((r) => Object.keys(r.modeScores).forEach((m) => allModes.add(m)))
    return Array.from(allModes)
  })

  return (
    <Show when={props.results.length > 0 && modes().length > 0}>
      <div>
        <h4 style={{ "font-size": "13px", "font-weight": "500", margin: "0 0 12px 0", color: "var(--vscode-foreground)" }}>
          Mode Breakdown
        </h4>
        <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
          <For each={modes()}>
            {(mode) => (
              <div>
                <div
                  style={{
                    "font-size": "12px",
                    "font-weight": "500",
                    color: "var(--vscode-descriptionForeground)",
                    "margin-bottom": "6px",
                  }}
                >
                  {MODE_LABELS[mode] || mode}
                </div>
                <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
                  <For each={props.results}>
                    {(model, mi) => {
                      const score = () => model.modeScores[mode] || 0
                      const pct = () => (score() / 10) * 100
                      return (
                        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                          <div
                            style={{
                              "font-size": "10px",
                              color: "var(--vscode-descriptionForeground)",
                              width: "96px",
                              overflow: "hidden",
                              "text-overflow": "ellipsis",
                              "white-space": "nowrap",
                            }}
                          >
                            {model.modelName}
                          </div>
                          <div
                            style={{
                              flex: 1,
                              height: "8px",
                              background: "var(--vscode-editor-background)",
                              "border-radius": "4px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                "border-radius": "4px",
                                width: `${pct()}%`,
                                "background-color": MODEL_COLORS[mi() % MODEL_COLORS.length],
                                transition: "width 0.3s",
                              }}
                            />
                          </div>
                          <div
                            style={{
                              "font-size": "10px",
                              "font-family": "monospace",
                              color: "var(--vscode-descriptionForeground)",
                              width: "32px",
                              "text-align": "right",
                            }}
                          >
                            {score().toFixed(1)}
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
