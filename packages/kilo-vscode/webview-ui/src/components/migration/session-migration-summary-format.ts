import type { SessionSummaryItem, SessionSummaryState } from "./session-migration-summary-state"

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function date(time: number) {
  if (!time) return "Unknown date"
  const value = new Date(time)
  return `${pad(value.getHours())}:${pad(value.getMinutes())} ${pad(value.getMonth() + 1)}/${pad(value.getDate())}/${value.getFullYear()}`
}

export function line(item: SessionSummaryItem) {
  const dir = item.directory.trim() || "Unknown"
  const title = item.title.trim() || "Unknown"
  return `${dir} ${title} ${date(item.time)}`
}

export function short(error?: string) {
  if (!error) return "Unknown error"
  return error.split("\n")[0]?.trim() || error
}

export function errors(summary: SessionSummaryState) {
  return summary.errored.map((item, index) => `Error ${index + 1}: ${short(item.error)}`)
}

export function copy(summary: SessionSummaryState) {
  return summary.errored
    .map(
      (item, index) =>
        [`Error ${index + 1}`, `id: ${item.id}`, `directory: ${item.directory}`, `title: ${item.title}`, `date: ${date(item.time)}`, "", item.error || "Unknown error"].join("\n"),
    )
    .join("\n\n")
}
