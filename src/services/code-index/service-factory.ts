import * as vscode from "vscode"
import { Ignore } from "ignore"

import type { EmbedderProvider } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

import { t } from "../../i18n"

import { getDefaultModelId, getModelDimension } from "../../shared/embeddingModels"
import { Package } from "../../shared/package"

import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"

import { OpenAiEmbedder } from "./embedders/openai"
import { CodeIndexOllamaEmbedder } from "./embedders/ollama"
import { OpenAICompatibleEmbedder } from "./embedders/openai-compatible"
import { GeminiEmbedder } from "./embedders/gemini"
import { MistralEmbedder } from "./embedders/mistral"
import { VercelAiGatewayEmbedder } from "./embedders/vercel-ai-gateway"
import { BedrockEmbedder } from "./embedders/bedrock"
import { OpenRouterEmbedder } from "./embedders/openrouter"
import { QdrantVectorStore } from "./vector-store/qdrant-client"
import { LanceDBVectorStore } from "./vector-store/lancedb-vector-store"
import { codeParser, DirectoryScanner, FileWatcher } from "./processors"
import { ICodeParser, IEmbedder, IFileWatcher, IVectorStore } from "./interfaces"
import { CodeIndexConfigManager } from "./config-manager"
import { CacheManager } from "./cache-manager"
import { BATCH_SEGMENT_THRESHOLD } from "./constants"
import { getLancedbVectorStoreDirectoryPath } from "../../utils/storage"
import { LanceDBManager } from "../../utils/lancedb-manager"

/**
 * Factory class responsible for creating and configuring code indexing service dependencies.
 */
export class CodeIndexServiceFactory {
	constructor(
		private readonly configManager: CodeIndexConfigManager,
		private readonly workspacePath: string,
		private readonly cacheManager: CacheManager,
	) {}

	/**
	 * Creates an embedder instance based on the current configuration.
	 */
	public createEmbedder(): IEmbedder {
		const config = this.configManager.getConfig()

		const provider = config.embedderProvider as EmbedderProvider

		if (provider === "openai") {
			const apiKey = config.openAiOptions?.openAiNativeApiKey

			if (!apiKey) {
				throw new Error(t("embeddings:serviceFactory.openAiConfigMissing"))
			}
			return new OpenAiEmbedder({
				...config.openAiOptions,
				openAiEmbeddingModelId: config.modelId,
			})
		} else if (provider === "ollama") {
			if (!config.ollamaOptions?.ollamaBaseUrl) {
				throw new Error(t("embeddings:serviceFactory.ollamaConfigMissing"))
			}
			return new CodeIndexOllamaEmbedder({
				...config.ollamaOptions,
				ollamaModelId: config.modelId,
			})
		} else if (provider === "openai-compatible") {
			if (!config.openAiCompatibleOptions?.baseUrl || !config.openAiCompatibleOptions?.apiKey) {
				throw new Error(t("embeddings:serviceFactory.openAiCompatibleConfigMissing"))
			}
			return new OpenAICompatibleEmbedder(
				config.openAiCompatibleOptions.baseUrl,
				config.openAiCompatibleOptions.apiKey,
				config.modelId,
			)
		} else if (provider === "gemini") {
			if (!config.geminiOptions?.apiKey) {
				throw new Error(t("embeddings:serviceFactory.geminiConfigMissing"))
			}
			return new GeminiEmbedder(config.geminiOptions.apiKey, config.modelId)
		} else if (provider === "mistral") {
			if (!config.mistralOptions?.apiKey) {
				throw new Error(t("embeddings:serviceFactory.mistralConfigMissing"))
			}
			return new MistralEmbedder(config.mistralOptions.apiKey, config.modelId)
		} else if (provider === "vercel-ai-gateway") {
			if (!config.vercelAiGatewayOptions?.apiKey) {
				throw new Error(t("embeddings:serviceFactory.vercelAiGatewayConfigMissing"))
			}
			return new VercelAiGatewayEmbedder(config.vercelAiGatewayOptions.apiKey, config.modelId)
		} else if (provider === "bedrock") {
			// Only region is required for Bedrock (profile is optional)
			if (!config.bedrockOptions?.region) {
				throw new Error(t("embeddings:serviceFactory.bedrockConfigMissing"))
			}
			return new BedrockEmbedder(config.bedrockOptions.region, config.bedrockOptions.profile, config.modelId)
		} else if (provider === "openrouter") {
			if (!config.openRouterOptions?.apiKey) {
				throw new Error(t("embeddings:serviceFactory.openRouterConfigMissing"))
			}
			return new OpenRouterEmbedder(
				config.openRouterOptions.apiKey,
				config.modelId,
				undefined, // maxItemTokens
				config.openRouterOptions.specificProvider,
			)
		}

		throw new Error(
			t("embeddings:serviceFactory.invalidEmbedderType", { embedderProvider: config.embedderProvider }),
		)
	}

	/**
	 * Validates an embedder instance to ensure it's properly configured.
	 * @param embedder The embedder instance to validate
	 * @returns Promise resolving to validation result
	 */
	public async validateEmbedder(embedder: IEmbedder): Promise<{ valid: boolean; error?: string }> {
		try {
			return await embedder.validateConfiguration()
		} catch (error) {
			// Capture telemetry for the error
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "validateEmbedder",
			})

