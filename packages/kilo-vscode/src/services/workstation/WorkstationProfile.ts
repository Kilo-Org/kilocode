/**
 * WorkstationProfile — hardware-aware execution context
 *
 * Provides a structured profile of the operator's machine so that
 * routing, training, ZeroClaw, and memory services can make
 * hardware-aware decisions (prefer local GPU, respect VRAM limits,
 * choose local inference over cloud when appropriate).
 */

import * as vscode from "vscode"

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
}

export interface WorkstationConfig {
  name: string
  hardware: HardwareSpec
  paths: WorkstationPaths
  localAI: LocalAIConfig
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

  constructor() {
    this.profile = this.loadProfile()
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

  /** Reload profile from settings (e.g. after user changes config). */
  reload(): void {
    this.profile = this.loadProfile()
  }

  dispose(): void {
    // No resources to clean up
  }
}
