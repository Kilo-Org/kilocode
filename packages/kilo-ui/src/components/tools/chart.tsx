/** @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup } from "solid-js"
import type { ChartConfiguration, ChartType } from "chart.js"
import { BasicTool } from "../basic-tool"
import type { ToolProps } from "../message-part"
import { busy } from "../tool-utils"

/** The tool id the client renderer is registered under. */
export const ChartToolName = "chart"

type ChartPoint = number | { x: number | string; y: number; r?: number }

export type ChartDataset = {
  label?: string
  data: ChartPoint[]
  backgroundColor?: string | string[]
  borderColor?: string | string[]
  [key: string]: unknown
}

export type ChartConfig = {
  type: string
  data: {
    labels?: Array<string | number>
    datasets: ChartDataset[]
  }
  options?: Record<string, unknown>
}

export type ChartColors = {
  readonly text: string
  readonly textWeak: string
  readonly border: string
  readonly series: readonly string[]
}

export type ChartParseResult =
  | { readonly kind: "ok"; readonly config: ChartConfig }
  | { readonly kind: "unparseable" }
  | { readonly kind: "invalid" }

/** Parse a tool output string into a Chart.js configuration, or report why it cannot render. */
export function parseChartConfig(raw: string): ChartParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "unparseable" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "invalid" }
  const config = parsed as Record<string, unknown>
  if (!config.type || !config.data || typeof config.data !== "object") return { kind: "invalid" }
  return { kind: "ok", config: parsed as ChartConfig }
}

/** Fill in the colors the theme provides and leave explicit dataset colors untouched. */
export function styleChartConfig(config: ChartConfig, colors: ChartColors): ChartConfig {
  const polar = config.type === "pie" || config.type === "doughnut" || config.type === "polarArea"
  const datasets = config.data.datasets.map((dataset, index) => {
    if (dataset.backgroundColor) return dataset
    if (polar)
      return {
        ...dataset,
        backgroundColor: dataset.data.map((_, point) => colors.series[point % colors.series.length]),
        borderColor: dataset.data.map((_, point) => colors.series[point % colors.series.length]),
      }
    return {
      backgroundColor: colors.series[index % colors.series.length],
      borderColor: colors.series[index % colors.series.length],
      ...dataset,
    }
  })
  return { ...config, data: { ...config.data, datasets } }
}

export function chartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    text: get("--text-base", "#FAFAFA"),
    textWeak: get("--text-weak", "#A3A3A3"),
    border: get("--border-weak-base", "#FFFFFF1A"),
    series: [
      get("--vscode-charts-blue", "#3B82F6"),
      get("--vscode-charts-green", "#22C55E"),
      get("--vscode-charts-purple", "#A855F7"),
      get("--vscode-charts-orange", "#F97316"),
      get("--vscode-charts-red", "#EF4444"),
      get("--vscode-charts-yellow", "#EAB308"),
    ],
  }
}

let chartjs: Promise<typeof import("chart.js")> | undefined
const loadChart = () => (chartjs ??= import("chart.js"))

export function ChartTool(props: ToolProps) {
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>()
  const [error, setError] = createSignal<string>()

  createEffect(() => {
    const el = canvas()
    const raw = props.output
    if (!el || !raw || busy(props.status)) return

    const parsed = parseChartConfig(raw)
    if (parsed.kind === "unparseable") return
    if (parsed.kind === "invalid") {
      setError("Invalid chart config: must include type and data")
      return
    }

    const colors = chartColors()
    const config = styleChartConfig(parsed.config, colors)

    let disposed = false
    let chart: { destroy: () => void } | undefined

    onCleanup(() => {
      disposed = true
      chart?.destroy()
    })

    void loadChart()
      .then(({ Chart, registerables }) => {
        if (disposed || !el.isConnected) return
        Chart.register(...registerables)
        chart = new Chart(el, {
          type: config.type as ChartType,
          data: config.data,
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
              legend: {
                labels: { color: colors.textWeak },
              },
            },
            scales: {
              x: {
                ticks: { color: colors.textWeak },
                grid: { color: colors.border },
                border: { color: colors.border },
              },
              y: {
                ticks: { color: colors.textWeak },
                grid: { color: colors.border },
                border: { color: colors.border },
              },
            },
            ...config.options,
          },
        } as ChartConfiguration)
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setError(cause instanceof Error ? cause.message : "Failed to render chart")
      })
  })

  return (
    <BasicTool
      {...props}
      icon="bullet-list"
      trigger={{
        title: typeof props.input.title === "string" ? props.input.title : "Chart",
        subtitle: typeof props.input.description === "string" ? props.input.description : undefined,
        args: [],
      }}
      defaultOpen={props.defaultOpen ?? true}
    >
      <div data-component="chart-container">
        {error() ? <div data-slot="chart-error">{error()}</div> : <canvas ref={setCanvas} data-slot="chart-render" />}
      </div>
    </BasicTool>
  )
}