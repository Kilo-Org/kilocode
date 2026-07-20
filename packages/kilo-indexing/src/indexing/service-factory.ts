import path from "path"

import { getDefaultModelId } from "./model-registry"
import { resolveEmbeddingProfile } from "./embedding-profile"

import { OpenAiEmbedder } from "./embedders/openai"
import { KiloEmbedder } from "./embedders/kilo"
import { CodeIndexOllamaEmbedder } from "./embedders/ollama"
import { OpenAICompatibleEmbedder } from "./embedders/openai-compatible"
import { GeminiEmbedder } from "./embedders/gemini"
import { MistralEmbedder } from "./embedders/mistral"
import { VercelAiGatewayEmbedder } from "./embedders/vercel-ai-gateway"
import { BedrockEmbedder } from "./embedders/bedrock"
import { OpenRouterEmbedder } from "./embedders/openrouter"
import { VoyageEmbedder } from "./embedders/voyage"
import { QdrantVectorStore } from "./vector-store/qdrant-client"
import { LanceDBVectorStore } from "./vector-store/lancedb-vector-store"
import { CodeParser, DirectoryScanner, FileWatcher } from "./processors"
import type { AvailableEmbedders, ICodeParser, IEmbedder, IFileWatcher, IVectorStore } from "./interfaces"
import type { CodeIndexConfigManager } from "./config-manager"
import type { CacheManager } from "./cache-manager"
import type { IndexingTelemetryMeta, IndexingTelemetryReporter } from "./interfaces/telemetry"
import {
  BATCH_SEGMENT_THRESHOLD,
  DEFAULT_VECTOR_STORE,
  OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS,
  REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
} from "./constants"
import { Log } from "../util/log"
import type { IgnoreMatcher } from "./shared/load-ignore"

const log = Log.create({ service: "indexing-factory" })

// RATIONALE: The OpenAI SDK applies the per-attempt timeout and retries internally.
const policy = {
  openai: undefined,
  openrouter: undefined,
  "openai-compatible": undefined,
  kilo: undefined,
  gemini: undefined,
  mistral: undefined,
  "vercel-ai-gateway": undefined,
  ollama: {
    timeout: OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS,
    error: "Connection to embedding service failed (timeout)",
  },
  voyage: {
    timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
    error: "Connection failed. Please check the endpoint URL and network connectivity.",
  },
  bedrock: {
    timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
    error: "Connection failed. Please check the endpoint URL and network connectivity.",
  },
} satisfies Record<AvailableEmbedders, { timeout: number; error: string } | undefined>

/**
 * Factory class responsible for creating and configuring code indexing service dependencies.
 *
 * RATIONALE: Removed vscode.ExtensionContext, Package, RooIgnoreController, and
 * LanceDBManager inputs. All batch sizing, retry counts, vector-store selection,
 * and model selection now come from the injected CodeIndexConfigManager.
 */
export class CodeIndexServiceFactory {
  constructor(
    private readonly configManager: CodeIndexConfigManager,
    private readonly workspacePath: string,
    private readonly cacheManager: CacheManager,
    private readonly cacheDirectory: string,
    private readonly onTelemetry?: IndexingTelemetryReporter,
  ) {}

  private getTelemetryMeta(): IndexingTelemetryMeta {
    const cfg = this.configManager.getConfig()
    return {
      provider: cfg.embedderProvider,
      vectorStore: cfg.vectorStoreProvider ?? DEFAULT_VECTOR_STORE,
      modelId: cfg.modelId,
    }
  }

