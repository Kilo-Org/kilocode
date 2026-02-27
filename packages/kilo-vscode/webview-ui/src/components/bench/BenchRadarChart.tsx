import { For, Show } from "solid-js"

interface RadarDataPoint {
  label: string
  value: number
}

interface RadarSeries {
  modelName: string
  data: RadarDataPoint[]
  color: string
}

interface BenchRadarChartProps {
  series: RadarSeries[]
  size?: number
}

export const MODEL_COLORS = [
  "var(--vscode-charts-blue)",
  "var(--vscode-charts-red)",
  "var(--vscode-charts-green)",
  "var(--vscode-charts-yellow)",
  "var(--vscode-charts-purple)",
  "var(--vscode-charts-orange)",
]

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const radians = (angle - 90) * (Math.PI / 180)
  return {
    x: cx + r * Math.cos(radians),
    y: cy + r * Math.sin(radians),
  }
}

export function BenchRadarChart(props: BenchRadarChartProps) {
  const size = () => props.size ?? 220

  return (
    <Show
      when={props.series.length > 0 && props.series[0].data.length > 0}
      fallback={
        <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "text-align": "center", padding: "16px" }}>
          No data for radar chart
        </div>
      }
    >
      <div>
        <svg
          width={size()}
          height={size()}
          viewBox={`0 0 ${size()} ${size()}`}
          style={{ display: "block", margin: "0 auto" }}
        >
          {(() => {
            const cx = size() / 2
            const cy = size() / 2
            const maxRadius = size() / 2 - 30
            const numAxes = props.series[0].data.length
            const angleStep = 360 / numAxes
            const rings = [2, 4, 6, 8, 10]

            return (
              <>
                {/* Grid rings */}
                <For each={rings}>
                  {(ring) => (
                    <polygon
                      points={Array.from({ length: numAxes }, (_, i) => {
                        const p = polarToCartesian(cx, cy, (ring / 10) * maxRadius, i * angleStep)
                        return `${p.x},${p.y}`
                      }).join(" ")}
                      fill="none"
                      stroke="var(--vscode-panel-border)"
                      stroke-width={0.5}
                      opacity={0.5}
                    />
                  )}
                </For>

                {/* Axis lines */}
                <For each={props.series[0].data}>
                  {(_, i) => {
                    const end = () => polarToCartesian(cx, cy, maxRadius, i() * angleStep)
                    return (
                      <line
                        x1={cx}
                        y1={cy}
                        x2={end().x}
                        y2={end().y}
                        stroke="var(--vscode-panel-border)"
                        stroke-width={0.5}
                        opacity={0.5}
                      />
                    )
                  }}
                </For>

                {/* Data polygons */}
                <For each={props.series}>
                  {(s, si) => {
                    const points = () =>
                      s.data
                        .map((d, i) => {
                          const r = (Math.max(0, Math.min(10, d.value)) / 10) * maxRadius
                          const p = polarToCartesian(cx, cy, r, i * angleStep)
                          return `${p.x},${p.y}`
                        })
                        .join(" ")
                    const color = () => s.color || MODEL_COLORS[si() % MODEL_COLORS.length]

                    return (
                      <g>
                        <polygon
                          points={points()}
                          fill={color()}
                          fill-opacity={0.15}
                          stroke={color()}
                          stroke-width={1.5}
                        />
                        <For each={s.data}>
                          {(d, i) => {
                            const p = () => {
                              const r = (Math.max(0, Math.min(10, d.value)) / 10) * maxRadius
                              return polarToCartesian(cx, cy, r, i() * angleStep)
                            }
                            return <circle cx={p().x} cy={p().y} r={2.5} fill={color()} />
                          }}
                        </For>
                      </g>
                    )
                  }}
                </For>

                {/* Axis labels */}
                <For each={props.series[0].data}>
                  {(d, i) => {
                    const labelPos = () => polarToCartesian(cx, cy, maxRadius + 14, i() * angleStep)
                    return (
                      <text
                        x={labelPos().x}
                        y={labelPos().y}
                        text-anchor="middle"
                        dominant-baseline="central"
                        font-size={9}
                        fill="var(--vscode-descriptionForeground)"
                      >
                        {d.label}
                      </text>
                    )
                  }}
                </For>
              </>
            )
          })()}
        </svg>

        {/* Legend */}
        <Show when={props.series.length > 1}>
          <div
            style={{
              display: "flex",
              "flex-wrap": "wrap",
              "justify-content": "center",
              gap: "12px",
              "font-size": "10px",
              "margin-top": "8px",
            }}
          >
            <For each={props.series}>
              {(s, si) => (
                <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
                  <div
                    style={{
                      width: "10px",
                      height: "10px",
                      "border-radius": "50%",
                      "background-color": s.color || MODEL_COLORS[si() % MODEL_COLORS.length],
                    }}
                  />
                  <span
                    style={{
                      color: "var(--vscode-descriptionForeground)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                      "max-width": "100px",
                    }}
                  >
                    {s.modelName}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
