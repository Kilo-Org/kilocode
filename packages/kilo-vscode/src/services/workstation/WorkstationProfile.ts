/**
 * WorkstationProfile — hardware-aware execution context
 *
 * Provides a structured profile of the operator's machine so that
 * routing, training, ZeroClaw, and memory services can make
 * hardware-aware decisions (prefer local GPU, respect VRAM limits,
 * choose local inference over cloud when appropriate).
 */

import * as vscode from "vscode"
import * as os from "os"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { KiloLogger } from "../KiloLogger"

// ─── Interfaces ────────────────────────────────────────────

export interface GpuSpec {
  model: string
  vramGb: number
}

export interface HardwareSpec {
  motherboard: string
  platform: string
  chipset: string
  cpuClass: string
  ramGb: number
  gpu: GpuSpec
  storageType: string
  storageCapacityTb: number
}

export interface LocalAIEndpoint {
  enabled: boolean
  apiBase: string
  modelsPath?: string
}

export interface LocalAIConfig {
  lmStudio: LocalAIEndpoint
  ollama: LocalAIEndpoint
}

export interface RoutingPreferences {
  preferLocalFor: string[]
  preferCloudFor: string[]
}

export interface WorkstationLimits {
  maxParallelJobs: number
  maxGpuJobs: number
  maxMemoryPerJobGb: number
  maxGpuMemoryMb: number
  maxTrainingTimeMs: number
}

export interface WorkstationPaths {
  workspace: string
  downloads: string
  models: string
  loraRoot: string
  comfyuiModels: string
  ollamaModels: string
}

// ─── Model Library ────────────────────────────────────────

export type ModelCategory =
  | "llm"
  | "lora"
  | "embedding"
  | "tts"
  | "stt"
  | "image"
  | "video"
  | "music"
  | "voice_clone"
  | "comfyui"
  | "other"

export interface ModelLibraryEntry {
  category: ModelCategory
  path: string
  estimatedSizeGb: number
  provider: "lmstudio" | "ollama" | "comfyui" | "standalone"
  description: string
}

export interface ModelLibrary {
  entries: ModelLibraryEntry[]
  totalEstimatedSizeGb: number
  lmStudioModelsPath: string
  ollamaModelsPath: string
  loraPath: string
  comfyuiModelsPath: string
  mediaModelsPath: string
}

export interface WorkstationConfig {
  name: string
  hardware: HardwareSpec
  paths: WorkstationPaths
  localAI: LocalAIConfig
  modelLibrary: ModelLibrary
  capabilities: {
    canRunLargeModels: boolean
    maxContextEstimate: string
    supportsLocalTraining: boolean
    supportsParallelAgents: boolean
  }
  routingPreferences: RoutingPreferences
  limits: WorkstationLimits
}

// ─── Default profile (matches dave-main-workstation) ──────