  public createEmbedder(): IEmbedder {
    const config = this.configManager.getConfig()
    const provider = config.embedderProvider

    if (provider === "kilo") {
      if (!config.kiloOptions?.apiKey) throw new Error("Kilo API key is required for embedding.")
      if (!config.modelId) throw new Error("Kilo embedding model is required.")
      return new KiloEmbedder({
        apiKey: config.kiloOptions.apiKey,
        baseUrl: config.kiloOptions.baseUrl,
        organizationId: config.kiloOptions.organizationId,
        modelId: config.modelId,
        dimensions: config.modelDimension,
      })
    }
    if (provider === "openai") {
      if (!config.openAiOptions?.apiKey) throw new Error("OpenAI API key is required for embedding.")
      return new OpenAiEmbedder(config.openAiOptions.apiKey, config.modelId)
    }
    if (provider === "ollama") {
      if (!config.ollamaOptions?.baseUrl) throw new Error("Ollama base URL is required for embedding.")
      return new CodeIndexOllamaEmbedder(config.ollamaOptions.baseUrl, config.modelId, config.modelDimension)
    }
    if (provider === "openai-compatible") {
      if (!config.openAiCompatibleOptions?.baseUrl) throw new Error("OpenAI-compatible base URL is required.")
      return new OpenAICompatibleEmbedder(
        config.openAiCompatibleOptions.baseUrl,
        config.openAiCompatibleOptions.apiKey,
        config.modelId,
      )
    }
    if (provider === "gemini") {
      if (!config.geminiOptions?.apiKey) throw new Error("Gemini API key is required for embedding.")
      return new GeminiEmbedder(config.geminiOptions.apiKey, config.modelId)
    }
    if (provider === "mistral") {
      if (!config.mistralOptions?.apiKey) throw new Error("Mistral API key is required for embedding.")
      return new MistralEmbedder(config.mistralOptions.apiKey, config.modelId)
    }
    if (provider === "vercel-ai-gateway") {
      if (!config.vercelAiGatewayOptions?.apiKey)
        throw new Error("Vercel AI Gateway API key is required for embedding.")
      return new VercelAiGatewayEmbedder(config.vercelAiGatewayOptions.apiKey, config.modelId)
    }
    if (provider === "bedrock") {
      if (!config.bedrockOptions?.region) throw new Error("Bedrock region is required for embedding.")
      return new BedrockEmbedder(config.bedrockOptions.region, config.bedrockOptions.profile, config.modelId)
    }
    if (provider === "openrouter") {
      if (!config.openRouterOptions?.apiKey) throw new Error("OpenRouter API key is required for embedding.")
      return new OpenRouterEmbedder(
        config.openRouterOptions.apiKey,
        config.modelId,
        undefined,
        config.openRouterOptions.specificProvider,
        config.modelDimension,
      )
    }
    if (provider === "voyage") {
      if (!config.voyageOptions?.apiKey) throw new Error("Voyage API key is required for embedding.")
      return new VoyageEmbedder(config.voyageOptions.apiKey, config.modelId)
    }

    throw new Error(`Unsupported embedder provider: ${provider}`)
  }

