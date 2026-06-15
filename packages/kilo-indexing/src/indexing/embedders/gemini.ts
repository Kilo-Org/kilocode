import { OpenAICompatibleEmbedder } from "./openai-compatible"
import type { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import { GEMINI_MAX_ITEM_TOKENS } from "../constants"
import { Log } from "../../util/log"
import { getDefaultModelId } from "../model-registry"

const log = Log.create({ service: "embedder-gemini" })

/**
 * Gemini embedder implementation that wraps the OpenAI Compatible embedder
 * with configuration for Google's Gemini embedding API.
 *
 * Supported models:
 * - text-embedding-004 (dimension: 768)
 * - gemini-embedding-001 (dimension: 3072)
 */
export class GeminiEmbedder implements IEmbedder {
  private readonly openAICompatibleEmbedder: OpenAICompatibleEmbedder
  private static readonly GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
  private readonly modelId: string

  /**
   * Creates a new Gemini embedder
   * @param apiKey The Gemini API key for authentication
   * @param modelId The model ID to use (defaults to gemini-embedding-001)
   */
  constructor(apiKey: string, modelId?: string) {
    if (!apiKey) {
      throw new Error("API key is required for Gemini embedder")
    }

    // Use provided model or default
    this.modelId = modelId || getDefaultModelId("gemini")

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
      log.error("Gemini embedder error in createEmbeddings", {
        err: error instanceof Error ? error.message : String(error),
        location: "GeminiEmbedder:createEmbeddings",
      })
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
      log.error("Gemini embedder validation error", {
        err: error instanceof Error ? error.message : String(error),
        location: "GeminiEmbedder:validateConfiguration",
      })
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