const DEFAULT_PROFILE: WorkstationConfig = {
  name: "dave-main-workstation",
  hardware: {
    motherboard: "MSI_MEG_X570S_ACE_MAX",
    platform: "AMD_AM4",
    chipset: "X570",
    cpuClass: "high_end_desktop",
    ramGb: 128,
    gpu: { model: "RTX_3090_Ti", vramGb: 24 },
    storageType: "NVMe",
    storageCapacityTb: 4,
  },
  paths: {
    workspace: "G:\\Github",
    downloads: "C:\\Users\\Admin\\Downloads\\VPS",
    models: "C:\\Users\\Admin\\.lmstudio\\models",
    loraRoot: "G:\\LoRAs",
    comfyuiModels: "G:\\ComfyUI\\models",
    ollamaModels: "C:\\Users\\Admin\\.ollama\\models",
  },
  localAI: {
    lmStudio: {
      enabled: true,
      apiBase: "http://localhost:1234",
      modelsPath: "C:\\Users\\Admin\\.lmstudio\\models",
    },
    ollama: {
      enabled: true,
      apiBase: "http://localhost:11434",
    },
  },
  modelLibrary: {
    lmStudioModelsPath: "C:\\Users\\Admin\\.lmstudio\\models",
    ollamaModelsPath: "C:\\Users\\Admin\\.ollama\\models",
    loraPath: "G:\\LoRAs",
    comfyuiModelsPath: "G:\\ComfyUI\\models",
    mediaModelsPath: "G:\\Models",
    totalEstimatedSizeGb: 800,
    entries: [
      { category: "llm", path: "C:\\Users\\Admin\\.lmstudio\\models", estimatedSizeGb: 700, provider: "lmstudio", description: "LM Studio model library — 700GB of LLMs, chat, code, instruct models" },
      { category: "llm", path: "C:\\Users\\Admin\\.ollama\\models", estimatedSizeGb: 20, provider: "ollama", description: "Ollama model library — pulled models for local inference" },
      { category: "lora", path: "G:\\LoRAs", estimatedSizeGb: 10, provider: "standalone", description: "LoRA adapters for fine-tuning and model customization" },
      { category: "comfyui", path: "G:\\ComfyUI\\models", estimatedSizeGb: 30, provider: "comfyui", description: "ComfyUI models — checkpoints, VAE, ControlNet, upscalers" },
      { category: "tts", path: "G:\\Models\\TTS", estimatedSizeGb: 5, provider: "standalone", description: "Text-to-speech models" },
      { category: "stt", path: "G:\\Models\\STT", estimatedSizeGb: 3, provider: "standalone", description: "Speech-to-text / transcription models" },
      { category: "image", path: "G:\\Models\\Image", estimatedSizeGb: 15, provider: "standalone", description: "Image generation and editing models (Stable Diffusion, etc.)" },
      { category: "video", path: "G:\\Models\\Video", estimatedSizeGb: 10, provider: "standalone", description: "Video generation and processing models" },
      { category: "music", path: "G:\\Models\\Music", estimatedSizeGb: 3, provider: "standalone", description: "Music generation models" },
      { category: "voice_clone", path: "G:\\Models\\Voice", estimatedSizeGb: 2, provider: "standalone", description: "Voice cloning and voice conversion models" },
    ],
  },
  capabilities: {
    canRunLargeModels: true,
    maxContextEstimate: "128k",
    supportsLocalTraining: true,
    supportsParallelAgents: true,
  },
  routingPreferences: {
    preferLocalFor: ["memory_tasks", "embeddings", "small_generation", "private_data_tasks"],
    preferCloudFor: ["large_planning", "contract_generation", "high_parallel_execution"],
  },
  limits: {
    maxParallelJobs: 4,
    maxGpuJobs: 1,
    maxMemoryPerJobGb: 48,
    maxGpuMemoryMb: 24576,
    maxTrainingTimeMs: 86400000,
  },
}

// ─── Service ──────────────────────────────────────────────

export class WorkstationProfileService implements vscode.Disposable {
  private profile: WorkstationConfig
  private readonly log = KiloLogger.for("WorkstationProfile")

  constructor() {
    // Load config overrides first, then detect real hardware
    this.profile = this.loadProfile()
    // Overlay real hardware detection on top of config/defaults
    this.detectAndApplyHardware()
    // Scan model directories for real entries
    this.scanModelDirectories()
  }

  // ─── Real Hardware Detection ─────────────────────────────

