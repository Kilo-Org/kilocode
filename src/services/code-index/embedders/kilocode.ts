import { OpenAI } from "openai"
import { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import {
	MAX_BATCH_TOKENS,
	MAX_ITEM_TOKENS,
	MAX_BATCH_RETRIES as MAX_RETRIES,
	INITIAL_RETRY_DELAY_MS as INITIAL_DELAY_MS,
} from "../constants"
import { getDefaultModelId, getModelQueryPrefix } from "../../../shared/embeddingModels"
import { t } from "../../../i18n"
import { withValidationErrorHandling, HttpError, formatEmbeddingError } from "../shared/validation-helpers"
import { TelemetryEventName, getKiloUrlFromToken, type ProviderSettingsEntry } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { Mutex } from "async-mutex"
import { handleOpenAIError } from "../../../api/providers/utils/openai-error-handler"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"

interface EmbeddingItem {
	embedding: string | number[]
	[key: string]: any
}

interface KiloCodeEmbeddingResponse {
	data: EmbeddingItem[]
	usage?: {
		prompt_tokens?: number
		total_tokens?: number
	}
}

/**
 * Kilo Code Gatewayimplementation of the embedder interface with batching and rate limiting.
 * Kilocode provides an OpenAI-compatible API that gives access to hundreds of models
 * through a single endpoint, automatically handling fallbacks and cost optimization.
 */
export class KiloCodeEmbedder implements IEmbedder {
	private embeddingsClient: OpenAI | undefined
	private readonly defaultModelId: string
	private apiKey: string | undefined
	private readonly maxItemTokens: number
	private baseUrl: string | undefined
	private isInitialized: boolean = false

	// Global rate limiting state shared across all instances
	private static globalRateLimitState = {
		isRateLimited: false,
		rateLimitResetTime: 0,
		consecutiveRateLimitErrors: 0,
		lastRateLimitError: 0,
		// Mutex to ensure thread-safe access to rate limit state
		mutex: new Mutex(),
	}

	/**
	 * Creates a new OpenRouter embedder
	 * @param apiKey The API key for authentication
	 * @param modelId Optional model identifier (defaults to "openai/text-embedding-3-large")
	 * @param maxItemTokens Optional maximum tokens per item (defaults to MAX_ITEM_TOKENS)
	 */
	constructor(modelId?: string, maxItemTokens?: number) {
		this.defaultModelId = modelId || getDefaultModelId("kilocode")
		this.maxItemTokens = maxItemTokens || MAX_ITEM_TOKENS
	}

	async initialize(): Promise<void> {
		if (!this.isInitialized) {
			try {
				await this.initKiloCodeEmbedder()
				this.isInitialized = true
			} catch (error) {
				console.error("Failed to initialize Kilo Code Embedder:", error)
				throw error
			}
		}
	}

	async initKiloCodeEmbedder(): Promise<void> {
		// Wrap OpenAI client creation to handle invalid API key characters
		try {
			const provider: ClineProvider | undefined = ClineProvider.getVisibleInstance()
			const profiles: ProviderSettingsEntry[] | undefined = provider?.getProviderProfileEntries()
			const kilocodeProfile: ProviderSettingsEntry | undefined = profiles?.find(
				(profile) => profile.apiProvider === "kilocode",
			)
			const settingsManager = new ProviderSettingsManager(ContextProxy.instance.rawContext)
			const profileSettings = await settingsManager.getProfile({ id: kilocodeProfile?.id || "" })
			const kilocodeToken = profileSettings.kilocodeToken
			this.apiKey = kilocodeToken || ""
			const kilobaseURL = getKiloUrlFromToken("https://api.kilocode.ai/api", this.apiKey)
			this.baseUrl = `${kilobaseURL}/openrouter`

			this.embeddingsClient = new OpenAI({
				baseURL: this.baseUrl,
				apiKey: this.apiKey,
				defaultHeaders: {
					"HTTP-Referer": "https://kilocode.ai", //kilocode_change
					"X-Title": "Kilo Code", //kilocode_change
				},
			})
		} catch (error) {
			// Use the error handler to transform ByteString conversion errors
			throw handleOpenAIError(error, "Kilo Code Embedder")
		}
	}

	/**
	 * Creates embeddings for the given texts with batching and rate limiting
	 * @param texts Array of text strings to embed
	 * @param model Optional model identifier
	 * @returns Promise resolving to embedding response
	 */
	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		this.initialize()
		const modelToUse = model || this.defaultModelId

		// Apply model-specific query prefix if required
		const queryPrefix = getModelQueryPrefix("kilocode", modelToUse)
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

				if (itemTokens > this.maxItemTokens) {
					console.warn(
						t("embeddings:textExceedsTokenLimit", {
							index: i,
							itemTokens,
							maxTokens: this.maxItemTokens,
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
			// Check global rate limit before attempting request
			await this.waitForGlobalRateLimit()

			try {
				const response = (await this.embeddingsClient?.embeddings.create({
					input: batchTexts,
					model: model,
					// OpenAI package (as of v4.78.1) has a parsing issue that truncates embedding dimensions to 256
					// when processing numeric arrays, which breaks compatibility with models using larger dimensions.
					// By requesting base64 encoding, we bypass the package's parser and handle decoding ourselves.
					encoding_format: "base64",
				})) as KiloCodeEmbeddingResponse

				// Convert base64 embeddings to float32 arrays
				const processedEmbeddings = response.data.map((item: EmbeddingItem) => {
					if (typeof item.embedding === "string") {
						const buffer = Buffer.from(item.embedding, "base64")

						// Create Float32Array view over the buffer
						const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)

						return {
							...item,
							embedding: Array.from(float32Array),
						}
					}
					return item
				})

				// Replace the original data with processed embeddings
				response.data = processedEmbeddings

				const embeddings = response.data.map((item) => item.embedding as number[])

				return {
					embeddings: embeddings,
					usage: {
						promptTokens: response.usage?.prompt_tokens || 0,
						totalTokens: response.usage?.total_tokens || 0,
					},
				}
			} catch (error) {
				// Capture telemetry before error is reformatted
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					location: "KiloCodeEmbedder:_embedBatchWithRetries",
					attempt: attempts + 1,
				})

				const hasMoreAttempts = attempts < MAX_RETRIES - 1

				// Check if it's a rate limit error
				const httpError = error as HttpError
				if (httpError?.status === 429) {
					// Update global rate limit state
					await this.updateGlobalRateLimitState(httpError)

					if (hasMoreAttempts) {
						// Calculate delay based on global rate limit state
						const baseDelay = INITIAL_DELAY_MS * Math.pow(2, attempts)
						const globalDelay = await this.getGlobalRateLimitDelay()
						const delayMs = Math.max(baseDelay, globalDelay)

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
				}

				// Log the error for debugging
				console.error(`Kilo Code embedder error (attempt ${attempts + 1}/${MAX_RETRIES}):`, error)

				// Format and throw the error
				throw formatEmbeddingError(error, MAX_RETRIES)
			}
		}

		throw new Error(t("embeddings:failedMaxAttempts", { attempts: MAX_RETRIES }))
	}

	/**
	 * Validates the OpenRouter embedder configuration by testing API connectivity
	 * @returns Promise resolving to validation result with success status and optional error message
	 */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		await this.initialize()
		return withValidationErrorHandling(async () => {
			try {
				// Test with a minimal embedding request
				const testTexts = ["test"]
				const modelToUse = this.defaultModelId

				const response = (await this.embeddingsClient?.embeddings.create({
					input: testTexts,
					model: modelToUse,
					encoding_format: "base64",
				})) as KiloCodeEmbeddingResponse

				// Check if we got a valid response
				if (!response?.data || response.data.length === 0) {
					return {
						valid: false,
						error: "embeddings:validation.invalidResponse",
					}
				}

				return { valid: true }
			} catch (error) {
				// Capture telemetry for validation errors
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					location: "KiloCodeEmbedder:validateConfiguration",
				})
				throw error
			}
		}, "kilocode")
	}

	/**
	 * Returns information about this embedder
	 */
	get embedderInfo(): EmbedderInfo {
		return {
			name: "kilocode",
		}
	}

	/**
	 * Waits if there's an active global rate limit
	 */
	private async waitForGlobalRateLimit(): Promise<void> {
		const release = await KiloCodeEmbedder.globalRateLimitState.mutex.acquire()
		let mutexReleased = false

		try {
			const state = KiloCodeEmbedder.globalRateLimitState

			if (state.isRateLimited && state.rateLimitResetTime > Date.now()) {
				const waitTime = state.rateLimitResetTime - Date.now()
				// Silent wait - no logging to prevent flooding
				release()
				mutexReleased = true
				await new Promise((resolve) => setTimeout(resolve, waitTime))
				return
			}

			// Reset rate limit if time has passed
			if (state.isRateLimited && state.rateLimitResetTime <= Date.now()) {
				state.isRateLimited = false
				state.consecutiveRateLimitErrors = 0
			}
		} finally {
			// Only release if we haven't already
			if (!mutexReleased) {
				release()
			}
		}
	}

	/**
	 * Updates global rate limit state when a 429 error occurs
	 */
	private async updateGlobalRateLimitState(error: HttpError): Promise<void> {
		const release = await KiloCodeEmbedder.globalRateLimitState.mutex.acquire()
		try {
			const state = KiloCodeEmbedder.globalRateLimitState
			const now = Date.now()

			// Increment consecutive rate limit errors
			if (now - state.lastRateLimitError < 60000) {
				// Within 1 minute
				state.consecutiveRateLimitErrors++
			} else {
				state.consecutiveRateLimitErrors = 1
			}

			state.lastRateLimitError = now

			// Calculate exponential backoff based on consecutive errors
			const baseDelay = 5000 // 5 seconds base
			const maxDelay = 300000 // 5 minutes max
			const exponentialDelay = Math.min(baseDelay * Math.pow(2, state.consecutiveRateLimitErrors - 1), maxDelay)

			// Set global rate limit
			state.isRateLimited = true
			state.rateLimitResetTime = now + exponentialDelay

			// Silent rate limit activation - no logging to prevent flooding
		} finally {
			release()
		}
	}

	/**
	 * Gets the current global rate limit delay
	 */
	private async getGlobalRateLimitDelay(): Promise<number> {
		const release = await KiloCodeEmbedder.globalRateLimitState.mutex.acquire()
		try {
			const state = KiloCodeEmbedder.globalRateLimitState

			if (state.isRateLimited && state.rateLimitResetTime > Date.now()) {
				return state.rateLimitResetTime - Date.now()
			}

			return 0
		} finally {
			release()
		}
	}
}
