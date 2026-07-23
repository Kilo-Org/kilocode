import type { Chart as ChartInstance, ChartConfiguration, ChartType } from "chart.js"

const charts = new WeakMap<HTMLElement, ChartInstance>()

export function hasChart(root: HTMLElement) {
  return root.querySelector('pre > code[data-lang="chart"]') !== null
}

export function preserveChart(from: Element, to: Element) {
  if (!(from instanceof HTMLElement) || !(to instanceof HTMLElement)) return false
  if (from.getAttribute("data-kind") !== "chart" || from.getAttribute("data-chart-state") !== "rendered") return false
  const before = from.querySelector('pre > code[data-lang="chart"]')?.textContent
  const after = to.querySelector('pre > code[data-lang="chart"]')?.textContent
  return !!before && before === after
}

export async function renderChart(root: HTMLDivElement) {
  const blocks = Array.from(root.querySelectorAll('pre > code[data-lang="chart"]'))
  if (blocks.length === 0) return
  const { default: Chart } = await import("chart.js/auto")

  for (const block of blocks) {
    const pre = block.parentElement
    const wrapper = pre?.parentElement
    if (!(pre instanceof HTMLPreElement) || !(wrapper instanceof HTMLElement)) continue
    if (wrapper.getAttribute("data-component") !== "markdown-code") continue
    if (wrapper.getAttribute("data-chart-state") === "rendered") continue

    wrapper.setAttribute("data-kind", "chart")
    const panel = document.createElement("div")
    panel.setAttribute("data-component", "markdown-chart")
    const canvas = document.createElement("canvas")
    panel.append(canvas)
    wrapper.insertBefore(panel, pre)

    try {
      const config = JSON.parse(block.textContent ?? "") as ChartConfiguration<ChartType>
      config.options = { responsive: true, maintainAspectRatio: false, ...config.options }
      charts.get(wrapper)?.destroy()
      charts.set(wrapper, new Chart(canvas, config))
      wrapper.setAttribute("data-chart-state", "rendered")
      pre.hidden = true
    } catch (err) {
      panel.setAttribute("data-state", "error")
      panel.textContent = err instanceof Error ? `Chart render failed: ${err.message}` : "Chart render failed."
      wrapper.setAttribute("data-chart-state", "error")
    }
  }
}
