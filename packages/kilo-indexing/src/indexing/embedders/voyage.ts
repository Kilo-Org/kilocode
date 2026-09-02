import type { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import {
  MAX_BATCH_TOKENS,
  MAX_ITEM_TOKENS,
  MAX_BATCH_RETRIES as MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS as INITIAL_DELAY_MS,
  REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
} from "../constants"
import { getModelQueryPrefix } from "../model-registry"
import { withValidationErrorHandling, formatEmbeddingError, type HttpError } from "../shared/validation-helpers"
import { embedBatches } from "../shared/embedder-helpers"
import { Log } from "../../util/log"

const log = Log.create({ service: "embedder-voyage" })

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
      throw new Error("API key is required for Voyage embedder")
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

    return embedBatches(
      texts,
      MAX_ITEM_TOKENS,
      MAX_BATCH_TOKENS,
      (batch) => this._embedBatchWithRetries(batch, modelToUse),
      (index, tokens) => log.warn(`Text at index ${index} exceeds token limit (${tokens} > ${MAX_ITEM_TOKENS})`),
      getModelQueryPrefix("voyage", modelToUse),
      (index, tokens) =>
        log.warn(`Text at index ${index} with prefix exceeds token limit (${tokens} > ${MAX_ITEM_TOKENS})`),
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

        const result = (await response.json()) as VoyageEmbeddingResponse

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
          log.warn(`Rate limit hit, retrying in ${delayMs}ms (attempt ${attempts + 1}/${MAX_RETRIES})`)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          continue
        }

        log.error("Voyage AI embedder batch error", {
          err: error instanceof Error ? error.message : String(error),
          location: "VoyageEmbedder:_embedBatchWithRetries",
          attempt: attempts + 1,
        })

        // Format and throw the error
        throw formatEmbeddingError(error, MAX_RETRIES)
      }
    }

    throw new Error(`Embedding failed after ${MAX_RETRIES} attempts`)
  }

  /**
   * Validates the Voyage AI embedder configuration by attempting a minimal embedding request
   * @returns Promise resolving to validation result with success status and optional error message
   */
  async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    return withValidationErrorHandling(async () => {
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS)
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
          signal: ctl.signal,
        }).finally(() => clearTimeout(timer))

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "Unknown error")
          const error = new Error(`HTTP ${response.status}: ${errorBody}`) as HttpError
          error.status = response.status
          throw error
        }

        const result = (await response.json()) as VoyageEmbeddingResponse

        // Check if we got a valid response
        if (!result.data || result.data.length === 0) {
          return {
            valid: false,
            error: "Voyage AI returned an invalid response format",
          }
        }

        return { valid: true }
      } catch (error) {
        log.error("Voyage AI embedder validation error", {
          err: error instanceof Error ? error.message : String(error),
          location: "VoyageEmbedder:validateConfiguration",
        })
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
