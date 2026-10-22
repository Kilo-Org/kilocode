import type { EmbedderProvider } from "./manager"

export type IndexingTelemetryTrigger = "background" | "manual"
export type IndexingTelemetryMode = "full" | "incremental"
export type IndexingTelemetrySource = "scan" | "watcher"
export type IndexingVectorStore = "lancedb" | "qdrant"

export type IndexingTelemetryMeta = {
  provider: EmbedderProvider
  vectorStore: IndexingVectorStore
  modelId?: string
}

export type IndexingTelemetryEvent =
  | (IndexingTelemetryMeta & {
      type: "started"
      source: "scan"
      trigger: IndexingTelemetryTrigger
      mode?: IndexingTelemetryMode
    })
  | (IndexingTelemetryMeta & {
      type: "completed"
      source: "scan"
      trigger: IndexingTelemetryTrigger
      mode: IndexingTelemetryMode
      filesIndexed: number
      filesDiscovered: number
      totalBlocks: number
      batchErrors: number
    })
  | (IndexingTelemetryMeta & {
      type: "file_count"
      source: "scan"
      mode: IndexingTelemetryMode
      discovered: number
      candidate: number
    })
  | (IndexingTelemetryMeta & {
      type: "batch_retry"
      source: IndexingTelemetrySource
      mode: IndexingTelemetryMode
      attempt: number
      maxRetries: number
      batchSize: number
      error: string
    })
  | (IndexingTelemetryMeta & {
      type: "error"
      source: IndexingTelemetrySource
      location: string
      error: string
      mode?: IndexingTelemetryMode
      trigger?: IndexingTelemetryTrigger
      retryCount?: number
      maxRetries?: number
    })

export type IndexingTelemetryReporter = (event: IndexingTelemetryEvent) => void
