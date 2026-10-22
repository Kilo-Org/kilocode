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
import { applyQueryPrefix, embedBatches } from "../shared/embedder-helpers"
import {
  createRateLimitState,
  getRateLimitDelay,
  projectEmbeddingResponse,
  updateRateLimitState,
  waitForRateLimit,
} from "../shared/openai-compatible-helpers"
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
  data?: EmbeddingItem[]
  error?: string | { code?: string | number; message?: string }
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
  private static globalRateLimitState = createRateLimitState()

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
    const processedTexts = applyQueryPrefix(
      texts,
      getModelQueryPrefix("openrouter", modelToUse),
      MAX_ITEM_TOKENS,
      (index, tokens) =>
        log.warn(`Text at index ${index} with prefix exceeds token limit (${tokens} > ${MAX_ITEM_TOKENS})`),
    )

    return embedBatches(
      processedTexts,
      this.maxItemTokens,
      MAX_BATCH_TOKENS,
      (batch) => this._embedBatchWithRetries(batch, modelToUse),
      (index, tokens) => log.warn(`Text at index ${index} exceeds token limit (${tokens} > ${this.maxItemTokens})`),
    )
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
          encoding_format: "float",
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
        const err = response.error
        const msg = typeof err === "string" ? err : err?.message
        const code = typeof err === "object" && err ? err.code : undefined
        if (!response.data || response.data.length === 0) {
          log.warn("OpenRouter embedder batch returned invalid response", {
            location: "OpenRouterEmbedder:_embedBatchWithRetries",
            model,
            dimensions: this.dimensions,
            provider: this.specificProvider,
            code,
            err: msg,
          })
          const invalid = new Error(msg ?? "Invalid response from OpenRouter embedding endpoint") as HttpError
          invalid.status = typeof code === "number" ? code : 422
          throw invalid
        }

        return projectEmbeddingResponse({ data: response.data, usage: response.usage })
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
          encoding_format: "float",
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
          const err = response?.error
          const msg = typeof err === "string" ? err : err?.message
          const code = typeof err === "object" && err ? err.code : undefined
          log.warn("OpenRouter embedder validation returned invalid response", {
            location: "OpenRouterEmbedder:validateConfiguration",
            model: modelToUse,
            dimensions: this.dimensions,
            provider: this.specificProvider,
            dataCount: response?.data?.length ?? 0,
            code,
            err: msg,
          })
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
    return waitForRateLimit(OpenRouterEmbedder.globalRateLimitState)
  }

  /**
   * Updates global rate limit state when a 429 error occurs
   */
  private async updateGlobalRateLimitState(_error: HttpError): Promise<void> {
    return updateRateLimitState(OpenRouterEmbedder.globalRateLimitState)
  }

  /**
   * Gets the current global rate limit delay
   */
  private async getGlobalRateLimitDelay(): Promise<number> {
    return getRateLimitDelay(OpenRouterEmbedder.globalRateLimitState)
  }
}
