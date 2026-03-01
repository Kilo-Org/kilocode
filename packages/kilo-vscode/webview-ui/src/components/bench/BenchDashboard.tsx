import { createSignal, createMemo, Switch, Match } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { BenchLeaderboard } from "./BenchLeaderboard"
import { BenchRadarChart, MODEL_COLORS } from "./BenchRadarChart"
import { BenchModeBreakdown } from "./BenchModeBreakdown"
import { BenchHeadToHead } from "./BenchHeadToHead"
import { BenchCostOptimizer } from "./BenchCostOptimizer"
import { BenchSettings } from "./BenchSettings"
import type { BenchRunResult } from "../../types/messages"

type DashboardSection = "overview" | "headToHead" | "cost" | "settings"

interface BenchDashboardProps {
  result: BenchRunResult
  onNewBenchmark: () => void
}

export function BenchDashboard(props: BenchDashboardProps) {
  const [section, setSection] = createSignal<DashboardSection>("overview")

  const radarSeries = createMemo(() => {
    return props.result.results.map((model, mi) => {
      const avgQuality =
        model.problems.reduce((s, p) => s + p.evaluation.qualityScore, 0) / (model.problems.length || 1)
      const avgRelevance =
        model.problems.reduce((s, p) => s + p.evaluation.relevanceScore, 0) / (model.problems.length || 1)
      const avgSpeed =
        model.problems.reduce((s, p) => s + p.evaluation.speedScore, 0) / (model.problems.length || 1)
      const avgCost =
        model.problems.reduce((s, p) => s + p.evaluation.costScore, 0) / (model.problems.length || 1)

      return {
        modelName: model.modelName,
        color: MODEL_COLORS[mi % MODEL_COLORS.length],
        data: [
          { label: "Quality", value: avgQuality },
          { label: "Relevance", value: avgRelevance },
          { label: "Speed", value: avgSpeed },
          { label: "Cost", value: avgCost },
        ],
      }
    })
  })

  const tabStyle = (key: DashboardSection) => ({
    display: "flex",
    "align-items": "center",
    gap: "4px",
    padding: "6px 10px",
    "font-size": "12px",
    "border-radius": "4px 4px 0 0",
    cursor: "pointer",
    border: "none",
    background: section() === key ? "var(--vscode-editor-background)" : "transparent",
    color: section() === key ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
    "border-bottom": section() === key ? "2px solid var(--vscode-focusBorder)" : "2px solid transparent",
  })

  return (
    <Switch>
      <Match when={section() === "settings"}>
        <BenchSettings onClose={() => setSection("overview")} />
      </Match>
      <Match when={section() !== "settings"}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
          {/* Header */}
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
            <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
              {props.result.results.length} model{props.result.results.length !== 1 ? "s" : ""} benchmarked
              {" · "}
              {new Date(props.result.runAt).toLocaleDateString()}
            </div>
            <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
              <Button variant="ghost" size="small" onClick={() => props.onNewBenchmark()}>
                <Icon name="edit" />
                New Run
              </Button>
              <Button variant="ghost" size="small" onClick={() => setSection("settings")}>
                <Icon name="settings-gear" />
              </Button>
            </div>
          </div>

          {/* Section tabs */}
          <div style={{ display: "flex", "align-items": "center", gap: "4px", "border-bottom": "1px solid var(--vscode-panel-border)", "padding-bottom": "0" }}>
            <button style={tabStyle("overview")} onClick={() => setSection("overview")}>
              <Icon name="layers" />
              Overview
            </button>
            <button style={tabStyle("headToHead")} onClick={() => setSection("headToHead")}>
              <Icon name="chevron-grabber-vertical" />
              Head-to-Head
            </button>
            <button style={tabStyle("cost")} onClick={() => setSection("cost")}>
              <Icon name="sliders" />
              Cost
            </button>
          </div>

          {/* Section content */}
          <Switch>
            <Match when={section() === "overview"}>
              <BenchLeaderboard results={props.result.results} />
              <BenchRadarChart series={radarSeries()} />
              <BenchModeBreakdown results={props.result.results} />
            </Match>
            <Match when={section() === "headToHead"}>
              <BenchHeadToHead results={props.result.results} />
            </Match>
            <Match when={section() === "cost"}>
              <BenchCostOptimizer results={props.result.results} />
            </Match>
          </Switch>
        </div>
      </Match>
    </Switch>
  )
}
