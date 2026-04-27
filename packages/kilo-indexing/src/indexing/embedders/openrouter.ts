import { OpenAI } from "openai"
import type { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import {
  MAX_BATCH_TOKENS,
  MAX_ITEM_TOKENS,
  MAX_BATCH_RETRIES as MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS as INITIAL_DELAY_MS,
  REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
  REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
} from "../constants"
import { getDefaultModelId, getModelQueryPrefix } from "../model-registry"
import { withValidationErrorHandling, type HttpError, formatEmbeddingError } from "../shared/validation-helpers"
import { Mutex } from "async-mutex"
import { DEFAULT_HEADERS } from "../../headers"
import { Log } from "../../util/log"

const log = Log.create({ service: "embedder-openrouter" })

// Default provider name when no specific provider is selected
export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

interface EmbeddingItem {
  embedding: string | number[]
  [key: string]: any
}

interface OpenRouterEmbeddingResponse {
  data: EmbeddingItem[]
  usage?: {
    prompt_tokens?: number
    total_tokens?: number
  }
}

/**
 * OpenRouter implementation of the embedder interface with batching and rate limiting.
 * OpenRouter provides an OpenAI-compatible API that gives access to hundreds of models
 * through a single endpoint, automatically handling fallbacks and cost optimization.
 */
export class OpenRouterEmbedder implements IEmbedder {
  private embeddingsClient: OpenAI
  private readonly defaultModelId: string
  private readonly apiKey: string
  private readonly maxItemTokens: number
  private readonly baseUrl: string = "https://openrouter.ai/api/v1"
  private readonly specificProvider?: string
  private readonly dimensions?: number

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
   * @param specificProvider Optional specific provider to route requests to
   * @param dimensions Optional embedding dimensions override
   */
  constructor(
    apiKey: string,
    modelId?: string,
    maxItemTokens?: number,
    specificProvider?: string,
    dimensions?: number,
  ) {
    if (!apiKey) {
      throw new Error("API key is required for OpenRouter embedder")
    }

    this.apiKey = apiKey
    // Only set specificProvider if it's not the default value
    this.specificProvider =
      specificProvider && specificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME ? specificProvider : undefined

    try {
      this.embeddingsClient = new OpenAI({
        baseURL: this.baseUrl,
        apiKey: apiKey,
        defaultHeaders: DEFAULT_HEADERS,
      })
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }

    this.defaultModelId = modelId || getDefaultModelId("openrouter")
    this.maxItemTokens = maxItemTokens || MAX_ITEM_TOKENS
    this.dimensions = dimensions
  }

  /**
   * Creates embeddings for the given texts with batching and rate limiting
   * @param texts Array of text strings to embed
   * @param model Optional model identifier
   * @returns Promise resolving to embedding response
   */
  async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
    const modelToUse = model || this.defaultModelId

    // Apply model-specific query prefix if required
    const queryPrefix = getModelQueryPrefix("openrouter", modelToUse)
    const processedTexts = queryPrefix
      ? texts.map((text, index) => {
          // Prevent double-prefixing
          if (text.startsWith(queryPrefix)) {
            return text
          }
          const prefixedText = `${queryPrefix}${text}`
          const estimatedTokens = Math.ceil(prefixedText.length / 4)
          if (estimatedTokens > MAX_ITEM_TOKENS) {
            log.warn(`Text at index ${index} with prefix exceeds token limit (${estimatedTokens} > ${MAX_ITEM_TOKENS})`)
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
        if (text === undefined) {
          continue
        }
        const itemTokens = Math.ceil(text.length / 4)

        if (itemTokens > this.maxItemTokens) {
          log.warn(`Text at index ${i} exceeds token limit (${itemTokens} > ${this.maxItemTokens})`)
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
        const idx = processedIndices[i]
        if (idx === undefined) {
          continue
        }
        remainingTexts.splice(idx, 1)
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
        // Build the request parameters
        const requestParams: any = {
          input: batchTexts,
          model: model,
          // OpenAI package (as of v4.78.1) has a parsing issue that truncates embedding dimensions to 256
          // when processing numeric arrays, which breaks compatibility with models using larger dimensions.
          // By requesting base64 encoding, we bypass the package's parser and handle decoding ourselves.
          encoding_format: "base64",
        }

        if (this.dimensions !== undefined) {
          requestParams.dimensions = this.dimensions
        }

        // Add provider routing if a specific provider is set
        if (this.specificProvider) {
          requestParams.provider = {
            order: [this.specificProvider],
            only: [this.specificProvider],
            allow_fallbacks: false,
          }
        }

        const response = (await this.embeddingsClient.embeddings.create(requestParams)) as OpenRouterEmbeddingResponse

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
        log.error("OpenRouter embedder batch error", {
          err: error instanceof Error ? error.message : String(error),
          location: "OpenRouterEmbedder:_embedBatchWithRetries",
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

            log.warn(`Rate limit hit, retrying in ${delayMs}ms (attempt ${attempts + 1}/${MAX_RETRIES})`)
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            continue
          }
        }

        // Format and throw the error
        throw formatEmbeddingError(error, MAX_RETRIES)
      }
    }

    throw new Error(`Embedding failed after ${MAX_RETRIES} attempts`)
  }

  /**
   * Validates the OpenRouter embedder configuration by testing API connectivity
   * @returns Promise resolving to validation result with success status and optional error message
   */
  async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    return withValidationErrorHandling(async () => {
      try {
        // Test with a minimal embedding request
        const testTexts = ["test"]
        const modelToUse = this.defaultModelId

        // Build the request parameters
        const requestParams: any = {
          input: testTexts,
          model: modelToUse,
          encoding_format: "base64",
        }

        if (this.dimensions !== undefined) {
          requestParams.dimensions = this.dimensions
        }

        // Add provider routing if a specific provider is set
        if (this.specificProvider) {
          requestParams.provider = {
            order: [this.specificProvider],
            only: [this.specificProvider],
            allow_fallbacks: false,
          }
        }

        const response = (await this.embeddingsClient.embeddings.create(requestParams, {
          timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
          maxRetries: REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
        })) as OpenRouterEmbeddingResponse

        // Check if we got a valid response
        if (!response?.data || response.data.length === 0) {
          return {
            valid: false,
            error: "Invalid response from OpenRouter embedding endpoint",
          }
        }

        return { valid: true }
      } catch (error) {
        log.error("OpenRouter embedder validation error", {
          err: error instanceof Error ? error.message : String(error),
          location: "OpenRouterEmbedder:validateConfiguration",
        })
        throw error
      }
    }, "openrouter")
  }

  /**
   * Returns information about this embedder
   */
  get embedderInfo(): EmbedderInfo {
    return {
      name: "openrouter",
    }
  }

  /**
   * Waits if there's an active global rate limit
   */
  private async waitForGlobalRateLimit(): Promise<void> {
    const release = await OpenRouterEmbedder.globalRateLimitState.mutex.acquire()
    let mutexReleased = false

    try {
      const state = OpenRouterEmbedder.globalRateLimitState

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
    const release = await OpenRouterEmbedder.globalRateLimitState.mutex.acquire()
    try {
      const state = OpenRouterEmbedder.globalRateLimitState
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
    const release = await OpenRouterEmbedder.globalRateLimitState.mutex.acquire()
    try {
      const state = OpenRouterEmbedder.globalRateLimitState

      if (state.isRateLimited && state.rateLimitResetTime > Date.now()) {
        return state.rateLimitResetTime - Date.now()
      }

      return 0
    } finally {
      release()
    }
  }
}
