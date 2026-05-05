import { Emitter } from "./runtime"

export type IndexingState = "Standby" | "Indexing" | "Indexed" | "Error"

export class CodeIndexStateManager {
  private _systemStatus: IndexingState = "Standby"
  private _statusMessage = ""
  private _processedFiles = 0
  private _totalFiles = 0
  private _percent = 0
  private _gitBranch?: string
  private _manifest?: {
    totalFiles: number
    totalChunks: number
    lastUpdated: string
  }
  private _progressEmitter = new Emitter<ReturnType<typeof this.getCurrentStatus>>()

  public readonly onProgressUpdate = this._progressEmitter

  public get state(): IndexingState {
    return this._systemStatus
  }

  public getCurrentStatus() {
    return {
      systemStatus: this._systemStatus,
      message: this._statusMessage,
      processedItems: this._processedFiles,
      totalItems: this._totalFiles,
      currentItemUnit: "files",
      percent: this._percent,
      gitBranch: this._gitBranch,
      manifest: this._manifest,
    }
  }

  public setSystemState(
    newState: IndexingState,
    message?: string,
    manifest?: {
      totalFiles: number
      totalChunks: number
      lastUpdated: string
    },
    gitBranch?: string,
  ): void {
    const stateChanged = newState !== this._systemStatus || (message !== undefined && message !== this._statusMessage)

    if (!stateChanged) return

    this._systemStatus = newState
    if (message !== undefined) this._statusMessage = message
    if (manifest !== undefined) this._manifest = manifest
    if (gitBranch !== undefined) this._gitBranch = gitBranch

    if (newState !== "Indexing") {
      this._percent = newState === "Indexed" ? 100 : 0
      if (newState === "Standby" && message === undefined) this._statusMessage = "Ready."
      if (newState === "Indexed" && message === undefined) this._statusMessage = "Index up-to-date."
      if (newState === "Error" && message === undefined) this._statusMessage = "An error occurred."
    }

    if (newState !== "Indexed") {
      this._manifest = undefined
    }

    this._progressEmitter.fire(this.getCurrentStatus())
  }

  public reportFileProgress(processedFiles: number, totalFiles: number, currentFileBasename?: string): void {
    const percent = totalFiles > 0 ? Math.min(100, Math.round((processedFiles / totalFiles) * 100)) : 0
    const progressChanged =
      processedFiles !== this._processedFiles || totalFiles !== this._totalFiles || percent !== this._percent

    if (!progressChanged && this._systemStatus === "Indexing") return

    this._processedFiles = processedFiles
    this._totalFiles = totalFiles
    this._percent = percent

    const message =
      totalFiles > 0
        ? `Indexed ${processedFiles} / ${totalFiles} files (${percent}%).${currentFileBasename ? ` Current: ${currentFileBasename}` : ""}`
        : "Indexing files..."
    const oldStatus = this._systemStatus
    const oldMessage = this._statusMessage

    this._systemStatus = "Indexing"
    this._statusMessage = message

    if (oldStatus !== this._systemStatus || oldMessage !== this._statusMessage || progressChanged) {
      this._progressEmitter.fire(this.getCurrentStatus())
    }
  }

  public reportFileQueueProgress(processedFiles: number, totalFiles: number, currentFileBasename?: string): void {
    this.reportFileProgress(processedFiles, totalFiles, currentFileBasename)
  }

  public dispose(): void {
    this._progressEmitter.dispose()
  }
}
