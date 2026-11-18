import type { PointStruct } from "./vector-store"
import type { Disposable, Emitter } from "../runtime"
import type { IndexingTelemetryMode } from "./telemetry"
import type { WorktreeOverlay } from "../worktree-overlay"

export interface ICodeParser {
  parseFile(
    filePath: string,
    options?: {
      minBlockLines?: number
      maxBlockLines?: number
      content?: string
      fileHash?: string
    },
  ): Promise<CodeBlock[]>
}

export interface IDirectoryScanner {
  scanDirectory(
    directory: string,
    onError?: (error: Error) => void,
    onFilesIndexed?: (indexedCount: number) => void,
    onFileParsed?: () => void,
    mode?: IndexingTelemetryMode,
  ): Promise<{
    stats: {
      processed: number
      skipped: number
    }
    totalBlockCount: number
  }>

  updateBatchSegmentThreshold(newThreshold: number): void
}

export interface IFileWatcher extends Disposable {
  initialize(): Promise<void>
  updateBatchSegmentThreshold(newThreshold: number): void
  setCollecting(collecting: boolean): void
  setOverlay?(overlay?: WorktreeOverlay): void
  shutdown?(): Promise<void>

  /** False when no live subscription exists, so the index stops changing until the next scan. */
  readonly watching: boolean

  readonly onDidStartBatchProcessing: Emitter<string[]>
  readonly onBatchProgressUpdate: Emitter<{
    processedInBatch: number
    totalInBatch: number
    currentFile?: string
  }>
  readonly onDidFinishBatchProcessing: Emitter<BatchProcessingSummary>

  /** Fires when a live subscription fails, so incremental updates stopped after the scan. */
  readonly onDidStop: Emitter<Error>

  processFile(filePath: string): Promise<FileProcessingResult>
}

export interface BatchProcessingSummary {
  processedFiles: FileProcessingResult[]
  batchError?: Error
}

export interface FileProcessingResult {
  path: string
  status: "success" | "skipped" | "error" | "processed_for_batching" | "local_error"
  error?: Error
  reason?: string
  newHash?: string
  pointsToUpsert?: PointStruct[]
}

export interface CodeBlock {
  file_path: string
  identifier: string | null
  type: string
  start_line: number
  end_line: number
  content: string
  fileHash: string
  segmentHash: string
}
