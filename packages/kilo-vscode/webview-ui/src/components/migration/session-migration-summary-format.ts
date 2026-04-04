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

export function errors(summary: SessionSummaryState) {
  return summary.errored.map(
    (item, index) =>
      [`Error ${index + 1}`, `id: ${item.id}`, `directory: ${item.directory}`, `title: ${item.title}`, `date: ${date(item.time)}`, "", item.error || "Unknown error"].join("\n"),
  )
}

export function copy(summary: SessionSummaryState) {
  return summary.errored
    .map(
      (item, index) =>
        [`Error ${index + 1}`, `id: ${item.id}`, `directory: ${item.directory}`, `title: ${item.title}`, `date: ${date(item.time)}`, "", item.error || "Unknown error"].join("\n"),
    )
    .join("\n\n")
}

export function report(summary: SessionSummaryState) {
  const block = (title: string, items: SessionSummaryItem[]) => {
    const rows = items.length > 0 ? items.map((item) => line(item)).join("\n") : "None"
    return `${title}\n${rows}`
  }

  const errs = errors(summary).length > 0 ? errors(summary).join("\n\n") : "None"

  return [
    "Summary:",
    "",
    block("Successful", summary.imported),
    "",
    block("Skipped", summary.skipped),
    "",
    block("Errored", summary.errored),
    "",
    `Errors\n${errs}`,
  ]
    .filter(Boolean)
    .join("\n")
}
