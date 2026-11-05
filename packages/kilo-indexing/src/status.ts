import z from "zod"
import type { IndexingState } from "./indexing/interfaces/manager"

type StatusSource = {
  readonly isFeatureEnabled: boolean
  readonly isFeatureConfigured: boolean
  getCurrentStatus(): {
    systemStatus: IndexingState
    message?: string
    processedItems: number
    totalItems: number
    currentItemUnit: string
  }
}

export const INDEXING_STATUS_STATES = ["Disabled", "In Progress", "Complete", "Error", "Standby"] as const

export const IndexingStatusState = z.enum(INDEXING_STATUS_STATES).meta({ ref: "IndexingStatusState" })

export type IndexingStatusState = z.infer<typeof IndexingStatusState>

export const IndexingStatus = z
  .object({
    state: IndexingStatusState,
    message: z.string(),
    processedFiles: z.number().int().nonnegative(),
    totalFiles: z.number().int().nonnegative(),
    percent: z.number().int().min(0).max(100),
  })
  .meta({ ref: "IndexingStatus" })

export type IndexingStatus = z.infer<typeof IndexingStatus>

export function disabledIndexingStatus(message = "Indexing disabled."): IndexingStatus {
  return {
    state: "Disabled",
    message,
    processedFiles: 0,
    totalFiles: 0,
    percent: 0,
  }
}

export function normalizeIndexingStatus(manager: StatusSource): IndexingStatus {
  const cfg = manager.getCurrentStatus()
  const files = cfg.currentItemUnit === "files"
  const processedFiles = files ? cfg.processedItems : 0
  const totalFiles = files ? cfg.totalItems : 0
  const percent = totalFiles > 0 ? Math.min(100, Math.max(0, Math.round((processedFiles / totalFiles) * 100))) : 0

  if (!manager.isFeatureEnabled || !manager.isFeatureConfigured) {
    return disabledIndexingStatus(cfg.message || "Indexing disabled.")
  }

  if (cfg.systemStatus === "Error") {
    return {
      state: "Error",
      message: cfg.message || "Indexing failed.",
      processedFiles,
      totalFiles,
      percent,
    }
  }

  if (cfg.systemStatus === "Indexing") {
    return {
      state: "In Progress",
      message: cfg.message || "Indexing in progress.",
      processedFiles,
      totalFiles,
      percent,
    }
  }

  if (cfg.systemStatus === "Standby") {
    return {
      state: "Standby",
      message: cfg.message || "Indexing paused.",
      processedFiles,
      totalFiles,
      percent,
    }
  }

  return {
    state: "Complete",
    message: cfg.message || "Index up-to-date.",
    processedFiles,
    totalFiles,
    percent: totalFiles > 0 ? percent : 100,
  }
}
