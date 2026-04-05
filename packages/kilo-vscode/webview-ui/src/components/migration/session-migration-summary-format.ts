import type { SessionSummaryItem, SessionSummaryState } from "./session-migration-summary-state"

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function date(time: number) {
  if (!time) return "Unknown date"
  const value = new Date(time)
  return `${pad(value.getHours())}:${pad(value.getMinutes())} ${pad(value.getMonth() + 1)}/${pad(value.getDate())}/${value.getFullYear()}`
}

function path(value: string) {
  const text = value.trim()
  if (!text) return "Unknown"
  const parts = text.split(/[\\/]/).filter(Boolean)
  const last = parts.at(-1)
  if (!last) return text
  return `.../${last}`
}

export function line(item: SessionSummaryItem) {
  const dir = path(item.directory)
  const title = item.title.trim() || "Unknown"
  return `${dir} ${title} ${date(item.time)}`
}

export function short(error?: string) {
  if (!error) return "Unknown error"
  return error.split("\n")[0]?.trim() || error
}

export function detail(item: SessionSummaryItem) {
  return short(item.error)
}

export function errored(summary: SessionSummaryState) {
  if (summary.errored.length === 0) return [{ kind: "row", text: "None" }]
  return summary.errored.flatMap((item) => [
    { kind: "row", text: line(item) },
    { kind: "detail", text: detail(item) },
  ])
}

export function report(summary: SessionSummaryState) {
  const block = (title: string, items: SessionSummaryItem[], full?: boolean) => {
    const rows = items.length > 0 ? items.map((item) => (full ? `${line(item)}\n  ${short(item.error)}` : line(item))).join("\n") : "None"
    return `${title}\n${rows}`
  }

  return [
    "Summary:",
    "",
    block("Successful", summary.imported),
    "",
    block("Skipped", summary.skipped),
    "",
    block("Errored", summary.errored, true),
  ]
    .filter(Boolean)
    .join("\n")
}
