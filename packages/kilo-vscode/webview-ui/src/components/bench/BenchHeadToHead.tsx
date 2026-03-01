import { createSignal, createMemo, For, Show } from "solid-js"

interface ProblemResult {
  problemId: string
  mode: string
  evaluation: {
    compositeScore: number
  }
}

interface ModelResult {
  modelId: string
  modelName: string
  problems: ProblemResult[]
  aggregateScore: number
}

interface BenchHeadToHeadProps {
  results: ModelResult[]
}

export function BenchHeadToHead(props: BenchHeadToHeadProps) {
  const [modelA, setModelA] = createSignal(props.results[0]?.modelId || "")
  const [modelB, setModelB] = createSignal(props.results[1]?.modelId || props.results[0]?.modelId || "")

  const resultA = createMemo(() => props.results.find((r) => r.modelId === modelA()))
  const resultB = createMemo(() => props.results.find((r) => r.modelId === modelB()))

  const commonProblems = createMemo(() => {
    const a = resultA()
    const b = resultB()
    if (!a || !b) return []
    return a.problems.filter((pa) => b.problems.some((pb) => pb.problemId === pa.problemId))
  })

  const selectStyle = {
    flex: 1,
    "font-size": "12px",
    background: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
    border: "1px solid var(--vscode-input-border)",
    "border-radius": "4px",
    padding: "4px 8px",
  }

  const thStyle = {
    padding: "8px 12px",
    "font-size": "11px",
    color: "var(--vscode-descriptionForeground)",
    "font-weight": "500",
  }

  const tdStyle = {
    padding: "8px 12px",
    "font-size": "12px",
    "border-top": "1px solid var(--vscode-panel-border)",
  }

  return (
    <Show
      when={props.results.length >= 2}
      fallback={
        <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "text-align": "center", padding: "16px" }}>
          Need at least 2 models for head-to-head comparison
        </div>
      }
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
        <h4 style={{ "font-size": "13px", "font-weight": "500", margin: 0, color: "var(--vscode-foreground)" }}>
          Head-to-Head
        </h4>

        {/* Model selectors */}
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <select
            style={selectStyle}
            value={modelA()}
            onChange={(e) => setModelA(e.currentTarget.value)}
          >
            <For each={props.results}>
              {(r) => <option value={r.modelId}>{r.modelName}</option>}
            </For>
          </select>
          <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>vs</span>
          <select
            style={selectStyle}
            value={modelB()}
            onChange={(e) => setModelB(e.currentTarget.value)}
          >
            <For each={props.results}>
              {(r) => <option value={r.modelId}>{r.modelName}</option>}
            </For>
          </select>
        </div>

        {/* Comparison table */}
        <Show when={resultA() && resultB()}>
          <div
            style={{
              border: "1px solid var(--vscode-panel-border)",
              "border-radius": "4px",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", "border-collapse": "collapse" }}>
              <thead>
                <tr style={{ background: "var(--vscode-editor-background)" }}>
                  <th style={{ ...thStyle, "text-align": "left" }}>Problem</th>
                  <th style={{ ...thStyle, "text-align": "right", "max-width": "80px", overflow: "hidden", "text-overflow": "ellipsis" }}>
                    {resultA()!.modelName}
                  </th>
                  <th style={{ ...thStyle, "text-align": "right", "max-width": "80px", overflow: "hidden", "text-overflow": "ellipsis" }}>
                    {resultB()!.modelName}
                  </th>
                  <th style={{ ...thStyle, "text-align": "center" }}>Winner</th>
                </tr>
              </thead>
              <tbody>
                <For each={commonProblems()}>
                  {(pa) => {
                    const pb = () => resultB()?.problems.find((p) => p.problemId === pa.problemId)
                    const scoreA = () => pa.evaluation.compositeScore
                    const scoreB = () => pb()?.evaluation.compositeScore ?? 0
                    const winner = () => (scoreA() > scoreB() ? "A" : scoreB() > scoreA() ? "B" : "tie")

                    return (
                      <tr>
                        <td style={tdStyle}>
                          <div style={{ "font-size": "10px", color: "var(--vscode-descriptionForeground)" }}>
                            {pa.mode}
                          </div>
                          <div
                            style={{
                              "font-size": "12px",
                              color: "var(--vscode-foreground)",
                              overflow: "hidden",
                              "text-overflow": "ellipsis",
                              "white-space": "nowrap",
                              "max-width": "150px",
                            }}
                          >
                            {pa.problemId}
                          </div>
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            "text-align": "right",
                            "font-family": "monospace",
                            color: winner() === "A" ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                            "font-weight": winner() === "A" ? "700" : "400",
                          }}
                        >
                          {scoreA().toFixed(1)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            "text-align": "right",
                            "font-family": "monospace",
                            color: winner() === "B" ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                            "font-weight": winner() === "B" ? "700" : "400",
                          }}
                        >
                          {scoreB().toFixed(1)}
                        </td>
                        <td style={{ ...tdStyle, "text-align": "center", "font-size": "10px" }}>
                          {winner() === "tie" ? (
                            <span style={{ color: "var(--vscode-descriptionForeground)" }}>Tie</span>
                          ) : winner() === "A" ? (
                            <span style={{ color: "var(--vscode-foreground)" }}>{resultA()!.modelName.slice(0, 15)}</span>
                          ) : (
                            <span style={{ color: "var(--vscode-foreground)" }}>{resultB()!.modelName.slice(0, 15)}</span>
                          )}
                        </td>
                      </tr>
                    )
                  }}
                </For>
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div style={{ display: "flex", "justify-content": "space-between", "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
            <span>{resultA()!.modelName}: {resultA()!.aggregateScore.toFixed(1)} avg</span>
            <span>{resultB()!.modelName}: {resultB()!.aggregateScore.toFixed(1)} avg</span>
          </div>
        </Show>
      </div>
    </Show>
  )
}
