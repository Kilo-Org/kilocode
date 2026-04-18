import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { execFile } from "child_process"
import { KiloLogger } from "../KiloLogger"

// ─── Interfaces ──────────────────────────────────────────

export interface Dataset {
  id: string
  name: string
  sourcePath: string
  format: "jsonl" | "parquet" | "csv" | "folder"
  validationStatus: "pending" | "passed" | "failed"
  rowCount?: number
  sizeBytes?: number
  errors?: string[]
  warnings?: string[]
  registeredAt: number
}

export interface TrainingJob {
  id: string
  name: string
  preset: "lora" | "qlora" | "custom"
  datasetId: string
  target: "local_gpu" | "remote_gpu"
  hyperparams: {
    learningRate: number
    epochs: number
    batchSize: number
    warmupSteps: number
  }
  resourceLimits: {
    maxGpuMemoryMB: number
    timeoutMinutes: number
  }
  status: "queued" | "running" | "paused" | "completed" | "failed"
  progress: number
  currentEpoch: number
  currentStep: number
  totalSteps: number
  lossHistory: number[]
  loss?: number
  startedAt?: number
  completedAt?: number
  elapsedMs?: number
  eta?: number
  checkpoints: Checkpoint[]
  logs: string[]
  error?: string
}

export interface Checkpoint {
  id: string
  jobId: string
  step: number
  loss: number
  timestamp: number
  path: string
  sizeBytes?: number
}

export interface GPUInfo {
  index: number
  name: string
  vramTotal: number
  vramUsed: number
  vramFree: number
  driverVersion: string
  cudaVersion: string
  utilization: number
  temperature: number
}

export interface RunComparison {
  jobA: TrainingJob
  jobB: TrainingJob
  datasetA: Dataset | undefined
  datasetB: Dataset | undefined
}

export interface GpuQuota {
  maxConcurrentJobs: number
  maxGpuMemoryMb: number
  maxTrainingTimeMs: number
}

export interface ExportOptions {
  jobId: string
  format: "gguf" | "safetensors" | "pytorch" | "onnx"
  quantization: "none" | "q4_0" | "q4_1" | "q5_0" | "q5_1" | "q8_0" | "f16"
  outputPath: string
  includeTokenizer: boolean
  includeConfig: boolean
  includeReadme: boolean
  mergeAdapter: boolean
}

export interface ExportFile {
  name: string
  path: string
  sizeBytes: number
  type: "model" | "tokenizer" | "config" | "readme" | "metadata"
}

export interface ExportResult {
  exportId: string
  jobId: string
  format: string
  outputPath: string
  files: ExportFile[]
  totalSizeBytes: number
  status: "pending" | "exporting" | "complete" | "failed"
  startedAt: number
  completedAt?: number
  error?: string
}

interface TrainingState {
  datasets: Dataset[]
  jobs: TrainingJob[]
}

// ─── Utilities ───────────────────────────────────────────

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function getStoragePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".kilo", "training.json")
}

function countLinesInFile(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    let count = 0
    const stream = fs.createReadStream(filePath, { encoding: "utf8" })
    let remainder = ""
    stream.on("data", (chunk: string | Buffer) => {
      const lines = (remainder + chunk).split("\n")
      remainder = lines.pop() ?? ""
      count += lines.length
    })
    stream.on("end", () => {
      if (remainder.length > 0) count++
      resolve(count)
    })
    stream.on("error", () => resolve(0))
  })
}

function parseNvidiaSmi(stdout: string): GPUInfo[] {
  const gpus: GPUInfo[] = []
  const lines = stdout.trim().split("\n")
  let driverVersion = ""
  let cudaVersion = ""

  // First pass: extract driver and CUDA version from header
  for (const line of lines) {
    const driverMatch = line.match(/Driver Version:\s*([\d.]+)/)
    if (driverMatch) driverVersion = driverMatch[1]
    const cudaMatch = line.match(/CUDA Version:\s*([\d.]+)/)
    if (cudaMatch) cudaVersion = cudaMatch[1]
  }

  // Query-based parsing (csv format from nvidia-smi --query-gpu)
  for (const line of lines) {
    const parts = line.split(",").map((s) => s.trim())
    if (parts.length < 6) continue
    // Expected: index, name, memory.total [MiB], memory.used [MiB], memory.free [MiB], utilization.gpu [%], temperature.gpu
    const index = parseInt(parts[0], 10)
    if (isNaN(index)) continue

    const name = parts[1]
    const vramTotal = parseInt(parts[2], 10) || 0
    const vramUsed = parseInt(parts[3], 10) || 0
    const vramFree = parseInt(parts[4], 10) || 0
    const utilization = parseInt(parts[5], 10) || 0
    const temperature = parseInt(parts[6], 10) || 0

    gpus.push({
      index,
      name,
      vramTotal,
      vramUsed,
      vramFree,
      driverVersion,
      cudaVersion,
      utilization,
      temperature,
    })
  }

  return gpus
}

