import { afterEach, expect, test } from "bun:test"
import {
  ChartTool,
  ChartToolName,
  parseChartConfig,
  styleChartConfig,
  type ChartColors,
} from "../src/components/tools/chart"
import { ToolRegistry } from "../src/components/message-part"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { mountTool, waitFor, type Mounted } from "./harness"

ToolRegistry.register({ name: ChartToolName, render: ChartTool })

const colors: ChartColors = {
  text: "#ffffff",
  textWeak: "#a3a3a3",
  border: "#ffffff1a",
  series: ["#3b82f6", "#22c55e", "#a855f7"],
}

const revenue = {
  type: "bar",
  data: {
    labels: ["Jan", "Feb", "Mar"],
    datasets: [
      { label: "Revenue", data: [12, 19, 14] },
      { label: "Costs", data: [8, 11, 9] },
    ],
  },
}

let mounted: Mounted[] = []

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
  resetToolOpenState()
})

function mountChart(props: Parameters<typeof mountTool>[1] = {}) {
  const card = mountTool("chart", { partID: "chart-card", forceOpen: true, ...props })
  mounted.push(card)
  return card
}

test("renders the chart header from the tool input", async () => {
  const card = mountChart({
    input: { title: "Quarterly revenue", description: "USD thousands" },
    output: JSON.stringify(revenue),
  })

  await waitFor(() => card.host.querySelector('[data-slot="basic-tool-tool-title"]'))
  expect(card.host.querySelector('[data-slot="basic-tool-tool-title"]')?.textContent).toContain("Quarterly revenue")
  expect(card.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toBe("USD thousands")
  expect(card.host.querySelector('[data-component="chart-container"]')).not.toBeNull()
  expect(card.host.querySelector('[data-slot="chart-render"]')).not.toBeNull()
})

test("reports a spec that parses but has no type or data", async () => {
  const card = mountChart({ input: { title: "Broken" }, output: JSON.stringify({ type: "bar" }) })

  await waitFor(() => card.host.querySelector('[data-slot="chart-error"]'))
  expect(card.host.querySelector('[data-slot="chart-error"]')?.textContent).toBe(
    "Invalid chart config: must include type and data",
  )
  expect(card.host.querySelector('[data-slot="chart-render"]')).toBeNull()
})

test("leaves a non-JSON output unrendered", async () => {
  const card = mountChart({ input: { title: "Mermaid" }, output: "graph TD; A-->B" })

  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(card.host.querySelector('[data-slot="chart-error"]')).toBeNull()
  expect(card.host.querySelector('[data-slot="chart-render"]')).not.toBeNull()
})

test("parses a real Chart.js payload", () => {
  const parsed = parseChartConfig(JSON.stringify(revenue))

  expect(parsed.kind).toBe("ok")
  if (parsed.kind !== "ok") return
  expect(parsed.config.type).toBe("bar")
  expect(parsed.config.data.datasets).toHaveLength(2)
})

test("distinguishes unparseable output from an invalid spec", () => {
  expect(parseChartConfig("{").kind).toBe("unparseable")
  expect(parseChartConfig("[]").kind).toBe("invalid")
  expect(parseChartConfig(JSON.stringify({ data: {} })).kind).toBe("invalid")
  expect(parseChartConfig(JSON.stringify({ type: "bar" })).kind).toBe("invalid")
})

test("gives bar datasets one series color each", () => {
  const styled = styleChartConfig(revenue, colors)

  expect(styled.data.datasets.map((dataset) => dataset.backgroundColor)).toEqual(["#3b82f6", "#22c55e"])
  expect(styled.data.datasets.map((dataset) => dataset.borderColor)).toEqual(["#3b82f6", "#22c55e"])
})

test("gives pie and doughnut points a color each", () => {
  const styled = styleChartConfig({ type: "pie", data: { datasets: [{ data: [1, 2, 3, 4] }] } }, colors)

  expect(styled.data.datasets[0]?.backgroundColor).toEqual(["#3b82f6", "#22c55e", "#a855f7", "#3b82f6"])
  expect(styled.data.datasets[0]?.borderColor).toEqual(["#3b82f6", "#22c55e", "#a855f7", "#3b82f6"])
})

test("keeps colors the spec sets itself", () => {
  const styled = styleChartConfig(
    { type: "bar", data: { datasets: [{ data: [1], backgroundColor: "#ff0000", borderColor: "#00ff00" }] } },
    colors,
  )

  expect(styled.data.datasets[0]?.backgroundColor).toBe("#ff0000")
  expect(styled.data.datasets[0]?.borderColor).toBe("#00ff00")
})