  /** Detect actual CPU, RAM, platform, and GPU from the system. */
  private detectAndApplyHardware(): void {
    try {
      // CPU detection
      const cpus = os.cpus()
      if (cpus.length > 0) {
        this.profile.hardware.cpuClass = this.classifyCpu(cpus[0].model, cpus.length)
        this.profile.hardware.platform = `${os.arch()}_${os.platform()}`
      }

      // RAM detection
      const totalMemBytes = os.totalmem()
      const totalMemGb = Math.round(totalMemBytes / (1024 * 1024 * 1024))
      this.profile.hardware.ramGb = totalMemGb

      // GPU detection via nvidia-smi
      const gpu = this.detectGpu()
      if (gpu) {
        this.profile.hardware.gpu = gpu
        this.profile.limits.maxGpuMemoryMb = gpu.vramGb * 1024
      }

      // Update capabilities based on detected hardware
      this.profile.capabilities.canRunLargeModels = totalMemGb >= 32 && (this.profile.hardware.gpu.vramGb >= 8)
      this.profile.capabilities.supportsLocalTraining = this.profile.hardware.gpu.vramGb >= 8
      this.profile.capabilities.supportsParallelAgents = cpus.length >= 8 && totalMemGb >= 32

      // Estimate max context based on RAM + VRAM
      if (totalMemGb >= 128 && this.profile.hardware.gpu.vramGb >= 24) {
        this.profile.capabilities.maxContextEstimate = "128k"
      } else if (totalMemGb >= 64 && this.profile.hardware.gpu.vramGb >= 12) {
        this.profile.capabilities.maxContextEstimate = "64k"
      } else if (totalMemGb >= 32) {
        this.profile.capabilities.maxContextEstimate = "32k"
      } else {
        this.profile.capabilities.maxContextEstimate = "8k"
      }

      // Update limits based on detected resources
      const cpuCount = cpus.length
      this.profile.limits.maxParallelJobs = Math.max(1, Math.floor(cpuCount / 4))
      this.profile.limits.maxMemoryPerJobGb = Math.max(4, Math.floor(totalMemGb / 4))

      this.log.info("Hardware detected", { cpu: cpus[0]?.model ?? "unknown", cores: cpuCount, ramGb: totalMemGb, gpu: this.profile.hardware.gpu.model, vramGb: this.profile.hardware.gpu.vramGb })
    } catch (err) {
      this.log.warn("Hardware detection failed, using config defaults", err)
    }
  }

