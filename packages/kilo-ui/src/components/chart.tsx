/** @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup } from "solid-js"
import { BasicTool } from "./basic-tool"
import type { ToolProps } from "./message-part"
import { busy } from "./tool-utils"

function getThemeColors() {
  const style = getComputedStyle(document.documentElement)
  const get = (v: string, fallback: string) => style.getPropertyValue(v).trim() || fallback
  return {
    text: get("--text-base", "#FAFAFA"),
    textWeak: get("--text-weak", "#A3A3A3"),
    border: get("--border-weak-base", "#FFFFFF1A"),
    surface: get("--surface-raised-base", "#202020"),
    series: ["#3B82F6", "#00BAA9", "#22C55E", "#F97316", "#A855F7", "#EF4444"],
  }
}

type ChartConfig = {
  type: string
  data: {
    labels?: string[]
    datasets: {
      label?: string
      data: number[] | { x: number | string; y: number; r?: number }[]
      backgroundColor?: string | string[]
      borderColor?: string | string[]
      [key: string]: unknown
    }[]
  }
  options?: Record<string, unknown>
}

export function ChartTool(props: ToolProps) {
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>()
  const [error, setError] = createSignal<string>()

  let rendered = false

  createEffect(() => {
    const el = canvas()
    const raw = props.output
    if (!el || !raw || busy(props.status) || rendered) return

    let config: ChartConfig
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || !parsed.type || !parsed.data) {
        setError("Invalid chart config — must include type and data")
        return
      }
      config = parsed
    } catch {
      // not valid JSON (e.g. mermaid or error string) — skip silently
      return
    }

    rendered = true

    const colors = getThemeColors()
    const isPolar = config.type === "pie" || config.type === "doughnut" || config.type === "polarArea"

    const datasets = config.data.datasets.map((dataset, i) => {
      if (dataset.backgroundColor) return dataset
      if (isPolar) {
        const data = dataset.data as unknown[]
        return {
          ...dataset,
          backgroundColor: data.map((_, j) => colors.series[j % colors.series.length]),
          borderColor: data.map((_, j) => colors.series[j % colors.series.length]),
        }
      }
      return {
        backgroundColor: colors.series[i % colors.series.length],
        borderColor: colors.series[i % colors.series.length],
        ...dataset,
      }
    })

    import("chart.js").then(({ Chart, registerables }) => {
      if (!el.isConnected) return
      Chart.register(...registerables)
      const chart = new Chart(el, {
        type: config.type as any,
        data: { ...config.data, datasets } as any,
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
      })
      onCleanup(() => chart.destroy())
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to render chart")
    })
  })

  return (
    <BasicTool
      {...props}
      icon="bullet-list"
      trigger={{
        title: props.input?.title ?? "Chart",
        subtitle: props.input?.description ?? undefined,
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
