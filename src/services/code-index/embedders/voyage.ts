import { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import {
	MAX_BATCH_TOKENS,
	MAX_ITEM_TOKENS,
	MAX_BATCH_RETRIES as MAX_RETRIES,
	INITIAL_RETRY_DELAY_MS as INITIAL_DELAY_MS,
} from "../constants"
import { getModelQueryPrefix } from "../../../shared/embeddingModels"
import { t } from "../../../i18n"
import { withValidationErrorHandling, formatEmbeddingError, HttpError } from "../shared/validation-helpers"
import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

/**
 * Response structure from Voyage AI embedding API
 */
interface VoyageEmbeddingItem {
	embedding: number[]
	index: number
}

interface VoyageEmbeddingResponse {
	data: VoyageEmbeddingItem[]
	model: string
	usage?: {
		total_tokens?: number
	}
}

/**
 * Voyage AI embedder implementation using the native Voyage API.
 *
 * Voyage AI provides high-quality embedding models including code-specific models.
 * API endpoint: https://api.voyageai.com/v1/embeddings
 *
 * Supported models:
 * - voyage-code-3 (dimension: 1024, code-optimized)
 * - voyage-4-large (dimension: 1024)
 * - voyage-4 (dimension: 1024)
 * - voyage-4-lite (dimension: 1024)
 * - voyage-finance-2 (dimension: 1024)
 * - voyage-law-2 (dimension: 1024)
 */
export class VoyageEmbedder implements IEmbedder {
	private static readonly VOYAGE_BASE_URL = "https://api.voyageai.com/v1/embeddings"
	private static readonly DEFAULT_MODEL = "voyage-code-3"
	private readonly apiKey: string
	private readonly modelId: string

	/**
	 * Creates a new Voyage AI embedder
	 * @param apiKey The Voyage AI API key for authentication
	 * @param modelId The model ID to use (defaults to voyage-code-3)
	 */
	constructor(apiKey: string, modelId?: string) {
		if (!apiKey) {
			throw new Error(t("embeddings:validation.apiKeyRequired"))
		}

		this.apiKey = apiKey
		this.modelId = modelId || VoyageEmbedder.DEFAULT_MODEL
	}

	/**
	 * Creates embeddings for the given texts using Voyage AI's embedding API
	 * @param texts Array of text strings to embed
	 * @param model Optional model identifier (uses constructor model if not provided)
	 * @returns Promise resolving to embedding response
	 */
	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		const modelToUse = model || this.modelId

		// Apply model-specific query prefix if required
		const queryPrefix = getModelQueryPrefix("voyage", modelToUse)
		const processedTexts = queryPrefix
			? texts.map((text, index) => {
					// Prevent double-prefixing
					if (text.startsWith(queryPrefix)) {
						return text
					}
					const prefixedText = `${queryPrefix}${text}`
					const estimatedTokens = Math.ceil(prefixedText.length / 4)
					if (estimatedTokens > MAX_ITEM_TOKENS) {
						console.warn(
							t("embeddings:textWithPrefixExceedsTokenLimit", {
								index,
								estimatedTokens,
								maxTokens: MAX_ITEM_TOKENS,
							}),
						)
						// Return original text if adding prefix would exceed limit
						return text
					}
					return prefixedText
				})
			: texts

		const allEmbeddings: number[][] = []
		const usage = { promptTokens: 0, totalTokens: 0 }
		const remainingTexts = [...processedTexts]

		while (remainingTexts.length > 0) {
			const currentBatch: string[] = []
			let currentBatchTokens = 0
			const processedIndices: number[] = []

			for (let i = 0; i < remainingTexts.length; i++) {
				const text = remainingTexts[i]
				const itemTokens = Math.ceil(text.length / 4)

				if (itemTokens > MAX_ITEM_TOKENS) {
					console.warn(
						t("embeddings:textExceedsTokenLimit", {
							index: i,
							itemTokens,
							maxTokens: MAX_ITEM_TOKENS,
						}),
					)
					processedIndices.push(i)
					continue
				}

				if (currentBatchTokens + itemTokens <= MAX_BATCH_TOKENS) {
					currentBatch.push(text)
					currentBatchTokens += itemTokens
					processedIndices.push(i)
				} else {
					break
				}
			}

			// Remove processed items from remainingTexts (in reverse order to maintain correct indices)
			for (let i = processedIndices.length - 1; i >= 0; i--) {
				remainingTexts.splice(processedIndices[i], 1)
			}

			if (currentBatch.length > 0) {
				const batchResult = await this._embedBatchWithRetries(currentBatch, modelToUse)
				allEmbeddings.push(...batchResult.embeddings)
				usage.promptTokens += batchResult.usage.promptTokens
				usage.totalTokens += batchResult.usage.totalTokens
			}
		}

		return { embeddings: allEmbeddings, usage }
	}

	/**
	 * Helper method to handle batch embedding with retries and exponential backoff
	 * @param batchTexts Array of texts to embed in this batch
	 * @param model Model identifier to use
	 * @returns Promise resolving to embeddings and usage statistics
	 */
	private async _embedBatchWithRetries(
		batchTexts: string[],
		model: string,
	): Promise<{ embeddings: number[][]; usage: { promptTokens: number; totalTokens: number } }> {
		for (let attempts = 0; attempts < MAX_RETRIES; attempts++) {
			try {
				const response = await fetch(VoyageEmbedder.VOYAGE_BASE_URL, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.apiKey}`,
					},
					body: JSON.stringify({
						input: batchTexts,
						model: model,
						input_type: "document", // For indexing, we use "document" type
					}),
				})

				if (!response.ok) {
					const errorBody = await response.text().catch(() => "Unknown error")
					const error = new Error(`HTTP ${response.status}: ${errorBody}`) as HttpError
					error.status = response.status
					throw error
				}

				const result: VoyageEmbeddingResponse = await response.json()

				// Sort by index to ensure correct order
				const sortedData = [...result.data].sort((a, b) => a.index - b.index)

				return {
					embeddings: sortedData.map((item) => item.embedding),
					usage: {
						promptTokens: result.usage?.total_tokens || 0,
						totalTokens: result.usage?.total_tokens || 0,
					},
				}
			} catch (error: any) {
				const hasMoreAttempts = attempts < MAX_RETRIES - 1

				// Check if it's a rate limit error
				const httpError = error as HttpError
				if (httpError?.status === 429 && hasMoreAttempts) {
					const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempts)
					console.warn(
						t("embeddings:rateLimitRetry", {
							delayMs,
							attempt: attempts + 1,
							maxRetries: MAX_RETRIES,
						}),
					)
					await new Promise((resolve) => setTimeout(resolve, delayMs))
					continue
				}

				// Capture telemetry before reformatting the error
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					location: "VoyageEmbedder:_embedBatchWithRetries",
					attempt: attempts + 1,
				})

				// Log the error for debugging
				console.error(`Voyage AI embedder error (attempt ${attempts + 1}/${MAX_RETRIES}):`, error)

				// Format and throw the error
				throw formatEmbeddingError(error, MAX_RETRIES)
			}
		}

		throw new Error(t("embeddings:failedMaxAttempts", { attempts: MAX_RETRIES }))
	}

	/**
	 * Validates the Voyage AI embedder configuration by attempting a minimal embedding request
	 * @returns Promise resolving to validation result with success status and optional error message
	 */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		return withValidationErrorHandling(async () => {
			try {
				const response = await fetch(VoyageEmbedder.VOYAGE_BASE_URL, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.apiKey}`,
					},
					body: JSON.stringify({
						input: ["test"],
						model: this.modelId,
					}),
				})

				if (!response.ok) {
					const errorBody = await response.text().catch(() => "Unknown error")
					const error = new Error(`HTTP ${response.status}: ${errorBody}`) as HttpError
					error.status = response.status
					throw error
				}

				const result: VoyageEmbeddingResponse = await response.json()

				// Check if we got a valid response
				if (!result.data || result.data.length === 0) {
					return {
						valid: false,
						error: t("embeddings:voyage.invalidResponseFormat"),
					}
				}

				return { valid: true }
			} catch (error) {
				// Capture telemetry for validation errors
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					location: "VoyageEmbedder:validateConfiguration",
				})
				console.error("Voyage AI embedder error in validateConfiguration:", error)
				throw error
			}
		}, "voyage")
	}

	/**
	 * Returns information about this embedder
	 */
	get embedderInfo(): EmbedderInfo {
		return {
			name: "voyage",
		}
	}
}
