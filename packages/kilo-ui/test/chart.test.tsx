import { afterEach, beforeEach, expect, test } from "bun:test"
import { dict as kilo } from "@kilocode/kilo-i18n/en"
import { dict as ui } from "@opencode-ai/ui/i18n/en"
import { Chart } from "chart.js"
import { ToolRegistry, type ToolProps } from "../src/components/message-part"
import { resetToolOpenState } from "../src/components/tool-open-state"
import { I18nProvider, type UiI18nSource } from "../src/context/i18n"
import { mount, waitFor, type Mounted } from "./harness"

let mounted: Mounted[] = []

beforeEach(() => {
  resetToolOpenState()
})

afterEach(() => {
  for (const card of mounted) card.dispose()
  mounted = []
})

// The app builds this source from the upstream UI dictionary overlaid with Kilo's copy; the card resolves its
// strings through it, so the assertions read the same English copy a user sees.
const dictionary: Record<string, string> = { ...ui, ...kilo }
const template = (text: string, params?: Record<string, string | number | boolean>) =>
  params ? text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? "")) : text
const i18n: UiI18nSource = {
  locale: () => "en",
  t: (key, params) => template(dictionary[key] ?? String(key), params),
  plural: (key, count, params) => template(dictionary[`${key}.other`] ?? String(key), { ...params, count }),
}

function card(props: Partial<ToolProps> = {}) {
  const Renderer = ToolRegistry.render("chart")
  if (!Renderer) throw new Error("No renderer registered for chart")
  const value = mount(() => (
    <I18nProvider value={i18n}>
      <Renderer
        input={{}}
        metadata={{}}
        tool="chart"
        partID="chart-card"
        output=""
        status="completed"
        attachments={[]}
        {...props}
      />
    </I18nProvider>
  ))
  mounted.push(value)
  return value
}

const bar = JSON.stringify({
  type: "bar",
  data: { labels: ["A", "B"], datasets: [{ label: "Value", data: [1, 2] }] },
})

test("renders the chart card with the title and description of the call", async () => {
  const value = card({ input: { title: "Revenue", description: "Q1 2026" }, output: bar })

  await waitFor(() => value.host.querySelector('[data-component="chart-container"]'))
  expect(value.host.querySelector('[data-slot="basic-tool-tool-title"]')?.textContent).toBe("Revenue")
  expect(value.host.querySelector('[data-slot="basic-tool-tool-subtitle"]')?.textContent).toBe("Q1 2026")
})

test("parses the config and draws it instead of showing it", async () => {
  const existing = new Set(Object.keys(Chart.instances))
  const value = card({ input: { title: "Revenue" }, output: bar })

  // Chart.js records every chart it constructs in `Chart.instances`, including one it rejects because the test DOM
  // has no 2D context. That instance carries the parsed config with the card's themed dataset colors, so finding it
  // proves the effect ran: the output was parsed, the datasets were themed and Chart.js was constructed.
  const chart = await waitFor(() =>
    Object.values(Chart.instances).find((item) => item && !existing.has(String(item.id))),
  )
  expect(chart.config.data.datasets?.[0]?.backgroundColor).toBe("#3B82F6")
  expect(value.host.querySelector('[data-component="chart-container"]')?.textContent).not.toContain('"labels"')
})

test("shows the config error for a spec without type and data", async () => {
  const value = card({ input: { title: "Revenue" }, output: JSON.stringify({ options: {} }) })

  const error = await waitFor(() => value.host.querySelector('[data-slot="chart-error"]'))
  expect(error.textContent).toBe("Invalid chart config — must include type and data")
})

test.each(['{"type":"bar","data":{}}', '{"type":"bar","data":{"datasets":"none"}}'])(
  "shows the config error for %s instead of throwing",
  async (spec) => {
    const value = card({ input: { title: "Revenue" }, output: spec })

    const error = await waitFor(() => value.host.querySelector('[data-slot="chart-error"]'))
    expect(error.textContent).toBe("Invalid chart config — must include type and data")
  },
)

test("shows the render error for a dataset the chart cannot draw instead of throwing", async () => {
  const value = card({ input: { title: "Revenue" }, output: '{"type":"bar","data":{"datasets":[null]}}' })

  const error = await waitFor(() => value.host.querySelector('[data-slot="chart-error"]'))
  expect(error.textContent).not.toBe("")
})

test("stays empty while the tool is still running", async () => {
  const value = card({ input: { title: "Revenue" }, output: bar, status: "running" })

  await waitFor(() => value.host.querySelector('[data-slot="chart-render"]'))
  await Bun.sleep(10)
  expect(value.host.querySelector('[data-slot="chart-error"]')).toBeNull()
})

test("leaves a tool message that is not a config alone", async () => {
  const value = card({
    input: { title: "Revenue" },
    output: "Invalid chart spec: could not parse JSON. Write a mermaid fenced code block instead.",
  })

  const canvas = await waitFor(() => value.host.querySelector('[data-slot="chart-render"]'))
  await Bun.sleep(10)
  // The card leaves the canvas empty rather than drawing the tool's message as a chart or an error.
  expect(canvas.parentElement?.textContent).toBe("")
  expect(value.host.querySelector('[data-slot="chart-error"]')).toBeNull()
})
