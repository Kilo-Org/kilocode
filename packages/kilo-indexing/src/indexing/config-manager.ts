import type { EmbedderProvider } from "./interfaces/manager"
import type { CodeIndexConfig, PreviousConfigSnapshot } from "./interfaces/config"
import { DEFAULT_SEARCH_MIN_SCORE, DEFAULT_MAX_SEARCH_RESULTS } from "./constants"
import { getDefaultModelId, getModelDimension, getModelScoreThreshold } from "./model-registry"
import { isEmbeddingProfileEqual, resolveEmbeddingProfile } from "./embedding-profile"

/**
 * Raw input fed to CodeIndexConfigManager from the host environment.
 * The host (CLI, extension, tests) builds this object and passes it in;
 * the config manager never reads storage or secrets directly.
 */
export interface IndexingConfigInput {
  enabled: boolean
  embedderProvider: EmbedderProvider
  vectorStoreProvider?: "lancedb" | "qdrant"
  lancedbVectorStoreDirectory?: string
  modelId?: string
  modelDimension?: number
  qdrantUrl?: string
  qdrantApiKey?: string
  searchMinScore?: number
  searchMaxResults?: number
  embeddingBatchSize?: number
  scannerMaxBatchRetries?: number
  openAiKey?: string
  ollamaBaseUrl?: string
  openAiCompatibleBaseUrl?: string
  openAiCompatibleApiKey?: string
  geminiApiKey?: string
  mistralApiKey?: string
  vercelAiGatewayApiKey?: string
  bedrockRegion?: string
  bedrockProfile?: string
  openRouterApiKey?: string
  openRouterSpecificProvider?: string
  voyageApiKey?: string
}

/**
 * Manages configuration state and validation for the code indexing feature.
 *
 * RATIONALE: Replaced the legacy ContextProxy/getGlobalState/getSecret approach
 * with a plain IndexingConfigInput object supplied by the host. The manager
 * owns no storage; it only validates and projects the input into the shapes the
 * rest of the indexing engine expects.
 */
export class CodeIndexConfigManager {
  private enabled = false
  private embedderProvider: EmbedderProvider = "openai"
  private vectorStoreProvider: "lancedb" | "qdrant" = "qdrant"
  private lancedbVectorStoreDirectory?: string
  private modelId?: string
  private modelDimension?: number
  private openAiOptions?: { apiKey: string }
  private ollamaOptions?: { baseUrl: string; modelId?: string }
  private openAiCompatibleOptions?: { baseUrl: string; apiKey: string }
  private geminiOptions?: { apiKey: string }
  private mistralOptions?: { apiKey: string }
  private vercelAiGatewayOptions?: { apiKey: string }
  private bedrockOptions?: { region: string; profile?: string }
  private openRouterOptions?: { apiKey: string; specificProvider?: string }
  private voyageOptions?: { apiKey: string }
  private qdrantUrl?: string = "http://localhost:6333"
  private qdrantApiKey?: string
  private searchMinScore?: number
  private searchMaxResults?: number
  private embeddingBatchSize?: number
  private scannerMaxBatchRetries?: number

  constructor(input: IndexingConfigInput) {
    this.applyInput(input)
  }

  /**
   * Applies new configuration input. Returns whether a restart is needed.
   */
  public loadConfiguration(input: IndexingConfigInput): { requiresRestart: boolean } {
    const snapshot = this.captureSnapshot()
    this.applyInput(input)
    const requiresRestart = this.doesConfigChangeRequireRestart(snapshot)
    return { requiresRestart }
  }

  private applyInput(input: IndexingConfigInput): void {
    this.enabled = input.enabled
    this.embedderProvider = input.embedderProvider
    this.vectorStoreProvider = input.vectorStoreProvider ?? "qdrant"
    this.lancedbVectorStoreDirectory = input.lancedbVectorStoreDirectory
    this.qdrantUrl = input.qdrantUrl ?? "http://localhost:6333"
    this.qdrantApiKey = input.qdrantApiKey
    this.searchMinScore = input.searchMinScore
    this.searchMaxResults = input.searchMaxResults
    this.embeddingBatchSize = input.embeddingBatchSize
    this.scannerMaxBatchRetries = input.scannerMaxBatchRetries
    this.modelId = input.modelId

    // Validate and set model dimension
    if (input.modelDimension !== undefined && input.modelDimension !== null) {
      const dimension = Number(input.modelDimension)
      this.modelDimension = !isNaN(dimension) && dimension > 0 ? dimension : undefined
    } else {
      this.modelDimension = undefined
    }

    this.openAiOptions = input.openAiKey ? { apiKey: input.openAiKey } : undefined
    const url = input.ollamaBaseUrl ?? (input.embedderProvider === "ollama" ? "http://localhost:11434" : undefined)
    this.ollamaOptions = url ? { baseUrl: url, modelId: input.modelId } : undefined
    this.openAiCompatibleOptions =
      input.openAiCompatibleBaseUrl && input.openAiCompatibleApiKey
        ? { baseUrl: input.openAiCompatibleBaseUrl, apiKey: input.openAiCompatibleApiKey }
        : undefined
    this.geminiOptions = input.geminiApiKey ? { apiKey: input.geminiApiKey } : undefined
    this.mistralOptions = input.mistralApiKey ? { apiKey: input.mistralApiKey } : undefined
    this.vercelAiGatewayOptions = input.vercelAiGatewayApiKey ? { apiKey: input.vercelAiGatewayApiKey } : undefined
    this.bedrockOptions = input.bedrockRegion
      ? { region: input.bedrockRegion, profile: input.bedrockProfile }
      : undefined
    this.openRouterOptions = input.openRouterApiKey
      ? { apiKey: input.openRouterApiKey, specificProvider: input.openRouterSpecificProvider }
      : undefined
    this.voyageOptions = input.voyageApiKey ? { apiKey: input.voyageApiKey } : undefined
  }

