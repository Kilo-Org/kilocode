import { splitProps, type ComponentProps, type JSX } from "solid-js"

export type ChartConfig = Record<
  string,
  {
    label?: JSX.Element
    color?: string
    theme?: Record<"light" | "dark", string>
  }
>

export function ChartContainer(
  props: ComponentProps<"div"> & { config: ChartConfig; initialDimension?: { width: number; height: number } },
) {
  const [local, rest] = splitProps(props, ["config", "initialDimension", "class", "classList", "children"])
  return (
    <div {...rest} data-slot="chart" classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}>
      {local.children}
    </div>
  )
}

export function ChartTooltip(props: ComponentProps<"div">) {
  return <div {...props} data-slot="chart-tooltip" />
}

export function ChartTooltipContent(props: ComponentProps<"div">) {
  return <div {...props} data-slot="chart-tooltip-content" />
}

export function ChartLegend(props: ComponentProps<"div">) {
  return <div {...props} data-slot="chart-legend" />
}

export function ChartLegendContent(props: ComponentProps<"div">) {
  return <div {...props} data-slot="chart-legend-content" />
}

export function ChartStyle() {
  return null
}
