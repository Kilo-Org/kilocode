import { OpenAICompatibleEmbedder } from "./openai-compatible"
import { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import { GEMINI_MAX_ITEM_TOKENS } from "../constants"
import { t } from "../../../i18n"
import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

/**
 * Gemini embedder implementation that wraps the OpenAI Compatible embedder
 * with configuration for Google's Gemini embedding API.
 *
 * Supported models:
 * - gemini-embedding-001 (dimension: 3072)
 *
 * Note: text-embedding-004 has been deprecated and is automatically
 * migrated to gemini-embedding-001 for backward compatibility.
 */
export class GeminiEmbedder implements IEmbedder {
	private readonly openAICompatibleEmbedder: OpenAICompatibleEmbedder
	private static readonly GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
	private static readonly DEFAULT_MODEL = "gemini-embedding-001"
	/**
	 * Deprecated models that are automatically migrated to their replacements.
	 * Users with these models configured will be silently migrated without interruption.
	 */
	private static readonly DEPRECATED_MODEL_MIGRATIONS: Record<string, string> = {
		"text-embedding-004": "gemini-embedding-001",
	}
	private readonly modelId: string

	/**
	 * Migrates deprecated model IDs to their replacements.
	 * @param modelId The model ID to potentially migrate
	 * @returns The migrated model ID, or the original if no migration is needed
	 */
	private static migrateModelId(modelId: string): string {
		return GeminiEmbedder.DEPRECATED_MODEL_MIGRATIONS[modelId] ?? modelId
	}

	/**
	 * Creates a new Gemini embedder
	 * @param apiKey The Gemini API key for authentication
	 * @param modelId The model ID to use (defaults to gemini-embedding-001)
	 */
	constructor(apiKey: string, modelId?: string) {
		if (!apiKey) {
			throw new Error(t("embeddings:validation.apiKeyRequired"))
		}

		// Migrate deprecated models to their replacements silently
		const migratedModelId = modelId ? GeminiEmbedder.migrateModelId(modelId) : undefined

		// Use provided model (after migration) or default
		this.modelId = migratedModelId || GeminiEmbedder.DEFAULT_MODEL

		// Create an OpenAI Compatible embedder with Gemini's configuration
		this.openAICompatibleEmbedder = new OpenAICompatibleEmbedder(
			GeminiEmbedder.GEMINI_BASE_URL,
			apiKey,
			this.modelId,
			GEMINI_MAX_ITEM_TOKENS,
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
				location: "GeminiEmbedder:createEmbeddings",
			})
			console.error("Gemini embedder error in createEmbeddings:", error) // kilocode_change
			throw error
		}
	}

	/**
	 * Validates the Gemini embedder configuration by delegating to the underlying OpenAI-compatible embedder
	 * @returns Promise resolving to validation result with success status and optional error message
	 */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		try {
			// Delegate validation to the OpenAI-compatible embedder
			// The error messages will be specific to Gemini since we're using Gemini's base URL
			return await this.openAICompatibleEmbedder.validateConfiguration()
		} catch (error) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "GeminiEmbedder:validateConfiguration",
			})
			console.error("Gemini embedder error in validateConfiguration:", error) // kilocode_change
			throw error
		}
	}

	/**
	 * Returns information about this embedder
	 */
	get embedderInfo(): EmbedderInfo {
		return {
			name: "gemini",
		}
	}
}
