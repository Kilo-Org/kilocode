import type { ExtensionMessage, IndexingStatus } from "../types/messages"

export function formatIndexingLabel(status: IndexingStatus): string {
  if (status.state === "In Progress") {
    if (status.totalFiles <= 0) return "IDX In Progress"
    return `IDX ${status.percent}% ${status.processedFiles}/${status.totalFiles}`
  }

  if (status.state === "Error") {
    return `IDX ${status.message}`
  }

  if (status.state === "Standby") {
    return "IDX Standby"
  }

  return `IDX ${status.state}`
}

export function indexingTone(status: IndexingStatus): "muted" | "warning" | "success" | "error" {
  if (status.state === "Complete") return "success"
  if (status.state === "Error") return "error"
  if (status.state === "In Progress") return "warning"
  if (status.state === "Standby") return "muted"
  return "muted"
}

export function applyIndexingStatusMessage(
  message: ExtensionMessage,
  setStatus: (status: IndexingStatus) => void,
  setLoading: (value: boolean) => void,
): boolean {
  if (message.type !== "indexingStatusLoaded") return false
  setStatus(message.status)
  setLoading(false)
  return true
}
