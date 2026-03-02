import { createMemo, For, Show } from "solid-js"
import { MODEL_COLORS } from "./BenchRadarChart"

interface ModelResult {
  modelId: string
  modelName: string
  aggregateScore: number
  totalCost: number
}

interface BenchCostOptimizerProps {
  results: ModelResult[]
}

export function BenchCostOptimizer(props: BenchCostOptimizerProps) {
  const width = 280
  const height = 180
  const padding = { top: 20, right: 20, bottom: 30, left: 40 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const maxScore = createMemo(() => Math.max(...props.results.map((r) => r.aggregateScore), 1))
  const maxCost = createMemo(() => Math.max(...props.results.map((r) => r.totalCost), 0.001))

  const scaleX = (cost: number) => padding.left + (cost / maxCost()) * plotW
  const scaleY = (score: number) => padding.top + plotH - (score / maxScore()) * plotH

  const bestValue = createMemo(() => {
    return props.results.reduce(
      (best, r) => {
        const ratio = r.totalCost > 0 ? r.aggregateScore / r.totalCost : 0
        return ratio > best.ratio ? { model: r.modelName, ratio } : best
      },
      { model: "", ratio: 0 },
    )
  })

  return (
    <Show when={props.results.length > 0}>
      <div>
        <h4 style={{ "font-size": "13px", "font-weight": "500", margin: "0 0 12px 0", color: "var(--vscode-foreground)" }}>
          Cost vs Quality
        </h4>

        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: "block", margin: "0 auto" }}
        >
          {/* Grid lines */}
          <For each={[0.25, 0.5, 0.75, 1]}>
            {(pct) => (
              <g>
                <line
                  x1={padding.left}
                  y1={padding.top + plotH * (1 - pct)}
                  x2={padding.left + plotW}
                  y2={padding.top + plotH * (1 - pct)}
                  stroke="var(--vscode-panel-border)"
                  stroke-width={0.5}
                  opacity={0.3}
                />
                <line
                  x1={padding.left + plotW * pct}
                  y1={padding.top}
                  x2={padding.left + plotW * pct}
                  y2={padding.top + plotH}
                  stroke="var(--vscode-panel-border)"
                  stroke-width={0.5}
                  opacity={0.3}
                />
              </g>
            )}
          </For>

          {/* Axes */}
          <line
            x1={padding.left}
            y1={padding.top + plotH}
            x2={padding.left + plotW}
            y2={padding.top + plotH}
            stroke="var(--vscode-panel-border)"
            stroke-width={1}
          />
          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={padding.top + plotH}
            stroke="var(--vscode-panel-border)"
            stroke-width={1}
          />

          {/* Axis labels */}
          <text
            x={padding.left + plotW / 2}
            y={height - 4}
            text-anchor="middle"
            font-size={9}
            fill="var(--vscode-descriptionForeground)"
          >
            Cost ($)
          </text>
          <text
            x={10}
            y={padding.top + plotH / 2}
            text-anchor="middle"
            font-size={9}
            fill="var(--vscode-descriptionForeground)"
            transform={`rotate(-90, 10, ${padding.top + plotH / 2})`}
          >
            Score
          </text>

          {/* Data points */}
          <For each={props.results}>
            {(r, i) => {
              const x = () => scaleX(r.totalCost)
              const y = () => scaleY(r.aggregateScore)
              const color = () => MODEL_COLORS[i() % MODEL_COLORS.length]
              return (
                <g>
                  <circle cx={x()} cy={y()} r={5} fill={color()} fill-opacity={0.7} stroke={color()} stroke-width={1} />
                  <text x={x()} y={y() - 8} text-anchor="middle" font-size={8} fill="var(--vscode-descriptionForeground)">
                    {r.modelName.length > 15 ? r.modelName.slice(0, 12) + "..." : r.modelName}
                  </text>
                </g>
              )
            }}
          </For>
        </svg>

        <Show when={bestValue().model}>
          <div style={{ "text-align": "center", "font-size": "10px", color: "var(--vscode-descriptionForeground)", "margin-top": "8px" }}>
            Best value: <span style={{ color: "var(--vscode-foreground)", "font-weight": "500" }}>{bestValue().model}</span>
          </div>
        </Show>
      </div>
    </Show>
  )
}
