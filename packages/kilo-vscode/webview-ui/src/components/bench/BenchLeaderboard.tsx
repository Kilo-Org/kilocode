import { createSignal, createMemo, For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useVSCode } from "../../context/vscode"

interface ModelResult {
  modelId: string
  modelName: string
  aggregateScore: number
  modeScores: Record<string, number>
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTime: number
}

interface BenchLeaderboardProps {
  results: ModelResult[]
}

type SortKey = "score" | "cost" | "time"

export function BenchLeaderboard(props: BenchLeaderboardProps) {
  const vscode = useVSCode()
  const [sortKey, setSortKey] = createSignal<SortKey>("score")
  const [sortAsc, setSortAsc] = createSignal(false)

  const sorted = createMemo(() => {
    return [...props.results].sort((a, b) => {
      let diff = 0
      switch (sortKey()) {
        case "score":
          diff = a.aggregateScore - b.aggregateScore
          break
        case "cost":
          diff = a.totalCost - b.totalCost
          break
        case "time":
          diff = a.totalTime - b.totalTime
          break
      }
      return sortAsc() ? diff : -diff
    })
  })

  const toggleSort = (key: SortKey) => {
    if (sortKey() === key) {
      setSortAsc(!sortAsc())
    } else {
      setSortKey(key)
      setSortAsc(key === "cost" || key === "time")
    }
  }

  const handleUseModel = (modelId: string) => {
    vscode.postMessage({ type: "benchSetActiveModel", benchModelId: modelId } as any)
  }

  const thStyle = {
    "text-align": "right" as const,
    padding: "8px 12px",
    "font-size": "11px",
    color: "var(--vscode-descriptionForeground)",
    "font-weight": "500",
    cursor: "pointer",
  }

  const tdStyle = {
    padding: "8px 12px",
    "font-size": "12px",
    "border-top": "1px solid var(--vscode-panel-border)",
  }

  return (
    <div>
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "12px" }}>
        <Icon name="layers" />
        <h4 style={{ "font-size": "13px", "font-weight": "500", margin: 0, color: "var(--vscode-foreground)" }}>
          Leaderboard
        </h4>
      </div>

      <div
        style={{
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", "border-collapse": "collapse", "font-size": "12px" }}>
          <thead>
            <tr style={{ background: "var(--vscode-editor-background)" }}>
              <th style={{ ...thStyle, "text-align": "left", cursor: "default" }}>#</th>
              <th style={{ ...thStyle, "text-align": "left", cursor: "default" }}>Model</th>
              <th style={thStyle} onClick={() => toggleSort("score")}>
                Score {sortKey() === "score" ? (sortAsc() ? "↑" : "↓") : ""}
              </th>
              <th style={thStyle} onClick={() => toggleSort("cost")}>
                Cost {sortKey() === "cost" ? (sortAsc() ? "↑" : "↓") : ""}
              </th>
              <th style={thStyle} onClick={() => toggleSort("time")}>
                Time {sortKey() === "time" ? (sortAsc() ? "↑" : "↓") : ""}
              </th>
              <th style={{ ...thStyle, "text-align": "right", cursor: "default" }}>Tokens</th>
              <th style={{ ...thStyle, cursor: "default", width: "50px" }} />
            </tr>
          </thead>
          <tbody>
            <For each={sorted()}>
              {(model, idx) => (
                <tr>
                  <td style={{ ...tdStyle, color: "var(--vscode-descriptionForeground)" }}>
                    {idx() === 0 ? "🥇" : idx() === 1 ? "🥈" : idx() === 2 ? "🥉" : idx() + 1}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      color: "var(--vscode-foreground)",
                      "font-weight": "500",
                      "max-width": "150px",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {model.modelName}
                  </td>
                  <td style={{ ...tdStyle, "text-align": "right", "font-family": "monospace", color: "var(--vscode-foreground)" }}>
                    {model.aggregateScore.toFixed(1)}
                  </td>
                  <td style={{ ...tdStyle, "text-align": "right", "font-family": "monospace", color: "var(--vscode-descriptionForeground)" }}>
                    ${model.totalCost.toFixed(4)}
                  </td>
                  <td style={{ ...tdStyle, "text-align": "right", "font-family": "monospace", color: "var(--vscode-descriptionForeground)" }}>
                    {(model.totalTime / 1000).toFixed(1)}s
                  </td>
                  <td style={{ ...tdStyle, "text-align": "right", "font-family": "monospace", color: "var(--vscode-descriptionForeground)" }}>
                    {((model.totalInputTokens + model.totalOutputTokens) / 1000).toFixed(1)}k
                  </td>
                  <td style={{ ...tdStyle, padding: "4px 8px" }}>
                    <Button variant="ghost" size="small" onClick={() => handleUseModel(model.modelId)}>
                      <Icon name="check" />
                      Use
                    </Button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  )
}
