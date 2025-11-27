import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"
import { EmbedderInfo, EmbeddingResponse, IEmbedder } from "../interfaces/embedder"
import { OpenAICompatibleEmbedder } from "./openai-compatible"

/**
 * MatterAI embedder implementation that wraps the OpenAI Compatible embedder
 * with configuration for MatterAI's embedding API.
 *
 * Supported models:
 * - matterai-embedding-large (dimension: 3072)
 */
export class MatterAiEmbedder implements IEmbedder {
	private readonly openAICompatibleEmbedder: OpenAICompatibleEmbedder
	private static readonly MATTERAI_BASE_URL = "https://api.matterai.so/v1/embeddings"
	private static readonly DEFAULT_MODEL = "matterai-embedding-large"
	private readonly modelId: string

	/**
	 * Creates a new MatterAI embedder
	 * @param modelId The model ID to use (defaults to matterai-embedding-large)
	 */
	constructor(apiKey: string, modelId?: string) {
		// Use provided model or default
		this.modelId = modelId || MatterAiEmbedder.DEFAULT_MODEL

		// Create an OpenAI Compatible embedder with MatterAI's configuration
		this.openAICompatibleEmbedder = new OpenAICompatibleEmbedder(
			MatterAiEmbedder.MATTERAI_BASE_URL,
			apiKey,
			this.modelId,
			2048,
		)
	}

	/**
	 * Creates embeddings for the given texts using Gemini's embedding API
	 * @param texts Array of text strings to embed
	 * @param model Optional model identifier (uses constructor model if not provided)
	 * @returns Promise resolving to embedding response
	 */
	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		try {
			// Use the provided model or fall back to the instance's model
			const modelToUse = model || this.modelId
			return await this.openAICompatibleEmbedder.createEmbeddings(texts, modelToUse)
		} catch (error) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "MatterAiEmbedder:createEmbeddings",
			})
			throw error
		}
	}

	/**
	 * Validates the MatterAI embedder configuration by delegating to the underlying OpenAI-compatible embedder
	 * @returns Promise resolving to validation result with success status and optional error message
	 */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		try {
			// Delegate validation to the OpenAI-compatible embedder
			// The error messages will be specific to MatterAI since we're using MatterAI's base URL
			return await this.openAICompatibleEmbedder.validateConfiguration()
		} catch (error) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "MatterAiEmbedder:validateConfiguration",
			})
			throw error
		}
	}

	/**
	 * Returns information about this embedder
	 */
	get embedderInfo(): EmbedderInfo {
		return {
			name: "matterai",
		}
	}
}
