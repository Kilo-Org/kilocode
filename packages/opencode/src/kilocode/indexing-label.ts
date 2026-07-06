import type { IndexingStatus } from "@kilocode/kilo-indexing/status"

export function formatIndexingLabel(status: IndexingStatus): string {
  if (status.state === "In Progress") {
    if (status.totalFiles <= 0) return status.percent > 0 ? `${status.percent}%` : "In progress"
    return `${status.percent}% (${status.processedFiles}/${status.totalFiles} files)`
  }

  if (status.state === "Error") {
    return status.message || "Failed"
  }

  return status.state
}