			// If validation throws an exception, preserve the original error message
			return {
				valid: false,
				error: error instanceof Error ? error.message : "embeddings:validation.configurationError",
			}
		}
	}

	/**
	 * Creates a vector store instance using the current configuration.
	 */
	public createVectorStore(): IVectorStore {
		const config = this.configManager.getConfig()

		const provider = config.embedderProvider as EmbedderProvider
		const defaultModel = getDefaultModelId(provider)
		// Use the embedding model ID from config, not the chat model IDs
		const modelId = config.modelId ?? defaultModel

		let vectorSize: number | undefined

		// First try to get the model-specific dimension from profiles
		vectorSize = getModelDimension(provider, modelId)

		// Only use manual dimension if model doesn't have a built-in dimension
		if (!vectorSize && config.modelDimension && config.modelDimension > 0) {
			vectorSize = config.modelDimension
		}

		if (vectorSize === undefined || vectorSize <= 0) {
			if (provider === "openai-compatible") {
				throw new Error(
					t("embeddings:serviceFactory.vectorDimensionNotDeterminedOpenAiCompatible", { modelId, provider }),
				)
			} else {
				throw new Error(t("embeddings:serviceFactory.vectorDimensionNotDetermined", { modelId, provider }))
			}
		}

		// kilocode_change - start
		// Use LanceDB
		if (config.vectorStoreProvider === "lancedb") {
			const { workspacePath } = this
			const globalStorageUri = this.configManager.getContextProxy().globalStorageUri.fsPath
			const lancedbVectorStoreDirectoryPlaceholder =
				config.lancedbVectorStoreDirectoryPlaceholder || getLancedbVectorStoreDirectoryPath(globalStorageUri)
			return new LanceDBVectorStore(
				workspacePath,
				vectorSize,
				lancedbVectorStoreDirectoryPlaceholder,
				new LanceDBManager(globalStorageUri),
			)
		}
		// kilocode_change - end

		// Use Qdrant
		if (!config.qdrantUrl) {
			throw new Error(t("embeddings:serviceFactory.qdrantUrlMissing"))
		}

		// Assuming constructor is updated: new QdrantVectorStore(workspacePath, url, vectorSize, apiKey?)
		return new QdrantVectorStore(this.workspacePath, config.qdrantUrl, vectorSize, config.qdrantApiKey)
	}

	/**
	 * Creates a directory scanner instance with its required dependencies.
	 */
	public createDirectoryScanner(
		embedder: IEmbedder,
		vectorStore: IVectorStore,
		parser: ICodeParser,
		ignoreInstance: Ignore,
	): DirectoryScanner {
		// kilocode_change start: Get the configurable batch size and max retries from config manager
		const config = this.configManager.getConfig()
		const batchSize = config.embeddingBatchSize
		const maxBatchRetries = config.scannerMaxBatchRetries
		return new DirectoryScanner(
			embedder,
			vectorStore,
			parser,
			this.cacheManager,
			ignoreInstance,
			batchSize,
			maxBatchRetries,
		)
		// kilocode_change end
	}

	/**
	 * Creates a file watcher instance with its required dependencies.
	 */
	public createFileWatcher(
		context: vscode.ExtensionContext,
		embedder: IEmbedder,
		vectorStore: IVectorStore,
		cacheManager: CacheManager,
		ignoreInstance: Ignore,
		rooIgnoreController?: RooIgnoreController,
	): IFileWatcher {
		// kilocode_change start: Get the configurable batch size from config manager
		const config = this.configManager.getConfig()
		const batchSize = config.embeddingBatchSize
		const maxBatchRetries = config.scannerMaxBatchRetries

		return new FileWatcher(
			this.workspacePath,
			context,
			cacheManager,
			embedder,
			vectorStore,
			ignoreInstance,
			rooIgnoreController,
			batchSize,
			maxBatchRetries,
		)
		// kilocode_change end
	}

	/**
	 * Creates all required service dependencies if the service is properly configured.
	 * @throws Error if the service is not properly configured
	 */
	public createServices(
		context: vscode.ExtensionContext,
		cacheManager: CacheManager,
		ignoreInstance: Ignore,
		rooIgnoreController?: RooIgnoreController,
	): {
		embedder: IEmbedder
		vectorStore: IVectorStore
		parser: ICodeParser
		scanner: DirectoryScanner
		fileWatcher: IFileWatcher
	} {
		if (!this.configManager.isFeatureConfigured) {
			throw new Error(t("embeddings:serviceFactory.codeIndexingNotConfigured"))
		}

		const embedder = this.createEmbedder()
		const vectorStore = this.createVectorStore()
		const parser = codeParser
		const scanner = this.createDirectoryScanner(embedder, vectorStore, parser, ignoreInstance)
		const fileWatcher = this.createFileWatcher(
			context,
			embedder,
			vectorStore,
			cacheManager,
			ignoreInstance,
			rooIgnoreController,
		)

		return {
			embedder,
			vectorStore,
			parser,
			scanner,
			fileWatcher,
		}
	}
}
