import type { EmbedderInfo, EmbeddingResponse, IEmbedder } from "../interfaces"
import { getModelQueryPrefix } from "../model-registry"
import { MAX_ITEM_TOKENS, OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS } from "../constants"
import { withValidationErrorHandling, sanitizeErrorMessage } from "../shared/validation-helpers"
import { Log } from "../../util/log"

const log = Log.create({ service: "embedder-ollama" })

type OllamaEmbeddingResult = {
  embeddings?: number[][]
}

type OllamaModel = {
  name?: string
}

type OllamaModelsResult = {
  models?: OllamaModel[]
}

/**
 * Implements the IEmbedder interface using a local Ollama instance.
 */
export class CodeIndexOllamaEmbedder implements IEmbedder {
  private readonly baseUrl: string
  private readonly defaultModelId: string
  private readonly dimensions?: number

  constructor(baseUrl: string, modelId?: string, dimension?: number) {
    let normalizedUrl = baseUrl || "http://localhost:11434"

    // Normalize the baseUrl by removing all trailing slashes
    normalizedUrl = normalizedUrl.replace(/\/+$/, "")

    this.baseUrl = normalizedUrl
    this.defaultModelId = modelId || "nomic-embed-text:latest"
    this.dimensions = dimension
  }

  /**
   * Creates embeddings for the given texts using the specified Ollama model.
   * @param texts - An array of strings to embed.
   * @param model - Optional model ID to override the default.
   * @returns A promise that resolves to an EmbeddingResponse containing the embeddings and usage data.
   */
  async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
    const modelToUse = model || this.defaultModelId
    const dimensions = this.dimensions
    const url = `${this.baseUrl}/api/embed` // Endpoint as specified

    // Apply model-specific query prefix if required
    const queryPrefix = getModelQueryPrefix("ollama", modelToUse)
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

    try {
      // Add timeout to prevent indefinite hanging
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS)

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelToUse,
          input: processedTexts,
          dimensions,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        let errorBody = "Could not read error body"
        try {
          errorBody = await response.text()
        } catch (e) {
          // Ignore error reading body
        }
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText} - ${errorBody}`)
      }

      const data = (await response.json()) as OllamaEmbeddingResult

      // Extract embeddings using 'embeddings' key as requested
      const embeddings = data.embeddings
      if (!embeddings || !Array.isArray(embeddings)) {
        throw new Error("Invalid Ollama response structure: missing embeddings array")
      }

      return {
        embeddings: embeddings,
      }
    } catch (error: unknown) {
      log.error("Ollama embedding failed", {
        err: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
        location: "OllamaEmbedder:createEmbeddings",
      })

      // Handle specific error types with better messages
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Connection to embedding service failed (timeout)")
      } else if (
        error instanceof Error &&
        (error.message.includes("fetch failed") || ("code" in error && error.code === "ECONNREFUSED"))
      ) {
        throw new Error(`Ollama service is not running at ${this.baseUrl}`)
      } else if (error instanceof Error && "code" in error && error.code === "ENOTFOUND") {
        throw new Error(`Ollama host not found at ${this.baseUrl}`)
      }

      // Re-throw a more specific error for the caller
      throw new Error(`Ollama embedding failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Validates the Ollama embedder configuration by checking service availability and model existence
   * @returns Promise resolving to validation result with success status and optional error message
   */
  async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    return withValidationErrorHandling(
      async () => {
        // First check if Ollama service is running by trying to list models
        const modelsUrl = `${this.baseUrl}/api/tags`

        // Add timeout to prevent indefinite hanging
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS)

        const modelsResponse = await fetch(modelsUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!modelsResponse.ok) {
          if (modelsResponse.status === 404) {
            return {
              valid: false,
              error: `Ollama service is not running at ${this.baseUrl}`,
            }
          }
          return {
            valid: false,
            error: `Ollama service unavailable at ${this.baseUrl} (status ${modelsResponse.status})`,
          }
        }

        // Check if the specific model exists
        const modelsData = (await modelsResponse.json()) as OllamaModelsResult
        const models = modelsData.models ?? []

        // Check both with and without :latest suffix
        const modelExists = models.some((m) => {
          const modelName = m.name ?? ""
          return (
            modelName === this.defaultModelId ||
            modelName === `${this.defaultModelId}:latest` ||
            modelName === this.defaultModelId.replace(":latest", "")
          )
        })

        if (!modelExists) {
          const availableModels = models.map((m) => m.name ?? "").join(", ")
          return {
            valid: false,
            error: `Model '${this.defaultModelId}' not found. Available models: ${availableModels}`,
          }
        }

        // Try a test embedding to ensure the model works for embeddings
        const testUrl = `${this.baseUrl}/api/embed`

        // Add timeout for test request too
        const testController = new AbortController()
        const testTimeoutId = setTimeout(() => testController.abort(), OLLAMA_EMBEDDER_REQUEST_TIMEOUT_MS)

        const testResponse = await fetch(testUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.defaultModelId,
            input: ["test"],
          }),
          signal: testController.signal,
        })
        clearTimeout(testTimeoutId)

        if (!testResponse.ok) {
          return {
            valid: false,
            error: `Model '${this.defaultModelId}' is not capable of generating embeddings`,
          }
        }

        return { valid: true }
      },
      "ollama",
      {
        beforeStandardHandling: (error: any) => {
          // Handle Ollama-specific connection errors
          if (
            error?.message?.includes("fetch failed") ||
            error?.code === "ECONNREFUSED" ||
            error?.message?.includes("ECONNREFUSED")
          ) {
            log.error("Ollama connection failed", {
              err: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
              location: "OllamaEmbedder:validateConfiguration:connectionFailed",
            })
            return {
              valid: false,
              error: `Ollama service is not running at ${this.baseUrl}`,
            }
          } else if (error?.code === "ENOTFOUND" || error?.message?.includes("ENOTFOUND")) {
            log.error("Ollama host not found", {
              err: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
              location: "OllamaEmbedder:validateConfiguration:hostNotFound",
            })
            return {
              valid: false,
              error: `Ollama host not found at ${this.baseUrl}`,
            }
          } else if (error?.name === "AbortError") {
            log.error("Ollama connection timeout", {
              err: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
              location: "OllamaEmbedder:validateConfiguration:timeout",
            })
            // Handle timeout
            return {
              valid: false,
              error: "Connection to embedding service failed (timeout)",
            }
          }
          // Let standard handling take over
          return undefined
        },
      },
    )
  }

  get embedderInfo(): EmbedderInfo {
    return {
      name: "ollama",
    }
  }
}