  private captureSnapshot(): PreviousConfigSnapshot {
    return {
      enabled: this.enabled,
      configured: this.isConfigured(),
      embedderProvider: this.embedderProvider,
      vectorStoreProvider: this.vectorStoreProvider,
      lancedbVectorStoreDirectory: this.lancedbVectorStoreDirectory,
      modelId: this.modelId,
      modelDimension: this.modelDimension,
      openAiKey: this.openAiOptions?.apiKey ?? "",
      ollamaBaseUrl: this.ollamaOptions?.baseUrl ?? "",
      openAiCompatibleBaseUrl: this.openAiCompatibleOptions?.baseUrl ?? "",
      openAiCompatibleApiKey: this.openAiCompatibleOptions?.apiKey ?? "",
      geminiApiKey: this.geminiOptions?.apiKey ?? "",
      mistralApiKey: this.mistralOptions?.apiKey ?? "",
      vercelAiGatewayApiKey: this.vercelAiGatewayOptions?.apiKey ?? "",
      bedrockRegion: this.bedrockOptions?.region ?? "",
      bedrockProfile: this.bedrockOptions?.profile ?? "",
      openRouterApiKey: this.openRouterOptions?.apiKey ?? "",
      openRouterSpecificProvider: this.openRouterOptions?.specificProvider ?? "",
      voyageApiKey: this.voyageOptions?.apiKey ?? "",
      qdrantUrl: this.qdrantUrl ?? "",
      qdrantApiKey: this.qdrantApiKey ?? "",
    }
  }

  public isConfigured(): boolean {
    const provider = this.embedderProvider
    const qdrant = this.qdrantUrl
    const isLancedb = this.vectorStoreProvider === "lancedb"
    // LanceDB doesn't need a qdrant URL; qdrant does
    const hasStore = isLancedb || !!qdrant

    if (provider === "openai") return !!(this.openAiOptions?.apiKey && hasStore)
    if (provider === "ollama") return !!(this.ollamaOptions?.baseUrl && hasStore)
    if (provider === "openai-compatible")
      return !!(this.openAiCompatibleOptions?.baseUrl && this.openAiCompatibleOptions?.apiKey && hasStore)
    if (provider === "gemini") return !!(this.geminiOptions?.apiKey && hasStore)
    if (provider === "mistral") return !!(this.mistralOptions?.apiKey && hasStore)
    if (provider === "vercel-ai-gateway") return !!(this.vercelAiGatewayOptions?.apiKey && hasStore)
    if (provider === "bedrock") return !!(this.bedrockOptions?.region && hasStore)
    if (provider === "openrouter") return !!(this.openRouterOptions?.apiKey && hasStore)
    if (provider === "voyage") return !!(this.voyageOptions?.apiKey && hasStore)
    return false
  }