  /** Detect GPU using nvidia-smi (NVIDIA) or fall back to config defaults. */
  private detectGpu(): GpuSpec | undefined {
    // Try NVIDIA GPU first
    try {
      const output = execSync(
        "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
        { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim()

      if (output) {
        const firstLine = output.split("\n")[0]
        const parts = firstLine.split(",").map((s: string) => s.trim())
        if (parts.length >= 2) {
          const model = parts[0].replace(/\s+/g, "_")
          const vramMb = parseInt(parts[1], 10)
          const vramGb = Math.round(vramMb / 1024)
          return { model, vramGb: vramGb > 0 ? vramGb : 0 }
        }
      }
    } catch {
      // nvidia-smi not available or no NVIDIA GPU
    }

    // Try AMD GPU on Windows via PowerShell
    if (os.platform() === "win32") {
      try {
        const output = execSync(
          'powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name"',
          { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        ).trim()

        if (output && output.length > 0) {
          const vramOutput = execSync(
            'powershell -Command "(Get-CimInstance Win32_VideoController | Select-Object -First 1).AdapterRAM"',
            { timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
          ).trim()

          const vramBytes = parseInt(vramOutput, 10)
          const vramGb = vramBytes > 0 ? Math.round(vramBytes / (1024 * 1024 * 1024)) : 0
          return { model: output.replace(/\s+/g, "_"), vramGb }
        }
      } catch {
        // PowerShell WMI query failed
      }
    }

    return undefined
  }

  /** Classify CPU tier based on model name and core count. */
  private classifyCpu(model: string, coreCount: number): string {
    const lower = model.toLowerCase()
    if (lower.includes("threadripper") || lower.includes("epyc") || lower.includes("xeon")) {
      return "workstation"
    }
    if (lower.includes("ryzen 9") || lower.includes("i9") || coreCount >= 16) {
      return "high_end_desktop"
    }
    if (lower.includes("ryzen 7") || lower.includes("i7") || coreCount >= 8) {
      return "mid_desktop"
    }
    if (lower.includes("ryzen 5") || lower.includes("i5") || coreCount >= 6) {
      return "mid_range"
    }
    return "entry"
  }

  // ─── Model Directory Scanning ────────────────────────────

  /** Scan configured model directories and build real library entries. */
  private scanModelDirectories(): void {
    const entries: ModelLibraryEntry[] = []
    let totalSizeGb = 0

    const scanDir = (dirPath: string, category: ModelCategory, provider: ModelLibraryEntry["provider"], description: string) => {
      try {
        if (!fs.existsSync(dirPath)) return
        const sizeGb = this.estimateDirectorySize(dirPath)
        totalSizeGb += sizeGb
        entries.push({
          category,
          path: dirPath,
          estimatedSizeGb: sizeGb,
          provider,
          description: `${description} (${sizeGb.toFixed(1)}GB detected)`,
        })
      } catch {
        // Directory not accessible — skip
      }
    }

    // Scan LM Studio models
    scanDir(this.profile.modelLibrary.lmStudioModelsPath, "llm", "lmstudio", "LM Studio model library")

    // Scan Ollama models
    scanDir(this.profile.modelLibrary.ollamaModelsPath, "llm", "ollama", "Ollama model library")

    // Scan LoRA directory
    scanDir(this.profile.modelLibrary.loraPath, "lora", "standalone", "LoRA adapters")

    // Scan ComfyUI models
    scanDir(this.profile.modelLibrary.comfyuiModelsPath, "comfyui", "comfyui", "ComfyUI models")

    // Scan media model subdirectories
    const mediaBase = this.profile.modelLibrary.mediaModelsPath
    if (fs.existsSync(mediaBase)) {
      const mediaDirs: Array<{ sub: string; cat: ModelCategory; desc: string }> = [
        { sub: "TTS", cat: "tts", desc: "Text-to-speech models" },
        { sub: "STT", cat: "stt", desc: "Speech-to-text models" },
        { sub: "Image", cat: "image", desc: "Image generation models" },
        { sub: "Video", cat: "video", desc: "Video generation models" },
        { sub: "Music", cat: "music", desc: "Music generation models" },
        { sub: "Voice", cat: "voice_clone", desc: "Voice cloning models" },
      ]
      for (const { sub, cat, desc } of mediaDirs) {
        scanDir(path.join(mediaBase, sub), cat, "standalone", desc)
      }
    }

    // Only overwrite if we found real directories
    if (entries.length > 0) {
      this.profile.modelLibrary.entries = entries
      this.profile.modelLibrary.totalEstimatedSizeGb = Math.round(totalSizeGb)
      this.log.info("Model directories scanned", { count: entries.length, totalSizeGb: Math.round(totalSizeGb) })
    }
  }

  /**
   * Estimate directory size in GB by summing file sizes in the top two levels.
   * Uses a shallow scan (depth 2) to avoid long delays on huge trees.
   */
  private estimateDirectorySize(dirPath: string): number {
    let totalBytes = 0
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const item of items) {
        const fullPath = path.join(dirPath, item.name)
        try {
          if (item.isFile()) {
            totalBytes += fs.statSync(fullPath).size
          } else if (item.isDirectory()) {
            // One level deeper
            const subItems = fs.readdirSync(fullPath, { withFileTypes: true })
            for (const sub of subItems) {
              if (sub.isFile()) {
                try {
                  totalBytes += fs.statSync(path.join(fullPath, sub.name)).size
                } catch { /* skip inaccessible */ }
              }
            }
          }
        } catch { /* skip inaccessible */ }
      }
    } catch { /* directory not readable */ }
    return totalBytes / (1024 * 1024 * 1024)
  }

  /** Load profile from VS Code settings, falling back to defaults. */
  private loadProfile(): WorkstationConfig {
    const config = vscode.workspace.getConfiguration("kilo-code.new.workstation")

    return {
      name: config.get<string>("name", DEFAULT_PROFILE.name),
      hardware: {
        motherboard: config.get<string>("hardware.motherboard", DEFAULT_PROFILE.hardware.motherboard),
        platform: config.get<string>("hardware.platform", DEFAULT_PROFILE.hardware.platform),
        chipset: config.get<string>("hardware.chipset", DEFAULT_PROFILE.hardware.chipset),
        cpuClass: config.get<string>("hardware.cpuClass", DEFAULT_PROFILE.hardware.cpuClass),
        ramGb: config.get<number>("hardware.ramGb", DEFAULT_PROFILE.hardware.ramGb),
        gpu: {
          model: config.get<string>("hardware.gpu.model", DEFAULT_PROFILE.hardware.gpu.model),
          vramGb: config.get<number>("hardware.gpu.vramGb", DEFAULT_PROFILE.hardware.gpu.vramGb),
        },
        storageType: config.get<string>("hardware.storageType", DEFAULT_PROFILE.hardware.storageType),
        storageCapacityTb: config.get<number>("hardware.storageCapacityTb", DEFAULT_PROFILE.hardware.storageCapacityTb),
      },
      paths: {
        workspace: config.get<string>("paths.workspace", DEFAULT_PROFILE.paths.workspace),
        downloads: config.get<string>("paths.downloads", DEFAULT_PROFILE.paths.downloads),
        models: config.get<string>("paths.models", DEFAULT_PROFILE.paths.models),
        loraRoot: config.get<string>("paths.loraRoot", DEFAULT_PROFILE.paths.loraRoot),
        comfyuiModels: config.get<string>("paths.comfyuiModels", DEFAULT_PROFILE.paths.comfyuiModels),
        ollamaModels: config.get<string>("paths.ollamaModels", DEFAULT_PROFILE.paths.ollamaModels),
      },
      localAI: {
        lmStudio: {
          enabled: config.get<boolean>("localAI.lmStudio.enabled", DEFAULT_PROFILE.localAI.lmStudio.enabled),
          apiBase: config.get<string>("localAI.lmStudio.apiBase", DEFAULT_PROFILE.localAI.lmStudio.apiBase),
          modelsPath: config.get<string>("localAI.lmStudio.modelsPath", DEFAULT_PROFILE.localAI.lmStudio.modelsPath ?? ""),
        },
        ollama: {
          enabled: config.get<boolean>("localAI.ollama.enabled", DEFAULT_PROFILE.localAI.ollama.enabled),
          apiBase: config.get<string>("localAI.ollama.apiBase", DEFAULT_PROFILE.localAI.ollama.apiBase),
        },
      },
      modelLibrary: {
        lmStudioModelsPath: config.get<string>("modelLibrary.lmStudioModelsPath", DEFAULT_PROFILE.modelLibrary.lmStudioModelsPath),
        ollamaModelsPath: config.get<string>("modelLibrary.ollamaModelsPath", DEFAULT_PROFILE.modelLibrary.ollamaModelsPath),
        loraPath: config.get<string>("modelLibrary.loraPath", DEFAULT_PROFILE.modelLibrary.loraPath),
        comfyuiModelsPath: config.get<string>("modelLibrary.comfyuiModelsPath", DEFAULT_PROFILE.modelLibrary.comfyuiModelsPath),
        mediaModelsPath: config.get<string>("modelLibrary.mediaModelsPath", DEFAULT_PROFILE.modelLibrary.mediaModelsPath),
        totalEstimatedSizeGb: config.get<number>("modelLibrary.totalEstimatedSizeGb", DEFAULT_PROFILE.modelLibrary.totalEstimatedSizeGb),
        entries: config.get<ModelLibraryEntry[]>("modelLibrary.entries", DEFAULT_PROFILE.modelLibrary.entries),
      },
      capabilities: {
        canRunLargeModels: config.get<boolean>("capabilities.canRunLargeModels", DEFAULT_PROFILE.capabilities.canRunLargeModels),
        maxContextEstimate: config.get<string>("capabilities.maxContextEstimate", DEFAULT_PROFILE.capabilities.maxContextEstimate),
        supportsLocalTraining: config.get<boolean>("capabilities.supportsLocalTraining", DEFAULT_PROFILE.capabilities.supportsLocalTraining),
        supportsParallelAgents: config.get<boolean>("capabilities.supportsParallelAgents", DEFAULT_PROFILE.capabilities.supportsParallelAgents),
      },
      routingPreferences: {
        preferLocalFor: config.get<string[]>("routingPreferences.preferLocalFor", DEFAULT_PROFILE.routingPreferences.preferLocalFor),
        preferCloudFor: config.get<string[]>("routingPreferences.preferCloudFor", DEFAULT_PROFILE.routingPreferences.preferCloudFor),
      },
      limits: {
        maxParallelJobs: config.get<number>("limits.maxParallelJobs", DEFAULT_PROFILE.limits.maxParallelJobs),
        maxGpuJobs: config.get<number>("limits.maxGpuJobs", DEFAULT_PROFILE.limits.maxGpuJobs),
        maxMemoryPerJobGb: config.get<number>("limits.maxMemoryPerJobGb", DEFAULT_PROFILE.limits.maxMemoryPerJobGb),
        maxGpuMemoryMb: config.get<number>("limits.maxGpuMemoryMb", DEFAULT_PROFILE.limits.maxGpuMemoryMb),
        maxTrainingTimeMs: config.get<number>("limits.maxTrainingTimeMs", DEFAULT_PROFILE.limits.maxTrainingTimeMs),
      },
    }
  }

  // ─── Query methods ────────────────────────────────────────

  getProfile(): WorkstationConfig {
    return { ...this.profile }
  }

  getHardware(): HardwareSpec {
    return { ...this.profile.hardware }
  }

  getGpuSpec(): GpuSpec {
    return { ...this.profile.hardware.gpu }
  }

  getLimits(): WorkstationLimits {
    return { ...this.profile.limits }
  }

  getLocalAI(): LocalAIConfig {
    return {
      lmStudio: { ...this.profile.localAI.lmStudio },
      ollama: { ...this.profile.localAI.ollama },
    }
  }

  getRoutingPreferences(): RoutingPreferences {
    return {
      preferLocalFor: [...this.profile.routingPreferences.preferLocalFor],
      preferCloudFor: [...this.profile.routingPreferences.preferCloudFor],
    }
  }

  getPaths(): WorkstationPaths {
    return { ...this.profile.paths }
  }

  /** Get the full local model library. */
  getModelLibrary(): ModelLibrary {
    return {
      ...this.profile.modelLibrary,
      entries: [...this.profile.modelLibrary.entries],
    }
  }

  /** Get model entries for a specific category (llm, lora, tts, stt, image, video, etc.). */
  getModelsByCategory(category: ModelCategory): ModelLibraryEntry[] {
    return this.profile.modelLibrary.entries.filter((e) => e.category === category)
  }

  /** Check if any models exist for a given category. */
  hasModelsFor(category: ModelCategory): boolean {
    return this.profile.modelLibrary.entries.some((e) => e.category === category)
  }

  /** Get total estimated model storage in GB. */
  getTotalModelStorageGb(): number {
    return this.profile.modelLibrary.totalEstimatedSizeGb
  }

  /** Check if a LoRA adapter path is available for training/merge. */
  hasLoRAs(): boolean {
    return this.profile.modelLibrary.entries.some((e) => e.category === "lora")
  }

  /** Check if TTS models are available locally. */
  hasLocalTTS(): boolean {
    return this.profile.modelLibrary.entries.some((e) => e.category === "tts")
  }

  /** Check if STT models are available locally. */
  hasLocalSTT(): boolean {
    return this.profile.modelLibrary.entries.some((e) => e.category === "stt")
  }

  /** Check if a task type should prefer local execution. */
  shouldPreferLocal(taskType: string): boolean {
    return this.profile.routingPreferences.preferLocalFor.includes(taskType)
  }

  /** Check if a task type should prefer cloud execution. */
  shouldPreferCloud(taskType: string): boolean {
    return this.profile.routingPreferences.preferCloudFor.includes(taskType)
  }

  /** Check if local training is supported. */
  canTrainLocally(): boolean {
    return this.profile.capabilities.supportsLocalTraining && this.profile.hardware.gpu.vramGb > 0
  }

  /** Get maximum GPU memory in MB. */
  getMaxGpuMemoryMb(): number {
    return this.profile.limits.maxGpuMemoryMb
  }

  /** Check if a requested VRAM amount fits the local GPU. */
  fitsInGpu(requestedMb: number): boolean {
    return requestedMb <= this.profile.limits.maxGpuMemoryMb
  }

  /** Check if any local AI endpoint is available. */
  hasLocalAI(): boolean {
    return this.profile.localAI.lmStudio.enabled || this.profile.localAI.ollama.enabled
  }

  /** Reload profile from settings and re-detect hardware (e.g. after user changes config). */
  reload(): void {
    this.profile = this.loadProfile()
    this.detectAndApplyHardware()
    this.scanModelDirectories()
  }

  dispose(): void {
    // No resources to clean up
  }
}
