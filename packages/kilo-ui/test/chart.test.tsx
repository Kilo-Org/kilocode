import { afterEach, beforeEach, expect, test } from "bun:test"
import { dict as kilo } from "@kilocode/kilo-i18n/en"
import { dict as ui } from "@opencode-ai/ui/i18n/en"
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

test("draws the config on a canvas instead of showing it", async () => {
  const value = card({ input: { title: "Revenue" }, output: bar })

  // The test DOM has no canvas implementation, so Chart.js reports the failure through the card's error slot. Both
  // outcomes prove the card took the config to the chart renderer; what it must never do is print the JSON.
  const slot = await waitFor(() =>
    value.host.querySelector('[data-slot="chart-render"], [data-slot="chart-error"]'),
  )
  expect(slot.parentElement?.getAttribute("data-component")).toBe("chart-container")
  expect(value.host.querySelector('[data-component="chart-container"]')?.textContent).not.toContain('"labels"')
})

test("shows the config error for a spec without type and data", async () => {
  const value = card({ input: { title: "Revenue" }, output: JSON.stringify({ options: {} }) })

  const error = await waitFor(() => value.host.querySelector('[data-slot="chart-error"]'))
  expect(error.textContent).toBe("Invalid chart config — must include type and data")
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