  doesConfigChangeRequireRestart(prev: PreviousConfigSnapshot): boolean {
    const nowConfigured = this.isConfigured()

    const prevEnabled = prev.enabled ?? false
    const prevConfigured = prev.configured ?? false
    const prevProvider = prev.embedderProvider ?? "openai"

    // Enable/disable transitions
    if ((!prevEnabled || !prevConfigured) && this.enabled && nowConfigured) return true
    if (prevEnabled && !this.enabled) return true
    if ((!prevEnabled || !prevConfigured) && (!this.enabled || !nowConfigured)) return false
    if (!this.enabled) return false

    // Provider change
    if (prevProvider !== this.embedderProvider) return true

    // Vector store provider change
    if ((prev.vectorStoreProvider ?? "qdrant") !== this.vectorStoreProvider) return true

    // LanceDB path change
    if (
      this.vectorStoreProvider === "lancedb" &&
      (prev.lancedbVectorStoreDirectory ?? "") !== (this.lancedbVectorStoreDirectory ?? "")
    )
      return true

    // Auth changes
    if ((prev.openAiKey ?? "") !== (this.openAiOptions?.apiKey ?? "")) return true
    if ((prev.ollamaBaseUrl ?? "") !== (this.ollamaOptions?.baseUrl ?? "")) return true
    if (
      (prev.openAiCompatibleBaseUrl ?? "") !== (this.openAiCompatibleOptions?.baseUrl ?? "") ||
      (prev.openAiCompatibleApiKey ?? "") !== (this.openAiCompatibleOptions?.apiKey ?? "")
    )
      return true
    if ((prev.geminiApiKey ?? "") !== (this.geminiOptions?.apiKey ?? "")) return true
    if ((prev.mistralApiKey ?? "") !== (this.mistralOptions?.apiKey ?? "")) return true
    if ((prev.vercelAiGatewayApiKey ?? "") !== (this.vercelAiGatewayOptions?.apiKey ?? "")) return true
    if (
      (prev.bedrockRegion ?? "") !== (this.bedrockOptions?.region ?? "") ||
      (prev.bedrockProfile ?? "") !== (this.bedrockOptions?.profile ?? "")
    )
      return true
    if ((prev.openRouterApiKey ?? "") !== (this.openRouterOptions?.apiKey ?? "")) return true
    if ((prev.openRouterSpecificProvider ?? "") !== (this.openRouterOptions?.specificProvider ?? "")) return true
    if ((prev.voyageApiKey ?? "") !== (this.voyageOptions?.apiKey ?? "")) return true

    // Qdrant connection changes
    if ((prev.qdrantUrl ?? "") !== (this.qdrantUrl ?? "") || (prev.qdrantApiKey ?? "") !== (this.qdrantApiKey ?? ""))
      return true

    if (this.hasEmbeddingProfileChanged(prevProvider, prev.modelId, prev.modelDimension)) return true

    return false
  }

  private hasEmbeddingProfileChanged(
    prevProvider: EmbedderProvider,
    prevModelId?: string,
    prevModelDimension?: number,
  ): boolean {
    const prev = resolveEmbeddingProfile(prevProvider, prevModelId, prevModelDimension)
    const cur = resolveEmbeddingProfile(this.embedderProvider, this.modelId, this.modelDimension)

    if (prev && cur) return !isEmbeddingProfileEqual(prev, cur)

    const prevId = prevModelId ?? getDefaultModelId(prevProvider)
    const curId = this.modelId ?? getDefaultModelId(this.embedderProvider)
    if (prevProvider === this.embedderProvider && prevId === curId) return false

    return true
  }

  public getConfig(): CodeIndexConfig {
    return {
      isConfigured: this.isConfigured(),
      embedderProvider: this.embedderProvider,
      vectorStoreProvider: this.vectorStoreProvider ?? "qdrant",
      lancedbVectorStoreDirectoryPlaceholder: this.lancedbVectorStoreDirectory,
      modelId: this.modelId,
      modelDimension: this.modelDimension,
      openAiOptions: this.openAiOptions,
      ollamaOptions: this.ollamaOptions,
      openAiCompatibleOptions: this.openAiCompatibleOptions,
      geminiOptions: this.geminiOptions,
      mistralOptions: this.mistralOptions,
      vercelAiGatewayOptions: this.vercelAiGatewayOptions,
      bedrockOptions: this.bedrockOptions,
      openRouterOptions: this.openRouterOptions,
      voyageOptions: this.voyageOptions,
      qdrantUrl: this.qdrantUrl,
      qdrantApiKey: this.qdrantApiKey,
      searchMinScore: this.currentSearchMinScore,
      searchMaxResults: this.currentSearchMaxResults,
      embeddingBatchSize: this.currentEmbeddingBatchSize,
      scannerMaxBatchRetries: this.currentScannerMaxBatchRetries,
    }
  }

  public get isFeatureEnabled(): boolean {
    return this.enabled
  }

  public get isFeatureConfigured(): boolean {
    return this.isConfigured()
  }

  public get currentEmbedderProvider(): EmbedderProvider {
    return this.embedderProvider
  }

  public get qdrantConfig(): { url?: string; apiKey?: string } {
    return { url: this.qdrantUrl, apiKey: this.qdrantApiKey }
  }

  public get currentModelId(): string | undefined {
    return this.modelId
  }

  public get currentModelDimension(): number | undefined {
    const id = this.modelId ?? getDefaultModelId(this.embedderProvider)
    const dim = getModelDimension(this.embedderProvider, id)
    if (!dim && this.modelDimension && this.modelDimension > 0) return this.modelDimension
    return dim
  }

  public get currentSearchMinScore(): number {
    if (this.searchMinScore !== undefined) return this.searchMinScore
    const id = this.modelId ?? getDefaultModelId(this.embedderProvider)
    return getModelScoreThreshold(this.embedderProvider, id) ?? DEFAULT_SEARCH_MIN_SCORE
  }

  public get currentSearchMaxResults(): number {
    return this.searchMaxResults ?? DEFAULT_MAX_SEARCH_RESULTS
  }

  public get currentEmbeddingBatchSize(): number | undefined {
    return this.embeddingBatchSize
  }

  public get currentScannerMaxBatchRetries(): number | undefined {
    return this.scannerMaxBatchRetries
  }
}
