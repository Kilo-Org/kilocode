import { OpenAI } from "openai"
import type { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces"
import {
  MAX_BATCH_TOKENS,
  MAX_ITEM_TOKENS,
  MAX_BATCH_RETRIES as MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS as INITIAL_DELAY_MS,
  REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
  REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
} from "../constants"
import { getModelQueryPrefix } from "../model-registry"
import { withValidationErrorHandling, formatEmbeddingError, type HttpError } from "../shared/validation-helpers"
import { embedBatches } from "../shared/embedder-helpers"
import { Log } from "../../util/log"

const log = Log.create({ service: "embedder-openai" })

/**
 * OpenAI implementation of the embedder interface with batching and rate limiting
 */
export class OpenAiEmbedder implements IEmbedder {
  private embeddingsClient: OpenAI
  private readonly defaultModelId: string

  /**
   * Creates a new OpenAI embedder
   * @param apiKey The OpenAI API key for authentication
   * @param modelId Optional model identifier (defaults to "text-embedding-3-small")
   */
  constructor(apiKey: string, modelId?: string) {
    try {
      this.embeddingsClient = new OpenAI({ apiKey })
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }

    this.defaultModelId = modelId || "text-embedding-3-small"
  }

  /**
   * Creates embeddings for the given texts with batching and rate limiting
   * @param texts Array of text strings to embed
   * @param model Optional model identifier
   * @returns Promise resolving to embedding response
   */
  async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
    const modelToUse = model || this.defaultModelId

    return embedBatches(
      texts,
      MAX_ITEM_TOKENS,
      MAX_BATCH_TOKENS,
      (batch) => this._embedBatchWithRetries(batch, modelToUse),
      (index, tokens) => log.warn(`Text at index ${index} exceeds token limit (${tokens} > ${MAX_ITEM_TOKENS})`),
      getModelQueryPrefix("openai", modelToUse),
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
        const response = await this.embeddingsClient.embeddings.create({
          input: batchTexts,
          model: model,
        })

        return {
          embeddings: response.data.map((item: any) => item.embedding),
          usage: {
            promptTokens: response.usage?.prompt_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0,
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

        log.error("OpenAI embedder batch error", {
          err: error instanceof Error ? error.message : String(error),
          location: "OpenAiEmbedder:_embedBatchWithRetries",
          attempt: attempts + 1,
        })

        // Format and throw the error
        throw formatEmbeddingError(error, MAX_RETRIES)
      }
    }

    throw new Error(`Embedding failed after ${MAX_RETRIES} attempts`)
  }

  /**
   * Validates the OpenAI embedder configuration by attempting a minimal embedding request
   * @returns Promise resolving to validation result with success status and optional error message
   */
  async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    return withValidationErrorHandling(async () => {
      try {
        // Test with a minimal embedding request
        const response = await this.embeddingsClient.embeddings.create(
          {
            input: ["test"],
            model: this.defaultModelId,
          },
          {
            timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
            maxRetries: REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
          },
        )

        // Check if we got a valid response
        if (!response.data || response.data.length === 0) {
          return {
            valid: false,
            error: "OpenAI returned an invalid response format",
          }
        }

        return { valid: true }
      } catch (error) {
        log.error("OpenAI embedder validation error", {
          err: error instanceof Error ? error.message : String(error),
          location: "OpenAiEmbedder:validateConfiguration",
        })
        throw error
      }
    }, "openai")
  }

  get embedderInfo(): EmbedderInfo {
    return {
      name: "openai",
    }
  }
}
