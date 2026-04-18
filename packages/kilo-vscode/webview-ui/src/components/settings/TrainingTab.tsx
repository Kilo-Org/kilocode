import { Component, createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { useVSCode } from "../../context/vscode"

// ─── Types ───────────────────────────────────────────────

interface Dataset {
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

interface Checkpoint {
  id: string
  jobId: string
  step: number
  loss: number
  timestamp: number
  path: string
  sizeBytes?: number
}

interface TrainingJob {
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

interface GPUInfo {
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

interface RunComparison {
  jobA: TrainingJob
  jobB: TrainingJob
  datasetA: Dataset | undefined
  datasetB: Dataset | undefined
}

// ─── Styles ──────────────────────────────────────────────

const inputStyle = {
  width: "100%",
  padding: "4px 8px",
  border: "1px solid var(--vscode-input-border)",
  background: "var(--vscode-input-background)",
  color: "var(--vscode-input-foreground)",
  "border-radius": "2px",
  "font-size": "13px",
  "box-sizing": "border-box" as const,
}

const selectStyle = {
  ...inputStyle,
  cursor: "pointer",
}

const buttonStyle = (variant: "primary" | "secondary" | "danger" = "secondary") => ({
  padding: "4px 12px",
  border:
    variant === "primary"
      ? "none"
      : variant === "danger"
        ? "1px solid var(--vscode-inputValidation-errorBorder)"
        : "1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border))",
  background:
    variant === "primary"
      ? "var(--vscode-button-background)"
      : variant === "danger"
        ? "var(--vscode-inputValidation-errorBackground)"
        : "var(--vscode-button-secondaryBackground)",
  color:
    variant === "primary"
      ? "var(--vscode-button-foreground)"
      : variant === "danger"
        ? "var(--vscode-errorForeground)"
        : "var(--vscode-button-secondaryForeground)",
  "border-radius": "2px",
  "font-size": "12px",
  cursor: "pointer",
  "white-space": "nowrap" as const,
})

const sectionStyle = {
  "margin-bottom": "16px",
  border: "1px solid var(--vscode-panel-border)",
  "border-radius": "4px",
  overflow: "hidden",
}

const sectionHeaderStyle = (clickable: boolean) => ({
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  padding: "8px 12px",
  cursor: clickable ? "pointer" : "default",
  "user-select": "none" as const,
  "font-weight": "600",
  "font-size": "13px",
  background: "var(--vscode-sideBarSectionHeader-background)",
  color: "var(--vscode-sideBarSectionHeader-foreground)",
  "border-bottom": "1px solid var(--vscode-panel-border)",
})

const sectionBodyStyle = {
  padding: "12px",
}

const badgeStyle = (color: string) => ({
  display: "inline-block",
  padding: "1px 8px",
  "border-radius": "10px",
  "font-size": "11px",
  "font-weight": "500",
  background: color,
  color: "#fff",
})

const cardStyle = {
  padding: "8px 12px",
  "margin-bottom": "8px",
  border: "1px solid var(--vscode-panel-border)",
  "border-radius": "4px",
  background: "var(--vscode-editor-background)",
}

const progressBarOuter = {
  width: "100%",
  height: "8px",
  "border-radius": "4px",
  background: "var(--vscode-progressBar-background, #333)",
  overflow: "hidden",
}

const labelStyle = {
  "font-size": "12px",
  color: "var(--vscode-descriptionForeground)",
  "margin-bottom": "4px",
}

const fieldGroupStyle = {
  "margin-bottom": "8px",
}

const rowStyle = {
  display: "flex",
  "align-items": "center",
  gap: "8px",
  "margin-bottom": "4px",
}

const inlineFormStyle = {
  display: "grid",
  "grid-template-columns": "1fr 1fr",
  gap: "8px",
}

// ─── Helpers ─────────────────────────────────────────────

function statusBadgeColor(status: TrainingJob["status"]): string {
  switch (status) {
    case "queued":
      return "var(--vscode-charts-blue, #3794ff)"
    case "running":
      return "var(--vscode-charts-yellow, #cca700)"
    case "paused":
      return "var(--vscode-charts-gray, #888)"
    case "completed":
      return "var(--vscode-charts-green, #89d185)"
    case "failed":
      return "var(--vscode-charts-red, #f14c4c)"
  }
}

function validationBadgeColor(status: Dataset["validationStatus"]): string {
  switch (status) {
    case "pending":
      return "var(--vscode-charts-yellow, #cca700)"
    case "passed":
      return "var(--vscode-charts-green, #89d185)"
    case "failed":
      return "var(--vscode-charts-red, #f14c4c)"
  }
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return "--"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "--"
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return "--"
  return new Date(ts).toLocaleString()
}

// ─── Component ───────────────────────────────────────────

const TrainingTab: Component = () => {
  const vscode = useVSCode()

  // ─── State ────────────────────────────────────────────

  // Datasets
  const [datasets, setDatasets] = createSignal<Dataset[]>([])
  const [showRegisterForm, setShowRegisterForm] = createSignal(false)
  const [regName, setRegName] = createSignal("")
  const [regPath, setRegPath] = createSignal("")
  const [regFormat, setRegFormat] = createSignal<Dataset["format"]>("jsonl")
  const [validatingId, setValidatingId] = createSignal<string | null>(null)

  // Training jobs
  const [jobs, setJobs] = createSignal<TrainingJob[]>([])
  const [showNewJobForm, setShowNewJobForm] = createSignal(false)
  const [jobName, setJobName] = createSignal("")
  const [jobPreset, setJobPreset] = createSignal<TrainingJob["preset"]>("lora")
  const [jobDatasetId, setJobDatasetId] = createSignal("")
  const [jobTarget, setJobTarget] = createSignal<TrainingJob["target"]>("local_gpu")
  const [jobLR, setJobLR] = createSignal("0.0003")
  const [jobEpochs, setJobEpochs] = createSignal("3")
  const [jobBatchSize, setJobBatchSize] = createSignal("4")
  const [jobWarmupSteps, setJobWarmupSteps] = createSignal("100")
  const [jobMaxGpuMem, setJobMaxGpuMem] = createSignal("8192")
  const [jobTimeout, setJobTimeout] = createSignal("120")
  const [expandedJobId, setExpandedJobId] = createSignal<string | null>(null)

  // GPUs
  const [gpus, setGpus] = createSignal<GPUInfo[]>([])
  const [detectingGPU, setDetectingGPU] = createSignal(false)

  // Compare
  const [compareJobA, setCompareJobA] = createSignal("")
  const [compareJobB, setCompareJobB] = createSignal("")
  const [comparison, setComparison] = createSignal<RunComparison | null>(null)

  // Export
  const [exportJobId, setExportJobId] = createSignal("")
  const [exportFormat, setExportFormat] = createSignal<"gguf" | "safetensors" | "onnx">("safetensors")
  const [exporting, setExporting] = createSignal(false)

  // Sections
  const [datasetSectionOpen, setDatasetSectionOpen] = createSignal(true)
  const [jobsSectionOpen, setJobsSectionOpen] = createSignal(true)
  const [gpuSectionOpen, setGpuSectionOpen] = createSignal(true)
  const [checkpointSectionOpen, setCheckpointSectionOpen] = createSignal(true)

  // ─── Message Handling ─────────────────────────────────

  const unsubscribe = vscode.onMessage((message) => {
    switch (message.type) {
      case "trainingState": {
        const data = message as { type: string; datasets: Dataset[]; jobs: TrainingJob[]; gpus?: GPUInfo[] }
        setDatasets(data.datasets ?? [])
        setJobs(data.jobs ?? [])
        // Also process GPUs from trainingState responses
        if (data.gpus) setGpus(data.gpus)
        break
      }
      case "trainingDatasetRegistered": {
        const ds = message.dataset as Dataset
        setDatasets((prev) => [...prev, ds])
        setShowRegisterForm(false)
        setRegName("")
        setRegPath("")
        setRegFormat("jsonl")
        break
      }
      case "trainingDatasetValidated": {
        const ds = message.dataset as Dataset
        setDatasets((prev) => prev.map((d) => (d.id === ds.id ? ds : d)))
        setValidatingId(null)
        break
      }
      case "trainingJobLaunched": {
        const job = message.job as TrainingJob
        setJobs((prev) => [...prev, job])
        setShowNewJobForm(false)
        resetJobForm()
        break
      }
      case "trainingJobUpdated": {
        const job = message.job as TrainingJob
        setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)))
        break
      }
      case "trainingJobRemoved": {
        const id = message.jobId as string
        setJobs((prev) => prev.filter((j) => j.id !== id))
        break
      }
      case "trainingGPUDetected": {
        const detected = message.gpus as GPUInfo[]
        setGpus(detected ?? [])
        setDetectingGPU(false)
        break
      }
      case "trainingCompareResult": {
        const result = message.comparison as RunComparison
        setComparison(result)
        break
      }
      case "trainingExportComplete": {
        setExporting(false)
        break
      }
      case "trainingDatasetRemoved": {
        const id = message.datasetId as string
        setDatasets((prev) => prev.filter((d) => d.id !== id))
        break
      }
      case "trainingBrowsePathResult": {
        // Populate the path field from the OS file picker
        const data = message as unknown as { path: string }
        if (data.path) setRegPath(data.path)
        break
      }
      case "trainingError": {
        // Display error to user via console (could be enhanced with a toast)
        const data = message as unknown as { error: string }
        console.error("[Training]", data.error)
        setDetectingGPU(false)
        setExporting(false)
        setValidatingId(null)
        break
      }
    }
  })

  onCleanup(() => unsubscribe())

  // Request initial state
  vscode.postMessage({ type: "trainingGetJobs" })

  // ─── Actions ──────────────────────────────────────────

  function registerDataset() {
    if (!regName().trim() || !regPath().trim()) return
    vscode.postMessage({
      type: "trainingRegisterDataset",
      name: regName().trim(),
      sourcePath: regPath().trim(),
      format: regFormat(),
    })
  }

  function validateDataset(id: string) {
    setValidatingId(id)
    vscode.postMessage({ type: "trainingValidateDataset", datasetId: id })
  }

  function removeDataset(id: string) {
    vscode.postMessage({ type: "trainingRemoveDataset", datasetId: id })
  }

  function resetJobForm() {
    setJobName("")
    setJobPreset("lora")
    setJobDatasetId("")
    setJobTarget("local_gpu")
    setJobLR("0.0003")
    setJobEpochs("3")
    setJobBatchSize("4")
    setJobWarmupSteps("100")
    setJobMaxGpuMem("8192")
    setJobTimeout("120")
  }

  function applyPreset(preset: TrainingJob["preset"]) {
    setJobPreset(preset)
    switch (preset) {
      case "lora":
        setJobLR("0.0003")
        setJobEpochs("3")
        setJobBatchSize("4")
        setJobWarmupSteps("100")
        break
      case "qlora":
        setJobLR("0.0002")
        setJobEpochs("3")
        setJobBatchSize("2")
        setJobWarmupSteps("50")
        break
      case "custom":
        // leave values as-is for custom
        break
    }
  }

  function launchJob() {
    if (!jobName().trim() || !jobDatasetId()) return
    vscode.postMessage({
      type: "trainingLaunchJob",
      name: jobName().trim(),
      preset: jobPreset(),
      datasetId: jobDatasetId(),
      target: jobTarget(),
      hyperparams: {
        learningRate: parseFloat(jobLR()) || 0.0003,
        epochs: parseInt(jobEpochs(), 10) || 3,
        batchSize: parseInt(jobBatchSize(), 10) || 4,
        warmupSteps: parseInt(jobWarmupSteps(), 10) || 100,
      },
      resourceLimits: {
        maxGpuMemoryMB: parseInt(jobMaxGpuMem(), 10) || 8192,
        timeoutMinutes: parseInt(jobTimeout(), 10) || 120,
      },
    })
  }

  function pauseJob(id: string) {
    vscode.postMessage({ type: "trainingPauseJob", jobId: id })
  }

  function resumeJob(id: string) {
    vscode.postMessage({ type: "trainingResumeJob", jobId: id })
  }

  function cancelJob(id: string) {
    vscode.postMessage({ type: "trainingCancelJob", jobId: id })
  }

  function resumeFromCheckpoint(jobId: string, checkpointId: string) {
    vscode.postMessage({ type: "trainingResumeCheckpoint", jobId, checkpointId })
  }

  function detectGPUs() {
    setDetectingGPU(true)
    vscode.postMessage({ type: "trainingDetectGPU" })
  }

  function compareRuns() {
    if (!compareJobA() || !compareJobB() || compareJobA() === compareJobB()) return
    vscode.postMessage({ type: "trainingCompareRuns", jobIdA: compareJobA(), jobIdB: compareJobB() })
  }

  function exportModel() {
    if (!exportJobId()) return
    setExporting(true)
    vscode.postMessage({
      type: "trainingExportModel",
      jobId: exportJobId(),
      format: exportFormat(),
    })
  }

  function browsePath() {
    vscode.postMessage({ type: "trainingBrowsePath" })
  }

  // ─── Sub-components ───────────────────────────────────

  const ValidationDetails: Component<{ dataset: Dataset }> = (props) => (
    <Show when={(props.dataset.errors && props.dataset.errors.length > 0) || (props.dataset.warnings && props.dataset.warnings.length > 0)}>
      <div style={{ "margin-top": "6px", "font-size": "12px" }}>
        <For each={props.dataset.errors}>
          {(err) => (
            <div style={{ color: "var(--vscode-errorForeground)", "margin-bottom": "2px" }}>
              <span style={{ "font-weight": "600" }}>Error:</span> {err}
            </div>
          )}
        </For>
        <For each={props.dataset.warnings}>
          {(warn) => (
            <div style={{ color: "var(--vscode-editorWarning-foreground)", "margin-bottom": "2px" }}>
              <span style={{ "font-weight": "600" }}>Warning:</span> {warn}
            </div>
          )}
        </For>
      </div>
    </Show>
  )

  const LossDisplay: Component<{ history: number[]; currentLoss?: number }> = (props) => {
    const recentLoss = () => {
      const hist = props.history
      if (hist.length === 0) return []
      // Show last 20 entries as sparkline-like numbers
      return hist.slice(-20)
    }

    return (
      <div style={{ "font-size": "12px", "margin-top": "4px" }}>
        <div style={{ ...labelStyle, "font-weight": "600" }}>
          Loss: {props.currentLoss !== undefined ? props.currentLoss.toFixed(4) : "--"}
        </div>
        <Show when={recentLoss().length > 0}>
          <div
            style={{
              display: "flex",
              "align-items": "flex-end",
              gap: "2px",
              height: "32px",
              "margin-top": "4px",
              padding: "2px 0",
            }}
          >
            <For each={recentLoss()}>
              {(val) => {
                const maxVal = Math.max(...recentLoss(), 0.01)
                const heightPct = Math.max(2, Math.min(100, (val / maxVal) * 100))
                return (
                  <div
                    title={`Loss: ${val.toFixed(4)}`}
                    style={{
                      flex: "1",
                      "min-width": "3px",
                      "max-width": "12px",
                      height: `${heightPct}%`,
                      background: "var(--vscode-charts-blue, #3794ff)",
                      "border-radius": "1px 1px 0 0",
                      opacity: "0.8",
                    }}
                  />
                )
              }}
            </For>
          </div>
        </Show>
      </div>
    )
  }

  const GPUUtilizationBar: Component<{ label: string; value: number; max: number; unit: string }> = (props) => {
    const pct = () => (props.max > 0 ? Math.round((props.value / props.max) * 100) : 0)
    return (
      <div style={{ "margin-bottom": "6px" }}>
        <div style={{ display: "flex", "justify-content": "space-between", "font-size": "12px", "margin-bottom": "2px" }}>
          <span>{props.label}</span>
          <span>
            {props.value} / {props.max} {props.unit} ({pct()}%)
          </span>
        </div>
        <div style={progressBarOuter}>
          <div
            style={{
              width: `${pct()}%`,
              height: "100%",
              background:
                pct() > 90
                  ? "var(--vscode-charts-red, #f14c4c)"
                  : pct() > 70
                    ? "var(--vscode-charts-yellow, #cca700)"
                    : "var(--vscode-charts-green, #89d185)",
              "border-radius": "4px",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div style={{ padding: "0", "font-size": "13px" }}>
      {/* ─── Dataset Registry ──────────────────────────── */}
      <div style={sectionStyle}>
        <div
          style={sectionHeaderStyle(true)}
          onClick={() => setDatasetSectionOpen(!datasetSectionOpen())}
        >
          <span>{datasetSectionOpen() ? "\u25BC" : "\u25B6"} Dataset Registry</span>
          <button
            style={buttonStyle("primary")}
            onClick={(e) => {
              e.stopPropagation()
              setShowRegisterForm(!showRegisterForm())
            }}
          >
            Register Dataset
          </button>
        </div>
        <Show when={datasetSectionOpen()}>
          <div style={sectionBodyStyle}>
            {/* Register Form */}
            <Show when={showRegisterForm()}>
              <div style={{ ...cardStyle, "margin-bottom": "12px" }}>
                <div style={{ "font-weight": "600", "margin-bottom": "8px", "font-size": "12px" }}>
                  Register New Dataset
                </div>
                <div style={fieldGroupStyle}>
                  <div style={labelStyle}>Name</div>
                  <input
                    type="text"
                    style={inputStyle}
                    placeholder="my-training-data"
                    value={regName()}
                    onInput={(e) => setRegName(e.currentTarget.value)}
                  />
                </div>
                <div style={fieldGroupStyle}>
                  <div style={labelStyle}>Source Path</div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <input
                      type="text"
                      style={{ ...inputStyle, flex: "1" }}
                      placeholder="/path/to/dataset.jsonl"
                      value={regPath()}
                      onInput={(e) => setRegPath(e.currentTarget.value)}
                    />
                    <button style={buttonStyle("secondary")} onClick={browsePath}>
                      Browse...
                    </button>
                  </div>
                </div>
                <div style={fieldGroupStyle}>
                  <div style={labelStyle}>Format</div>
                  <select
                    style={selectStyle}
                    value={regFormat()}
                    onChange={(e) => setRegFormat(e.currentTarget.value as Dataset["format"])}
                  >
                    <option value="jsonl">JSONL</option>
                    <option value="parquet">Parquet</option>
                    <option value="csv">CSV</option>
                    <option value="folder">Folder</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: "6px", "justify-content": "flex-end" }}>
                  <button style={buttonStyle("secondary")} onClick={() => setShowRegisterForm(false)}>
                    Cancel
                  </button>
                  <button
                    style={buttonStyle("primary")}
                    onClick={registerDataset}
                    disabled={!regName().trim() || !regPath().trim()}
                  >
                    Register
                  </button>
                </div>
              </div>
            </Show>

            {/* Dataset List */}
            <Show
              when={datasets().length > 0}
              fallback={
                <div style={{ color: "var(--vscode-descriptionForeground)", "font-size": "12px", "text-align": "center", padding: "16px" }}>
                  No datasets registered. Click "Register Dataset" to add one.
                </div>
              }
            >
              <For each={datasets()}>
                {(ds) => (
                  <div style={cardStyle}>
                    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                      <div>
                        <span style={{ "font-weight": "600" }}>{ds.name}</span>
                        <span
                          style={{
                            "margin-left": "8px",
                            "font-size": "11px",
                            color: "var(--vscode-descriptionForeground)",
                            "text-transform": "uppercase",
                          }}
                        >
                          {ds.format}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
                        <span style={badgeStyle(validationBadgeColor(ds.validationStatus))}>
                          {ds.validationStatus}
                        </span>
                        <button
                          style={buttonStyle("secondary")}
                          onClick={() => validateDataset(ds.id)}
                          disabled={validatingId() === ds.id}
                        >
                          {validatingId() === ds.id ? "Validating..." : "Validate"}
                        </button>
                        <button style={buttonStyle("danger")} onClick={() => removeDataset(ds.id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                    <div
                      style={{
                        "margin-top": "4px",
                        "font-size": "12px",
                        color: "var(--vscode-descriptionForeground)",
                        "word-break": "break-all",
                      }}
                    >
                      {ds.sourcePath}
                    </div>
                    <div style={{ display: "flex", gap: "16px", "margin-top": "4px", "font-size": "12px" }}>
                      <Show when={ds.rowCount !== undefined}>
                        <span>Rows: {ds.rowCount!.toLocaleString()}</span>
                      </Show>
                      <Show when={ds.sizeBytes !== undefined}>
                        <span>Size: {formatBytes(ds.sizeBytes)}</span>
                      </Show>
                    </div>
                    <ValidationDetails dataset={ds} />
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>

      {/* ─── Training Jobs ─────────────────────────────── */}
      <div style={sectionStyle}>
        <div
          style={sectionHeaderStyle(true)}
          onClick={() => setJobsSectionOpen(!jobsSectionOpen())}
        >
          <span>{jobsSectionOpen() ? "\u25BC" : "\u25B6"} Training Jobs</span>
          <button
            style={buttonStyle("primary")}
            onClick={(e) => {
              e.stopPropagation()
              setShowNewJobForm(!showNewJobForm())
            }}
          >
            New Training Job
          </button>
        </div>
        <Show when={jobsSectionOpen()}>
          <div style={sectionBodyStyle}>
            {/* New Job Form */}
            <Show when={showNewJobForm()}>
              <div style={{ ...cardStyle, "margin-bottom": "12px" }}>
                <div style={{ "font-weight": "600", "margin-bottom": "8px", "font-size": "12px" }}>
                  Configure Training Job
                </div>

                <div style={fieldGroupStyle}>
                  <div style={labelStyle}>Job Name</div>
                  <input
                    type="text"
                    style={inputStyle}
                    placeholder="my-lora-finetune"
                    value={jobName()}
                    onInput={(e) => setJobName(e.currentTarget.value)}
                  />
                </div>

                <div style={inlineFormStyle}>
                  <div style={fieldGroupStyle}>
                    <div style={labelStyle}>Preset</div>
                    <select
                      style={selectStyle}
                      value={jobPreset()}
                      onChange={(e) => applyPreset(e.currentTarget.value as TrainingJob["preset"])}
                    >
                      <option value="lora">LoRA</option>
                      <option value="qlora">QLoRA</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  <div style={fieldGroupStyle}>
                    <div style={labelStyle}>Dataset</div>
                    <select
                      style={selectStyle}
                      value={jobDatasetId()}
                      onChange={(e) => setJobDatasetId(e.currentTarget.value)}
                    >
                      <option value="">-- Select Dataset --</option>
                      <For each={datasets().filter((d) => d.validationStatus === "passed")}>
                        {(ds) => <option value={ds.id}>{ds.name}</option>}
                      </For>
                    </select>
                  </div>
                </div>

                <div style={fieldGroupStyle}>
                  <div style={labelStyle}>Target</div>
                  <select
                    style={selectStyle}
                    value={jobTarget()}
                    onChange={(e) => setJobTarget(e.currentTarget.value as TrainingJob["target"])}
                  >
                    <option value="local_gpu">Local GPU</option>
                    <option value="remote_gpu">Remote GPU</option>
                  </select>
                </div>

                {/* Hyperparameters */}
                <div style={{ "margin-top": "8px", "margin-bottom": "4px", "font-weight": "600", "font-size": "12px" }}>
                  Hyperparameters
                </div>
                <div style={inlineFormStyle}>
                  <div style={fieldGroupStyle}>
                    <div style={labelStyle}>Learning Rate</div>
                    <input
                      type="number"
                      step="0.00001"
                      style={inputStyle}
                      value={jobLR()}
                      onInput={(e) => setJobLR(e.currentTarget.value)}
                    />
                  </div>
                  <div style={fieldGroupStyle}>
                    <div style={labelStyle}>Epochs</div>
                    <input
                      type="number"
                      min="1"
                      style={inputStyle}
                      value={jobEpochs()}
                      onInput={(e) => setJobEpochs(e.currentTarget.value)}
                    />
                  </div>
                  <div style={fieldGroupStyle}>
                    <div style={labelStyle}>Batch Size</div>
                    <input
                      type="number"
                      min="1"
                      style={inputStyle}
                      value={jobBatchSize()}
                      onInput={(e) => setJobBatchSize(e.currentTarget.value)}
                    />
                  </div>
                  <div style={fieldGroupStyle}>
                    <div style={labelStyle}>Warmup Steps</div>
                    <input
                      type="number"
                      min="0"
                      style={inputStyle}
                      value={jobWarmupSteps()}
                      onInput={(e) => setJobWarmupSteps(e.currentTarget.value)}
                    />
                  </div>
                </div>

                {/* Resource Limits */}
                <div style={{ "margin-top": "8px", "margin-bottom": "4px", "font-weight": "600", "font-size": "12px" }}>
                  Resource Limits
                </div>
                <div style={inlineFormStyle}>
                  <div style={fieldGroupStyle}>
                    <div style={labelStyle}>Max GPU Memory (MB)</div>
                    <input
                      type="number"
                      min="512"
                      style={inputStyle}
                      value={jobMaxGpuMem()}
                      onInput={(e) => setJobMaxGpuMem(e.currentTarget.value)}
                    />
                  </div>
                  <div style={fieldGroupStyle}>
                    <div style={labelStyle}>Timeout (minutes)</div>
                    <input
                      type="number"
                      min="1"
                      style={inputStyle}
                      value={jobTimeout()}
                      onInput={(e) => setJobTimeout(e.currentTarget.value)}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px", "justify-content": "flex-end", "margin-top": "8px" }}>
                  <button
                    style={buttonStyle("secondary")}
                    onClick={() => {
                      setShowNewJobForm(false)
                      resetJobForm()
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    style={buttonStyle("primary")}
                    onClick={launchJob}
                    disabled={!jobName().trim() || !jobDatasetId()}
                  >
                    Launch Training
                  </button>
                </div>
              </div>
            </Show>

            {/* Job List */}
            <Show
              when={jobs().length > 0}
              fallback={
                <div style={{ color: "var(--vscode-descriptionForeground)", "font-size": "12px", "text-align": "center", padding: "16px" }}>
                  No training jobs. Click "New Training Job" to start one.
                </div>
              }
            >
              <For each={jobs()}>
                {(job) => {
                  const isExpanded = () => expandedJobId() === job.id
                  const dataset = () => datasets().find((d) => d.id === job.datasetId)

                  return (
                    <div style={cardStyle}>
                      {/* Job header */}
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          "justify-content": "space-between",
                          cursor: "pointer",
                        }}
                        onClick={() => setExpandedJobId(isExpanded() ? null : job.id)}
                      >
                        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                          <span style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
                            {isExpanded() ? "\u25BC" : "\u25B6"}
                          </span>
                          <span style={{ "font-weight": "600" }}>{job.name}</span>
                          <span style={badgeStyle(statusBadgeColor(job.status))}>
                            {job.status}
                            {job.status === "running" ? ` ${job.progress}%` : ""}
                          </span>
                          <span
                            style={{
                              "font-size": "11px",
                              color: "var(--vscode-descriptionForeground)",
                              "text-transform": "uppercase",
                            }}
                          >
                            {job.preset}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "4px" }} onClick={(e) => e.stopPropagation()}>
                          <Show when={job.status === "running"}>
                            <button style={buttonStyle("secondary")} onClick={() => pauseJob(job.id)}>
                              Pause
                            </button>
                          </Show>
                          <Show when={job.status === "paused"}>
                            <button style={buttonStyle("primary")} onClick={() => resumeJob(job.id)}>
                              Resume
                            </button>
                          </Show>
                          <Show when={job.status === "running" || job.status === "queued"}>
                            <button style={buttonStyle("danger")} onClick={() => cancelJob(job.id)}>
                              Cancel
                            </button>
                          </Show>
                        </div>
                      </div>

                      {/* Progress bar for running jobs */}
                      <Show when={job.status === "running" || job.status === "paused"}>
                        <div style={{ "margin-top": "6px" }}>
                          <div style={progressBarOuter}>
                            <div
                              style={{
                                width: `${job.progress}%`,
                                height: "100%",
                                background:
                                  job.status === "paused"
                                    ? "var(--vscode-charts-gray, #888)"
                                    : "var(--vscode-progressBar-background, #0e70c0)",
                                "border-radius": "4px",
                                transition: "width 0.3s ease",
                              }}
                            />
                          </div>
                        </div>
                      </Show>

                      {/* Expanded details */}
                      <Show when={isExpanded()}>
                        <div
                          style={{
                            "margin-top": "8px",
                            "padding-top": "8px",
                            "border-top": "1px solid var(--vscode-panel-border)",
                            "font-size": "12px",
                          }}
                        >
                          {/* Stats grid */}
                          <div
                            style={{
                              display: "grid",
                              "grid-template-columns": "1fr 1fr 1fr",
                              gap: "8px",
                              "margin-bottom": "8px",
                            }}
                          >
                            <div>
                              <span style={labelStyle}>Epoch</span>
                              <div>
                                {job.currentEpoch} / {job.hyperparams.epochs}
                              </div>
                            </div>
                            <div>
                              <span style={labelStyle}>Step</span>
                              <div>
                                {job.currentStep.toLocaleString()} / {job.totalSteps.toLocaleString()}
                              </div>
                            </div>
                            <div>
                              <span style={labelStyle}>Elapsed</span>
                              <div>{formatDuration(job.elapsedMs)}</div>
                            </div>
                            <div>
                              <span style={labelStyle}>ETA</span>
                              <div>{formatDuration(job.eta)}</div>
                            </div>
                            <div>
                              <span style={labelStyle}>Dataset</span>
                              <div>{dataset()?.name ?? job.datasetId}</div>
                            </div>
                            <div>
                              <span style={labelStyle}>Target</span>
                              <div>{job.target === "local_gpu" ? "Local GPU" : "Remote GPU"}</div>
                            </div>
                          </div>

                          {/* Hyperparams */}
                          <div style={{ "margin-bottom": "8px" }}>
                            <div style={{ ...labelStyle, "font-weight": "600" }}>Hyperparameters</div>
                            <div
                              style={{
                                display: "grid",
                                "grid-template-columns": "1fr 1fr 1fr 1fr",
                                gap: "4px",
                                "font-size": "11px",
                              }}
                            >
                              <span>LR: {job.hyperparams.learningRate}</span>
                              <span>Epochs: {job.hyperparams.epochs}</span>
                              <span>Batch: {job.hyperparams.batchSize}</span>
                              <span>Warmup: {job.hyperparams.warmupSteps}</span>
                            </div>
                          </div>

                          {/* Loss chart */}
                          <LossDisplay history={job.lossHistory} currentLoss={job.loss} />

                          {/* Checkpoints */}
                          <Show when={job.checkpoints.length > 0}>
                            <div style={{ "margin-top": "8px" }}>
                              <div style={{ ...labelStyle, "font-weight": "600", "margin-bottom": "4px" }}>
                                Checkpoints ({job.checkpoints.length})
                              </div>
                              <For each={job.checkpoints}>
                                {(ckpt) => (
                                  <div
                                    style={{
                                      display: "flex",
                                      "align-items": "center",
                                      "justify-content": "space-between",
                                      padding: "4px 8px",
                                      "margin-bottom": "2px",
                                      background: "var(--vscode-textBlockQuote-background)",
                                      "border-radius": "2px",
                                      "font-size": "11px",
                                    }}
                                  >
                                    <div style={{ display: "flex", gap: "12px" }}>
                                      <span>Step {ckpt.step.toLocaleString()}</span>
                                      <span>Loss: {ckpt.loss.toFixed(4)}</span>
                                      <span>{formatTimestamp(ckpt.timestamp)}</span>
                                      <Show when={ckpt.sizeBytes}>
                                        <span>{formatBytes(ckpt.sizeBytes)}</span>
                                      </Show>
                                    </div>
                                    <button
                                      style={buttonStyle("secondary")}
                                      onClick={() => resumeFromCheckpoint(job.id, ckpt.id)}
                                    >
                                      Resume
                                    </button>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>

                          {/* Error display */}
                          <Show when={job.error}>
                            <div
                              style={{
                                "margin-top": "8px",
                                padding: "6px 8px",
                                background: "var(--vscode-inputValidation-errorBackground)",
                                border: "1px solid var(--vscode-inputValidation-errorBorder)",
                                "border-radius": "2px",
                                "font-size": "12px",
                                color: "var(--vscode-errorForeground)",
                              }}
                            >
                              {job.error}
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>
      </div>

      {/* ─── GPU Resources ─────────────────────────────── */}
      <div style={sectionStyle}>
        <div
          style={sectionHeaderStyle(true)}
          onClick={() => setGpuSectionOpen(!gpuSectionOpen())}
        >
          <span>{gpuSectionOpen() ? "\u25BC" : "\u25B6"} GPU Resources</span>
          <button
            style={buttonStyle("primary")}
            onClick={(e) => {
              e.stopPropagation()
              detectGPUs()
            }}
            disabled={detectingGPU()}
          >
            {detectingGPU() ? "Detecting..." : "Detect GPUs"}
          </button>
        </div>
        <Show when={gpuSectionOpen()}>
          <div style={sectionBodyStyle}>
            <Show
              when={gpus().length > 0}
              fallback={
                <div style={{ color: "var(--vscode-descriptionForeground)", "font-size": "12px", "text-align": "center", padding: "16px" }}>
                  No GPUs detected. Click "Detect GPUs" to scan for available hardware.
                </div>
              }
            >
              <For each={gpus()}>
                {(gpu) => (
                  <div style={cardStyle}>
                    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "8px" }}>
                      <div>
                        <span style={{ "font-weight": "600" }}>GPU {gpu.index}: {gpu.name}</span>
                      </div>
                      <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                        {gpu.temperature > 0 ? `${gpu.temperature}\u00B0C` : ""}
                      </span>
                    </div>

                    <GPUUtilizationBar
                      label="VRAM"
                      value={gpu.vramUsed}
                      max={gpu.vramTotal}
                      unit="MiB"
                    />

                    <GPUUtilizationBar
                      label="Utilization"
                      value={gpu.utilization}
                      max={100}
                      unit="%"
                    />

                    <div
                      style={{
                        display: "flex",
                        gap: "16px",
                        "font-size": "11px",
                        color: "var(--vscode-descriptionForeground)",
                        "margin-top": "4px",
                      }}
                    >
                      <Show when={gpu.driverVersion}>
                        <span>Driver: {gpu.driverVersion}</span>
                      </Show>
                      <Show when={gpu.cudaVersion}>
                        <span>CUDA: {gpu.cudaVersion}</span>
                      </Show>
                      <span>Free VRAM: {gpu.vramFree} MiB</span>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>

      {/* ─── Checkpoint & Compare ──────────────────────── */}
      <div style={sectionStyle}>
        <div
          style={sectionHeaderStyle(true)}
          onClick={() => setCheckpointSectionOpen(!checkpointSectionOpen())}
        >
          <span>{checkpointSectionOpen() ? "\u25BC" : "\u25B6"} Checkpoint & Compare</span>
        </div>
        <Show when={checkpointSectionOpen()}>
          <div style={sectionBodyStyle}>
            {/* Compare Runs */}
            <div style={{ "margin-bottom": "16px" }}>
              <div style={{ "font-weight": "600", "font-size": "12px", "margin-bottom": "8px" }}>
                Compare Runs
              </div>
              <div style={{ display: "flex", gap: "8px", "align-items": "flex-end" }}>
                <div style={{ flex: "1" }}>
                  <div style={labelStyle}>Job A</div>
                  <select
                    style={selectStyle}
                    value={compareJobA()}
                    onChange={(e) => {
                      setCompareJobA(e.currentTarget.value)
                      setComparison(null)
                    }}
                  >
                    <option value="">-- Select --</option>
                    <For each={jobs()}>
                      {(j) => <option value={j.id}>{j.name}</option>}
                    </For>
                  </select>
                </div>
                <div style={{ flex: "1" }}>
                  <div style={labelStyle}>Job B</div>
                  <select
                    style={selectStyle}
                    value={compareJobB()}
                    onChange={(e) => {
                      setCompareJobB(e.currentTarget.value)
                      setComparison(null)
                    }}
                  >
                    <option value="">-- Select --</option>
                    <For each={jobs()}>
                      {(j) => <option value={j.id}>{j.name}</option>}
                    </For>
                  </select>
                </div>
                <button
                  style={buttonStyle("primary")}
                  onClick={compareRuns}
                  disabled={!compareJobA() || !compareJobB() || compareJobA() === compareJobB()}
                >
                  Compare
                </button>
              </div>

              {/* Comparison Results */}
              <Show when={comparison()}>
                {(cmp) => {
                  const a = cmp().jobA
                  const b = cmp().jobB
                  return (
                    <div
                      style={{
                        "margin-top": "12px",
                        border: "1px solid var(--vscode-panel-border)",
                        "border-radius": "4px",
                        overflow: "hidden",
                      }}
                    >
                      <table
                        style={{
                          width: "100%",
                          "border-collapse": "collapse",
                          "font-size": "12px",
                        }}
                      >
                        <thead>
                          <tr style={{ background: "var(--vscode-sideBarSectionHeader-background)" }}>
                            <th style={{ padding: "6px 8px", "text-align": "left", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              Metric
                            </th>
                            <th style={{ padding: "6px 8px", "text-align": "left", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              {a.name}
                            </th>
                            <th style={{ padding: "6px 8px", "text-align": "left", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              {b.name}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>Status</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              <span style={badgeStyle(statusBadgeColor(a.status))}>{a.status}</span>
                            </td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              <span style={badgeStyle(statusBadgeColor(b.status))}>{b.status}</span>
                            </td>
                          </tr>
                          <tr>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>Final Loss</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              {a.loss !== undefined ? a.loss.toFixed(4) : "--"}
                            </td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              {b.loss !== undefined ? b.loss.toFixed(4) : "--"}
                            </td>
                          </tr>
                          <tr>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>Training Time</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              {formatDuration(a.elapsedMs ?? (a.completedAt && a.startedAt ? a.completedAt - a.startedAt : undefined))}
                            </td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              {formatDuration(b.elapsedMs ?? (b.completedAt && b.startedAt ? b.completedAt - b.startedAt : undefined))}
                            </td>
                          </tr>
                          <tr>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>Preset</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{a.preset.toUpperCase()}</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{b.preset.toUpperCase()}</td>
                          </tr>
                          <tr>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>Learning Rate</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{a.hyperparams.learningRate}</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{b.hyperparams.learningRate}</td>
                          </tr>
                          <tr>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>Epochs</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{a.hyperparams.epochs}</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{b.hyperparams.epochs}</td>
                          </tr>
                          <tr>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>Batch Size</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{a.hyperparams.batchSize}</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{b.hyperparams.batchSize}</td>
                          </tr>
                          <tr>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>Total Steps</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{a.totalSteps.toLocaleString()}</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>{b.totalSteps.toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>Dataset</td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              {cmp().datasetA?.name ?? a.datasetId}
                            </td>
                            <td style={{ padding: "4px 8px", "border-bottom": "1px solid var(--vscode-panel-border)" }}>
                              {cmp().datasetB?.name ?? b.datasetId}
                            </td>
                          </tr>
                          <tr>
                            <td style={{ padding: "4px 8px" }}>Checkpoints</td>
                            <td style={{ padding: "4px 8px" }}>{a.checkpoints.length}</td>
                            <td style={{ padding: "4px 8px" }}>{b.checkpoints.length}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )
                }}
              </Show>
            </div>

            {/* Export Model */}
            <div>
              <div style={{ "font-weight": "600", "font-size": "12px", "margin-bottom": "8px" }}>
                Export Model
              </div>
              <div style={{ display: "flex", gap: "8px", "align-items": "flex-end" }}>
                <div style={{ flex: "1" }}>
                  <div style={labelStyle}>Completed Job</div>
                  <select
                    style={selectStyle}
                    value={exportJobId()}
                    onChange={(e) => setExportJobId(e.currentTarget.value)}
                  >
                    <option value="">-- Select --</option>
                    <For each={jobs().filter((j) => j.status === "completed")}>
                      {(j) => <option value={j.id}>{j.name}</option>}
                    </For>
                  </select>
                </div>
                <div style={{ flex: "1" }}>
                  <div style={labelStyle}>Format</div>
                  <select
                    style={selectStyle}
                    value={exportFormat()}
                    onChange={(e) => setExportFormat(e.currentTarget.value as "gguf" | "safetensors" | "onnx")}
                  >
                    <option value="safetensors">SafeTensors</option>
                    <option value="gguf">GGUF</option>
                    <option value="onnx">ONNX</option>
                  </select>
                </div>
                <button
                  style={buttonStyle("primary")}
                  onClick={exportModel}
                  disabled={!exportJobId() || exporting()}
                >
                  {exporting() ? "Exporting..." : "Export"}
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}

export default TrainingTab