// ─── Service ─────────────────────────────────────────────

export class TrainingService implements vscode.Disposable {
  private datasets: Dataset[] = []
  private jobs: TrainingJob[] = []
  private gpuCache: GPUInfo[] = []
  private disposables: vscode.Disposable[] = []
  private jobTimers: Map<string, ReturnType<typeof setInterval>> = new Map()
  private jobTimeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private exports: Map<string, ExportResult> = new Map()
  private workspaceRoot: string
  private readonly gpuQuota: GpuQuota = {
    maxConcurrentJobs: 2,
    maxGpuMemoryMb: 24576, // RTX 3090 Ti 24GB
    maxTrainingTimeMs: 86400000,
  }
  private readonly maxDatasetSizeBytes: number = 10 * 1024 * 1024 * 1024 // 10 GB
  private readonly _onStateChange = new vscode.EventEmitter<void>()
  public readonly onStateChange = this._onStateChange.event
  private readonly log = KiloLogger.for("TrainingService")

  constructor(private readonly context: vscode.ExtensionContext) {
    const folders = vscode.workspace.workspaceFolders
    this.workspaceRoot = folders?.[0]?.uri.fsPath ?? ""
    this.disposables.push(this._onStateChange)
    this.loadState()
    this.log.info("TrainingService initialized", { workspaceRoot: this.workspaceRoot })
  }

  // ─── Persistence ────────────────────────────────────────

