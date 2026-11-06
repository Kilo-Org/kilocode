import { OpenAICompatibleEmbedder } from "./openai-compatible"
import type { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import { MAX_ITEM_TOKENS } from "../constants"
import { Log } from "../../util/log"
import { getDefaultModelId } from "../model-registry"

const log = Log.create({ service: "embedder-mistral" })

/**
 * Mistral embedder implementation that wraps the OpenAI Compatible embedder
 * with configuration for Mistral's embedding API.
 *
 * Supported models:
 * - codestral-embed-2505 (dimension: 1536)
 * - mistral-embed (dimension: 1024)
 */
export class MistralEmbedder implements IEmbedder {
  private readonly openAICompatibleEmbedder: OpenAICompatibleEmbedder
  private static readonly MISTRAL_BASE_URL = "https://api.mistral.ai/v1"
  private readonly modelId: string

  /**
   * Creates a new Mistral embedder
   * @param apiKey The Mistral API key for authentication
   * @param modelId The model ID to use (defaults to codestral-embed-2505)
   */
  constructor(apiKey: string, modelId?: string) {
    if (!apiKey) {
      throw new Error("API key is required for Mistral embedder")
    }

    // Use provided model or default
    this.modelId = modelId || getDefaultModelId("mistral")

    // Create an OpenAI Compatible embedder with Mistral's configuration
    this.openAICompatibleEmbedder = new OpenAICompatibleEmbedder(
      MistralEmbedder.MISTRAL_BASE_URL,
      apiKey,
      this.modelId,
      MAX_ITEM_TOKENS, // This is the max token limit (8191), not the embedding dimension
    )
  }

  /**
   * Creates embeddings for the given texts using Mistral's embedding API
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
      log.error("Mistral embedder error in createEmbeddings", {
        err: error instanceof Error ? error.message : String(error),
        location: "MistralEmbedder:createEmbeddings",
      })
      throw error
    }
  }

  /**
   * Validates the Mistral embedder configuration by delegating to the underlying OpenAI-compatible embedder
   * @returns Promise resolving to validation result with success status and optional error message
   */
  async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    try {
      // Delegate validation to the OpenAI-compatible embedder
      // The error messages will be specific to Mistral since we're using Mistral's base URL
      return await this.openAICompatibleEmbedder.validateConfiguration()
    } catch (error) {
      log.error("Mistral embedder validation error", {
        err: error instanceof Error ? error.message : String(error),
        location: "MistralEmbedder:validateConfiguration",
      })
      throw error
    }
  }

  /**
   * Returns information about this embedder
   */
  get embedderInfo(): EmbedderInfo {
    return {
      name: "mistral",
    }
  }
}
