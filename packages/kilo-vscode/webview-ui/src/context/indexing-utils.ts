import type { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import type { ToWebview } from "../../../src/protocol"

type IndexingStatus = KiloIndexingRpc.Status
type IndexingConfig = KiloIndexingRpc.Config

export function indexingButtonVisible(show: boolean, config: IndexingConfig, global: IndexingConfig) {
  if (show) return true
  if (global.enabled === true) return true
  return config.enabled === true
}

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
  message: ToWebview,
  setStatus: (status: IndexingStatus) => void,
  setLoading: (value: boolean) => void,
): boolean {
  if (message.type !== "indexingStatusLoaded") return false
  setStatus(message.status)
  setLoading(false)
  return true
}