  public async validateEmbedder(embedder: IEmbedder): Promise<{ valid: boolean; error?: string }> {
    const deadline = policy[embedder.embedderInfo.name]
    let timer: ReturnType<typeof setTimeout> | undefined
    const wait = embedder.validateConfiguration()
    const fail =
      deadline === undefined
        ? undefined
        : new Promise<{ valid: boolean; error?: string }>((resolve) => {
            timer = setTimeout(
              () =>
                resolve({
                  valid: false,
                  error: deadline.error,
                }),
              deadline.timeout,
            )
          })

    try {
      log.info("validating embedder", { provider: embedder.embedderInfo.name })
      const result = fail ? await Promise.race([wait, fail]) : await wait
      if (result.valid) {
        log.info("embedder validation succeeded", { provider: embedder.embedderInfo.name })
      }
      if (!result.valid) {
        log.warn("embedder validation failed", {
          provider: embedder.embedderInfo.name,
          error: result.error,
        })
      }
      return result
    } catch (err) {
      log.error("embedder validation failed", { err })
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Configuration validation error",
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  public createVectorStore(workspacePath = this.workspacePath): IVectorStore {
    const config = this.configManager.getConfig()
    const profile = resolveEmbeddingProfile(config.embedderProvider, config.modelId, config.modelDimension)

    if (!profile || profile.dimension <= 0) {
      throw new Error(
        `Cannot determine vector dimension for model "${config.modelId ?? getDefaultModelId(config.embedderProvider)}" with provider "${config.embedderProvider}". ` +
          (config.embedderProvider === "openai-compatible"
            ? "Please set the model dimension explicitly."
            : "Check your model configuration."),
      )
    }

    if (config.vectorStoreProvider === "lancedb") {
      const dbDir = config.lancedbVectorStoreDirectoryPlaceholder ?? path.join(this.cacheDirectory, "lancedb")
      log.info("creating vector store", {
        provider: config.embedderProvider,
        vectorStore: "lancedb",
        model: profile.modelId,
        vectorSize: profile.dimension,
        dbDir,
      })
      return new LanceDBVectorStore(workspacePath, profile.dimension, dbDir, profile)
    }

    if (!config.qdrantUrl) throw new Error("Qdrant URL is required.")
    log.info("creating vector store", {
      provider: config.embedderProvider,
      vectorStore: "qdrant",
      model: profile.modelId,
      vectorSize: profile.dimension,
    })
    return new QdrantVectorStore(workspacePath, config.qdrantUrl, profile.dimension, config.qdrantApiKey, profile)
  }

  public createDirectoryScanner(
    embedder: IEmbedder,
    vectorStore: IVectorStore,
    parser: ICodeParser,
    ignoreInstance: IgnoreMatcher,
  ): DirectoryScanner {
    const config = this.configManager.getConfig()
    const meta = this.getTelemetryMeta()
    return new DirectoryScanner(
      embedder,
      vectorStore,
      parser,
      this.cacheManager,
      ignoreInstance,
      config.embeddingBatchSize,
      config.scannerMaxBatchRetries,
      this.onTelemetry,
      meta,
      config.fileExtensions,
    )
  }

  public createFileWatcher(
    embedder: IEmbedder,
    vectorStore: IVectorStore,
    cacheManager: CacheManager,
    ignoreInstance: IgnoreMatcher,
    parser: ICodeParser,
  ): IFileWatcher {
    const config = this.configManager.getConfig()
    const meta = this.getTelemetryMeta()
    return new FileWatcher(
      this.workspacePath,
      cacheManager,
      embedder,
      vectorStore,
      ignoreInstance,
      config.embeddingBatchSize,
      config.scannerMaxBatchRetries,
      this.onTelemetry,
      meta,
      config.fileExtensions,
      parser,
    )
  }

  public createServices(
    cacheManager: CacheManager,
    ignoreInstance: IgnoreMatcher,
  ): {
    embedder: IEmbedder
    vectorStore: IVectorStore
    parser: ICodeParser
    scanner: DirectoryScanner
    fileWatcher: IFileWatcher
  } {
    if (!this.configManager.isFeatureConfigured) {
      throw new Error("Code indexing is not configured. Save your settings to start indexing.")
    }

    const config = this.configManager.getConfig()
    log.info("creating indexing services", {
      workspacePath: this.workspacePath,
      provider: config.embedderProvider,
      vectorStore: config.vectorStoreProvider,
      model: config.modelId ?? getDefaultModelId(config.embedderProvider),
      configured: config.isConfigured,
    })

    const embedder = this.createEmbedder()
    const vectorStore = this.createVectorStore()
    const parser = new CodeParser(config.fileExtensions)
    const scanner = this.createDirectoryScanner(embedder, vectorStore, parser, ignoreInstance)
    const fileWatcher = this.createFileWatcher(embedder, vectorStore, cacheManager, ignoreInstance, parser)

    log.info("indexing services created", {
      workspacePath: this.workspacePath,
      provider: embedder.embedderInfo.name,
    })

    return { embedder, vectorStore, parser, scanner, fileWatcher }
  }
}