  private loadState(): void {
    if (!this.workspaceRoot) return
    const filePath = getStoragePath(this.workspaceRoot)
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8")
        const state = JSON.parse(raw) as TrainingState
        this.datasets = state.datasets ?? []
        this.jobs = state.jobs ?? []
      }
    } catch (err) {
      this.log.warn("Failed to load state", err)
    }
  }

  private saveState(): void {
    if (!this.workspaceRoot) return
    const filePath = getStoragePath(this.workspaceRoot)
    const dir = path.dirname(filePath)
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const state: TrainingState = {
        datasets: this.datasets,
        jobs: this.jobs,
      }
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8")
    } catch (err) {
      this.log.warn("Failed to save state", err)
    }
  }

  private emitChange(): void {
    this.saveState()
    this._onStateChange.fire()
  }

  // ─── Dataset Management ─────────────────────────────────

  getDatasets(): Dataset[] {
    return [...this.datasets]
  }

  getDataset(id: string): Dataset | undefined {
    return this.datasets.find((d) => d.id === id)
  }

  registerDataset(name: string, sourcePath: string, format: Dataset["format"]): Dataset {
    const dataset: Dataset = {
      id: generateId(),
      name,
      sourcePath,
      format,
      validationStatus: "pending",
      registeredAt: Date.now(),
    }
    this.datasets.push(dataset)
    this.emitChange()
    return dataset
  }

  removeDataset(id: string): boolean {
    const idx = this.datasets.findIndex((d) => d.id === id)
    if (idx === -1) return false
    this.datasets.splice(idx, 1)
    this.emitChange()
    return true
  }

  async validateDataset(id: string): Promise<Dataset> {
    const dataset = this.datasets.find((d) => d.id === id)
    if (!dataset) throw new Error(`Dataset not found: ${id}`)

    dataset.errors = []
    dataset.warnings = []

    const resolvedPath = this.resolvePath(dataset.sourcePath)

    // Check existence
    if (!fs.existsSync(resolvedPath)) {
      dataset.errors.push(`Path does not exist: ${resolvedPath}`)
      dataset.validationStatus = "failed"
      this.emitChange()
      return dataset
    }

    const stat = fs.statSync(resolvedPath)

    if (dataset.format === "folder") {
      // Folder validation
      if (!stat.isDirectory()) {
        dataset.errors.push("Path is not a directory")
        dataset.validationStatus = "failed"
        this.emitChange()
        return dataset
      }
      const entries = fs.readdirSync(resolvedPath)
      if (entries.length === 0) {
        dataset.errors.push("Directory is empty")
        dataset.validationStatus = "failed"
        this.emitChange()
        return dataset
      }
      dataset.rowCount = entries.length
      dataset.sizeBytes = this.calculateDirSize(resolvedPath)

      // Max dataset size check for folders
      if (dataset.sizeBytes > this.maxDatasetSizeBytes) {
        dataset.errors.push(
          `Dataset size (${(dataset.sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds maximum allowed size (${(this.maxDatasetSizeBytes / (1024 * 1024 * 1024)).toFixed(0)} GB)`
        )
        dataset.validationStatus = "failed"
        this.emitChange()
        return dataset
      }
      if (entries.length < 10) {
        dataset.warnings.push("Very few files in directory (< 10). Consider adding more data.")
      }
    } else {
      // File-based validation
      if (!stat.isFile()) {
        dataset.errors.push("Path is not a file")
        dataset.validationStatus = "failed"
        this.emitChange()
        return dataset
      }
      dataset.sizeBytes = stat.size

      if (stat.size === 0) {
        dataset.errors.push("File is empty (0 bytes)")
        dataset.validationStatus = "failed"
        this.emitChange()
        return dataset
      }

      // Max dataset size check for files
      if (stat.size > this.maxDatasetSizeBytes) {
        dataset.errors.push(
          `Dataset file size (${(stat.size / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds maximum allowed size (${(this.maxDatasetSizeBytes / (1024 * 1024 * 1024)).toFixed(0)} GB)`
        )
        dataset.validationStatus = "failed"
        this.emitChange()
        return dataset
      }

      // Format-specific validation
      switch (dataset.format) {
        case "jsonl":
          await this.validateJsonl(dataset, resolvedPath)
          break
        case "csv":
          await this.validateCsv(dataset, resolvedPath)
          break
        case "parquet":
          this.validateParquet(dataset, resolvedPath)
          break
      }
    }

    if (dataset.errors.length === 0) {
      dataset.validationStatus = "passed"
    } else {
      dataset.validationStatus = "failed"
    }

    this.emitChange()
    return dataset
  }

  private async validateJsonl(dataset: Dataset, filePath: string): Promise<void> {
    const content = fs.readFileSync(filePath, "utf8")
    const lines = content.split("\n").filter((l) => l.trim().length > 0)
    dataset.rowCount = lines.length

    if (lines.length === 0) {
      dataset.errors!.push("No valid lines found in JSONL file")
      return
    }

    let parseErrors = 0
    const maxCheck = Math.min(lines.length, 100)
    for (let i = 0; i < maxCheck; i++) {
      try {
        JSON.parse(lines[i])
      } catch {
        parseErrors++
        if (parseErrors <= 3) {
          dataset.errors!.push(`Line ${i + 1}: Invalid JSON`)
        }
      }
    }

    if (parseErrors > 3) {
      dataset.errors!.push(`... and ${parseErrors - 3} more JSON parse errors in first ${maxCheck} lines`)
    }

    if (parseErrors === 0 && lines.length < 50) {
      dataset.warnings!.push("Dataset has fewer than 50 rows. Fine-tuning may produce poor results with limited data.")
    }
  }

  private async validateCsv(dataset: Dataset, filePath: string): Promise<void> {
    const lineCount = await countLinesInFile(filePath)
    dataset.rowCount = Math.max(0, lineCount - 1) // subtract header

    if (lineCount <= 1) {
      dataset.errors!.push("CSV file has no data rows (only header or empty)")
      return
    }

    // Read first few lines to check structure
    const content = fs.readFileSync(filePath, "utf8")
    const firstLines = content.split("\n").slice(0, 5)
    if (firstLines.length > 0) {
      const headerCols = firstLines[0].split(",").length
      for (let i = 1; i < firstLines.length; i++) {
        if (firstLines[i].trim().length === 0) continue
        const cols = firstLines[i].split(",").length
        if (cols !== headerCols) {
          dataset.warnings!.push(
            `Row ${i + 1} has ${cols} columns but header has ${headerCols}. Check for inconsistent formatting.`
          )
        }
      }
    }
  }

  private validateParquet(dataset: Dataset, filePath: string): void {
    // Parquet files start with "PAR1" magic bytes
    const fd = fs.openSync(filePath, "r")
    const buf = Buffer.alloc(4)
    fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)
    const magic = buf.toString("ascii")
    if (magic !== "PAR1") {
      dataset.errors!.push("File does not appear to be valid Parquet format (missing PAR1 magic bytes)")
      return
    }
    // We cannot parse row count without a parquet library; mark it as validated structurally
    dataset.warnings!.push("Row count unavailable for Parquet files without a native reader. File structure looks valid.")
  }

  private calculateDirSize(dirPath: string): number {
    let total = 0
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isFile()) {
          total += fs.statSync(fullPath).size
        } else if (entry.isDirectory()) {
          total += this.calculateDirSize(fullPath)
        }
      }
    } catch {
      // ignore permission errors
    }
    return total
  }

  private resolvePath(sourcePath: string): string {
    if (path.isAbsolute(sourcePath)) return sourcePath
    return path.join(this.workspaceRoot, sourcePath)
  }

  // ─── Training Job Management ────────────────────────────

  getJobs(): TrainingJob[] {
    return [...this.jobs]
  }

  getJob(id: string): TrainingJob | undefined {
    return this.jobs.find((j) => j.id === id)
  }

  launchJob(params: {
    name: string
    preset: TrainingJob["preset"]
    datasetId: string
    target: TrainingJob["target"]
    hyperparams: TrainingJob["hyperparams"]
    resourceLimits: TrainingJob["resourceLimits"]
  }): TrainingJob {
    const dataset = this.datasets.find((d) => d.id === params.datasetId)
    if (!dataset) throw new Error(`Dataset not found: ${params.datasetId}`)
    if (dataset.validationStatus !== "passed") {
      throw new Error("Dataset must pass validation before training")
    }

    // ── GPU quota enforcement ──
    const runningJobs = this.jobs.filter((j) => j.status === "running" || j.status === "queued")
    if (runningJobs.length >= this.gpuQuota.maxConcurrentJobs) {
      throw new Error(
        `GPU quota exceeded: maximum concurrent jobs is ${this.gpuQuota.maxConcurrentJobs}, currently ${runningJobs.length} active`
      )
    }

    // ── Resource limit enforcement ──
    if (params.resourceLimits.maxGpuMemoryMB > this.gpuQuota.maxGpuMemoryMb) {
      throw new Error(
        `GPU quota exceeded: requested ${params.resourceLimits.maxGpuMemoryMB} MB GPU memory, maximum allowed is ${this.gpuQuota.maxGpuMemoryMb} MB`
      )
    }

    const requestedTimeMs = params.resourceLimits.timeoutMinutes * 60 * 1000
    if (requestedTimeMs > this.gpuQuota.maxTrainingTimeMs) {
      throw new Error(
        `GPU quota exceeded: requested training time ${params.resourceLimits.timeoutMinutes} minutes exceeds maximum allowed ${Math.round(this.gpuQuota.maxTrainingTimeMs / 60000)} minutes`
      )
    }

    const rowCount = dataset.rowCount ?? 100
    const stepsPerEpoch = Math.ceil(rowCount / params.hyperparams.batchSize)
    const totalSteps = stepsPerEpoch * params.hyperparams.epochs

    const job: TrainingJob = {
      id: generateId(),
      name: params.name,
      preset: params.preset,
      datasetId: params.datasetId,
      target: params.target,
      hyperparams: { ...params.hyperparams },
      resourceLimits: { ...params.resourceLimits },
      status: "queued",
      progress: 0,
      currentEpoch: 0,
      currentStep: 0,
      totalSteps,
      lossHistory: [],
      checkpoints: [],
      logs: [`[${new Date().toISOString()}] Job created: ${params.name}`],
    }

    this.jobs.push(job)
    this.emitChange()
    this.startJobSimulation(job)
    this.startJobTimeoutTimer(job)
    return job
  }

  pauseJob(jobId: string): TrainingJob {
    const job = this.jobs.find((j) => j.id === jobId)
    if (!job) throw new Error(`Job not found: ${jobId}`)
    if (job.status !== "running") throw new Error("Can only pause a running job")

    job.status = "paused"
    job.logs.push(`[${new Date().toISOString()}] Job paused at step ${job.currentStep}`)
    this.stopJobTimer(jobId)
    this.stopJobTimeoutTimer(jobId)
    this.emitChange()
    return job
  }

  resumeJob(jobId: string): TrainingJob {
    const job = this.jobs.find((j) => j.id === jobId)
    if (!job) throw new Error(`Job not found: ${jobId}`)
    if (job.status !== "paused") throw new Error("Can only resume a paused job")

    job.status = "running"
    job.logs.push(`[${new Date().toISOString()}] Job resumed at step ${job.currentStep}`)
    this.emitChange()
    this.startJobSimulation(job)
    this.startJobTimeoutTimer(job)
    return job
  }

  cancelJob(jobId: string): TrainingJob {
    const job = this.jobs.find((j) => j.id === jobId)
    if (!job) throw new Error(`Job not found: ${jobId}`)
    if (job.status === "completed" || job.status === "failed") {
      throw new Error(`Cannot cancel job in "${job.status}" state`)
    }

    job.status = "failed"
    job.error = "Cancelled by user"
    job.logs.push(`[${new Date().toISOString()}] Job cancelled`)
    this.stopJobTimer(jobId)
    this.stopJobTimeoutTimer(jobId)
    this.emitChange()
    return job
  }

  resumeFromCheckpoint(jobId: string, checkpointId: string): TrainingJob {
    const originalJob = this.jobs.find((j) => j.id === jobId)
    if (!originalJob) throw new Error(`Job not found: ${jobId}`)

    const checkpoint = originalJob.checkpoints.find((c) => c.id === checkpointId)
    if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`)

    const newJob: TrainingJob = {
      id: generateId(),
      name: `${originalJob.name} (resumed from step ${checkpoint.step})`,
      preset: originalJob.preset,
      datasetId: originalJob.datasetId,
      target: originalJob.target,
      hyperparams: { ...originalJob.hyperparams },
      resourceLimits: { ...originalJob.resourceLimits },
      status: "queued",
      progress: Math.round((checkpoint.step / originalJob.totalSteps) * 100),
      currentEpoch: Math.floor(checkpoint.step / Math.ceil(originalJob.totalSteps / originalJob.hyperparams.epochs)),
      currentStep: checkpoint.step,
      totalSteps: originalJob.totalSteps,
      lossHistory: originalJob.lossHistory.slice(0, checkpoint.step),
      loss: checkpoint.loss,
      checkpoints: [],
      logs: [
        `[${new Date().toISOString()}] Resumed from checkpoint at step ${checkpoint.step} (loss: ${checkpoint.loss.toFixed(4)})`,
      ],
    }

    this.jobs.push(newJob)
    this.emitChange()
    this.startJobSimulation(newJob)
    return newJob
  }

  removeJob(jobId: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === jobId)
    if (idx === -1) return false
    this.stopJobTimer(jobId)
    this.stopJobTimeoutTimer(jobId)
    this.jobs.splice(idx, 1)
    this.emitChange()
    return true
  }

  // ─── Job Simulation (progress ticking) ──────────────────

  private startJobSimulation(job: TrainingJob): void {
    // Move from queued to running
    if (job.status === "queued") {
      job.status = "running"
      job.startedAt = job.startedAt ?? Date.now()
      job.logs.push(`[${new Date().toISOString()}] Training started`)
      this.emitChange()
    }

    const intervalMs = 1500
    const timer = setInterval(() => {
      if (job.status !== "running") {
        this.stopJobTimer(job.id)
        return
      }

      job.currentStep++
      const stepsPerEpoch = Math.ceil(job.totalSteps / job.hyperparams.epochs)
      job.currentEpoch = Math.floor(job.currentStep / stepsPerEpoch)
      job.progress = Math.min(100, Math.round((job.currentStep / job.totalSteps) * 100))

      // Simulate decreasing loss with noise
      const baseLoss = 2.5 * Math.exp(-0.003 * job.currentStep)
      const noise = (Math.random() - 0.5) * 0.1
      job.loss = Math.max(0.01, baseLoss + noise)
      job.lossHistory.push(job.loss)

      // Elapsed time and ETA
      job.elapsedMs = Date.now() - (job.startedAt ?? Date.now())
      const msPerStep = job.elapsedMs / job.currentStep
      const remainingSteps = job.totalSteps - job.currentStep
      job.eta = remainingSteps > 0 ? Math.round(msPerStep * remainingSteps) : 0

      // Auto-checkpoint every 10% of total steps
      const checkpointInterval = Math.max(1, Math.floor(job.totalSteps * 0.1))
      if (job.currentStep % checkpointInterval === 0 && job.currentStep > 0) {
        const ckpt: Checkpoint = {
          id: generateId(),
          jobId: job.id,
          step: job.currentStep,
          loss: job.loss,
          timestamp: Date.now(),
          path: path.join(this.workspaceRoot, ".kilo", "checkpoints", job.id, `step-${job.currentStep}`),
          sizeBytes: Math.round(50 * 1024 * 1024 + Math.random() * 100 * 1024 * 1024),
        }
        job.checkpoints.push(ckpt)
        job.logs.push(
          `[${new Date().toISOString()}] Checkpoint saved at step ${ckpt.step} (loss: ${ckpt.loss.toFixed(4)})`
        )
      }

      // Job completion
      if (job.currentStep >= job.totalSteps) {
        job.status = "completed"
        job.progress = 100
        job.completedAt = Date.now()
        job.logs.push(
          `[${new Date().toISOString()}] Training completed. Final loss: ${job.loss.toFixed(4)}`
        )
        this.stopJobTimer(job.id)
        this.stopJobTimeoutTimer(job.id)
      }

      this.emitChange()
    }, intervalMs)

    this.jobTimers.set(job.id, timer)
  }

  private stopJobTimer(jobId: string): void {
    const timer = this.jobTimers.get(jobId)
    if (timer) {
      clearInterval(timer)
      this.jobTimers.delete(jobId)
    }
  }

  // ─── Job Timeout Enforcement ───────────────────────────────

  private startJobTimeoutTimer(job: TrainingJob): void {
    const timeoutMs = job.resourceLimits.timeoutMinutes * 60 * 1000
    if (timeoutMs <= 0) return

    // Clear any existing timeout timer for this job
    this.stopJobTimeoutTimer(job.id)

    const timer = setTimeout(() => {
      // Only auto-cancel if the job is still running or queued
      if (job.status === "running" || job.status === "queued") {
        job.status = "failed"
        job.error = "timeout"
        job.completedAt = Date.now()
        job.logs.push(
          `[${new Date().toISOString()}] Job auto-cancelled: exceeded timeout of ${job.resourceLimits.timeoutMinutes} minutes`
        )
        this.log.warn(`Job timed out`, { jobId: job.id, name: job.name, timeoutMinutes: job.resourceLimits.timeoutMinutes })
        this.stopJobTimer(job.id)
        this.jobTimeoutTimers.delete(job.id)
        this.emitChange()
      }
    }, timeoutMs)

    this.jobTimeoutTimers.set(job.id, timer)
  }

  private stopJobTimeoutTimer(jobId: string): void {
    const timer = this.jobTimeoutTimers.get(jobId)
    if (timer) {
      clearTimeout(timer)
      this.jobTimeoutTimers.delete(jobId)
    }
  }

  // ─── GPU Detection ──────────────────────────────────────

  async detectGPUs(): Promise<GPUInfo[]> {
    return new Promise((resolve) => {
      execFile(
        "nvidia-smi",
        [
          "--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu",
          "--format=csv,noheader,nounits",
        ],
        { timeout: 10000 },
        (error, stdout, stderr) => {
          if (error) {
            this.log.warn("nvidia-smi failed", { error: error.message })
            // Try to get driver/CUDA info from plain nvidia-smi
            this.gpuCache = []
            resolve([])
            return
          }

          // Also run plain nvidia-smi to get driver/CUDA version
          execFile("nvidia-smi", [], { timeout: 5000 }, (err2, stdout2) => {
            let driverVersion = ""
            let cudaVersion = ""

            if (!err2 && stdout2) {
              const driverMatch = stdout2.match(/Driver Version:\s*([\d.]+)/)
              if (driverMatch) driverVersion = driverMatch[1]
              const cudaMatch = stdout2.match(/CUDA Version:\s*([\d.]+)/)
              if (cudaMatch) cudaVersion = cudaMatch[1]
            }

            const gpus = parseNvidiaSmi(stdout)
            // Inject driver/CUDA version
            for (const gpu of gpus) {
              gpu.driverVersion = gpu.driverVersion || driverVersion
              gpu.cudaVersion = gpu.cudaVersion || cudaVersion
            }

            this.gpuCache = gpus
            resolve(gpus)
          })
        }
      )
    })
  }

  getCachedGPUs(): GPUInfo[] {
    return [...this.gpuCache]
  }

  // ─── Run Comparison ─────────────────────────────────────

  compareRuns(jobIdA: string, jobIdB: string): RunComparison {
    const jobA = this.jobs.find((j) => j.id === jobIdA)
    const jobB = this.jobs.find((j) => j.id === jobIdB)
    if (!jobA) throw new Error(`Job not found: ${jobIdA}`)
    if (!jobB) throw new Error(`Job not found: ${jobIdB}`)

    return {
      jobA,
      jobB,
      datasetA: this.datasets.find((d) => d.id === jobA.datasetId),
      datasetB: this.datasets.find((d) => d.id === jobB.datasetId),
    }
  }

  // ─── Model Export ───────────────────────────────────────

  validateExportOptions(options: ExportOptions): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Validate job exists and is completed
    const job = this.jobs.find((j) => j.id === options.jobId)
    if (!job) {
      errors.push(`Job not found: ${options.jobId}`)
    } else if (job.status !== "completed") {
      errors.push(`Job has not completed (current status: ${job.status}). Only completed jobs can be exported.`)
    }

    // Validate format
    const validFormats = ["gguf", "safetensors", "pytorch", "onnx"]
    if (!validFormats.includes(options.format)) {
      errors.push(`Invalid format "${options.format}". Must be one of: ${validFormats.join(", ")}`)
    }

    // Validate quantization
    const validQuantizations = ["none", "q4_0", "q4_1", "q5_0", "q5_1", "q8_0", "f16"]
    if (!validQuantizations.includes(options.quantization)) {
      errors.push(`Invalid quantization "${options.quantization}". Must be one of: ${validQuantizations.join(", ")}`)
    }

    // GGUF-specific: quantization other than "none" only makes sense for gguf
    if (options.format !== "gguf" && options.quantization !== "none" && options.quantization !== "f16") {
      errors.push(`Quantization "${options.quantization}" is only supported for GGUF format. Use "none" or "f16" for ${options.format}.`)
    }

    // Validate output path is provided
    if (!options.outputPath || options.outputPath.trim().length === 0) {
      errors.push("Output path must be specified")
    }

    // mergeAdapter only meaningful for LoRA/QLoRA presets
    if (options.mergeAdapter && job && job.preset !== "lora" && job.preset !== "qlora") {
      errors.push(`mergeAdapter is only applicable to LoRA/QLoRA jobs (this job uses preset "${job.preset}")`)
    }

    return { valid: errors.length === 0, errors }
  }

  estimateExportSize(jobId: string, format: string, quantization: string): number {
    const job = this.jobs.find((j) => j.id === jobId)
    if (!job) return 0

    // Base model size estimate derived from training steps and hyperparams.
    // In a real implementation this would come from the model architecture;
    // here we approximate using the relationship between dataset rows,
    // batch size, and epochs to infer a rough parameter count.
    const dataset = this.datasets.find((d) => d.id === job.datasetId)
    const rowCount = dataset?.rowCount ?? 100
    // Rough heuristic: ~1M params per 100 rows for a fine-tune adapter
    const estimatedParams = Math.max(1_000_000, rowCount * 10_000)

    // Bytes per parameter depends on quantization
    let bytesPerParam: number
    switch (quantization) {
      case "q4_0":
      case "q4_1":
        bytesPerParam = 0.5 // 4-bit
        break
      case "q5_0":
      case "q5_1":
        bytesPerParam = 0.625 // 5-bit
        break
      case "q8_0":
        bytesPerParam = 1.0 // 8-bit
        break
      case "f16":
        bytesPerParam = 2.0 // 16-bit
        break
      default: // "none" — full precision float32
        bytesPerParam = 4.0
        break
    }

    let modelBytes = Math.round(estimatedParams * bytesPerParam)

    // Format overhead multipliers
    switch (format) {
      case "gguf":
        modelBytes = Math.round(modelBytes * 1.02) // ~2% metadata overhead
        break
      case "onnx":
        modelBytes = Math.round(modelBytes * 1.15) // ONNX graph overhead
        break
      case "safetensors":
        modelBytes = Math.round(modelBytes * 1.01) // minimal header
        break
      case "pytorch":
        modelBytes = Math.round(modelBytes * 1.05) // pickle overhead
        break
    }

    // Add tokenizer + config estimates (~2 MB)
    return modelBytes + 2 * 1024 * 1024
  }

  async exportModel(options: ExportOptions): Promise<ExportResult> {
    // ── Validate ──
    const validation = this.validateExportOptions(options)
    if (!validation.valid) {
      throw new Error(`Export validation failed:\n${validation.errors.join("\n")}`)
    }

    const job = this.jobs.find((j) => j.id === options.jobId)!
    const exportId = generateId()

    // ── Ensure output directory ──
    const outputDir = options.outputPath || path.join(this.workspaceRoot, ".kilo", "exports")
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // ── Initialise ExportResult ──
    const result: ExportResult = {
      exportId,
      jobId: options.jobId,
      format: options.format,
      outputPath: outputDir,
      files: [],
      totalSizeBytes: 0,
      status: "pending",
      startedAt: Date.now(),
    }
    this.exports.set(exportId, result)
    this.emitChange()

    try {
      result.status = "exporting"
      this.emitChange()

      const safeName = job.name.replace(/[^a-zA-Z0-9_-]/g, "_")

      // ── Build export manifest & simulate files ──

      // 1. Model weight file
      const extMap: Record<string, string> = {
        gguf: ".gguf",
        safetensors: ".safetensors",
        pytorch: ".bin",
        onnx: ".onnx",
      }
      const modelFileName = `${safeName}${extMap[options.format] ?? ".bin"}`
      const modelFilePath = path.join(outputDir, modelFileName)
      const estimatedModelSize = this.estimateExportSize(options.jobId, options.format, options.quantization)
      result.files.push({
        name: modelFileName,
        path: modelFilePath,
        sizeBytes: estimatedModelSize,
        type: "model",
      })

      // 2. Tokenizer (optional)
      if (options.includeTokenizer) {
        const tokenizerPath = path.join(outputDir, "tokenizer.json")
        const tokenizerContent = JSON.stringify(
          {
            type: "BPE",
            version: "1.0",
            sourceJob: job.id,
            note: "Placeholder tokenizer — replace with actual tokenizer from base model",
          },
          null,
          2
        )
        fs.writeFileSync(tokenizerPath, tokenizerContent, "utf8")
        const tokenizerSize = Buffer.byteLength(tokenizerContent, "utf8")
        result.files.push({
          name: "tokenizer.json",
          path: tokenizerPath,
          sizeBytes: tokenizerSize,
          type: "tokenizer",
        })
      }

      // 3. Config (optional)
      if (options.includeConfig) {
        const configPath = path.join(outputDir, "config.json")
        const configContent = JSON.stringify(
          {
            model_type: "fine-tuned",
            source_job: job.id,
            source_job_name: job.name,
            preset: job.preset,
            format: options.format,
            quantization: options.quantization,
            merge_adapter: options.mergeAdapter,
            hyperparams: job.hyperparams,
            training: {
              total_steps: job.totalSteps,
              final_loss: job.loss,
              epochs: job.hyperparams.epochs,
              completed_at: job.completedAt,
            },
          },
          null,
          2
        )
        fs.writeFileSync(configPath, configContent, "utf8")
        const configSize = Buffer.byteLength(configContent, "utf8")
        result.files.push({
          name: "config.json",
          path: configPath,
          sizeBytes: configSize,
          type: "config",
        })
      }

      // 4. README model card (optional)
      if (options.includeReadme) {
        const readmePath = path.join(outputDir, "README.md")
        const dataset = this.datasets.find((d) => d.id === job.datasetId)
        const readmeContent = [
          `# ${job.name}`,
          "",
          `Fine-tuned model exported from KiloCode Training.`,
          "",
          "## Training Details",
          "",
          `| Field | Value |`,
          `|-------|-------|`,
          `| Preset | ${job.preset} |`,
          `| Dataset | ${dataset?.name ?? job.datasetId} |`,
          `| Epochs | ${job.hyperparams.epochs} |`,
          `| Learning Rate | ${job.hyperparams.learningRate} |`,
          `| Batch Size | ${job.hyperparams.batchSize} |`,
          `| Total Steps | ${job.totalSteps} |`,
          `| Final Loss | ${job.loss?.toFixed(4) ?? "N/A"} |`,
          "",
          "## Export Settings",
          "",
          `| Field | Value |`,
          `|-------|-------|`,
          `| Format | ${options.format} |`,
          `| Quantization | ${options.quantization} |`,
          `| Adapter Merged | ${options.mergeAdapter ? "Yes" : "No"} |`,
          `| Tokenizer Included | ${options.includeTokenizer ? "Yes" : "No"} |`,
          "",
          `Exported at: ${new Date().toISOString()}`,
          "",
        ].join("\n")
        fs.writeFileSync(readmePath, readmeContent, "utf8")
        const readmeSize = Buffer.byteLength(readmeContent, "utf8")
        result.files.push({
          name: "README.md",
          path: readmePath,
          sizeBytes: readmeSize,
          type: "readme",
        })
      }

      // 5. Metadata / manifest file (always written)
      const manifestPath = path.join(outputDir, `${safeName}.manifest.json`)
      const manifestContent = JSON.stringify(
        {
          exportId,
          exportedAt: Date.now(),
          format: options.format,
          quantization: options.quantization,
          mergeAdapter: options.mergeAdapter,
          sourceJob: {
            id: job.id,
            name: job.name,
            preset: job.preset,
            finalLoss: job.loss,
            totalSteps: job.totalSteps,
            hyperparams: job.hyperparams,
            completedAt: job.completedAt,
          },
          files: result.files.map((f) => ({ name: f.name, type: f.type, sizeBytes: f.sizeBytes })),
        },
        null,
        2
      )
      fs.writeFileSync(manifestPath, manifestContent, "utf8")
      const manifestSize = Buffer.byteLength(manifestContent, "utf8")
      result.files.push({
        name: `${safeName}.manifest.json`,
        path: manifestPath,
        sizeBytes: manifestSize,
        type: "metadata",
      })

      // ── Finalize ──
      result.totalSizeBytes = result.files.reduce((sum, f) => sum + f.sizeBytes, 0)
      result.status = "complete"
      result.completedAt = Date.now()

      job.logs.push(
        `[${new Date().toISOString()}] Model exported as ${options.format.toUpperCase()} (${options.quantization}) to ${outputDir} — ${result.files.length} files, ${(result.totalSizeBytes / (1024 * 1024)).toFixed(2)} MB`
      )
    } catch (err: unknown) {
      result.status = "failed"
      result.completedAt = Date.now()
      result.error = err instanceof Error ? err.message : String(err)
      job.logs.push(`[${new Date().toISOString()}] Export failed: ${result.error}`)
    }

    this.emitChange()
    return result
  }

  getExports(): ExportResult[] {
    return [...this.exports.values()]
  }

  getExport(exportId: string): ExportResult | undefined {
    return this.exports.get(exportId)
  }

  cancelExport(exportId: string): void {
    const result = this.exports.get(exportId)
    if (!result) throw new Error(`Export not found: ${exportId}`)
    if (result.status === "complete" || result.status === "failed") {
      throw new Error(`Cannot cancel an export that is already ${result.status}`)
    }
    result.status = "failed"
    result.error = "Cancelled by user"
    result.completedAt = Date.now()

    const job = this.jobs.find((j) => j.id === result.jobId)
    if (job) {
      job.logs.push(`[${new Date().toISOString()}] Export ${exportId} cancelled`)
    }
    this.emitChange()
  }

  // ─── Disposal ───────────────────────────────────────────

  dispose(): void {
    for (const timer of this.jobTimers.values()) {
      clearInterval(timer)
    }
    this.jobTimers.clear()
    for (const timer of this.jobTimeoutTimers.values()) {
      clearTimeout(timer)
    }
    this.jobTimeoutTimers.clear()
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
  }
}
