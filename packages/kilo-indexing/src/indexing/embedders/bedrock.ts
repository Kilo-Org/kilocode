import { BedrockRuntimeClient, InvokeModelCommand, type InvokeModelCommandInput } from "@aws-sdk/client-bedrock-runtime"
import { fromIni } from "@aws-sdk/credential-provider-ini"
import type { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces"
import {
  MAX_BATCH_TOKENS,
  MAX_ITEM_TOKENS,
  MAX_BATCH_RETRIES as MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS as INITIAL_DELAY_MS,
} from "../constants"
import { getDefaultModelId } from "../model-registry"
import { withValidationErrorHandling, formatEmbeddingError, type HttpError } from "../shared/validation-helpers"
import { Log } from "../../util/log"

const log = Log.create({ service: "embedder-bedrock" })

/**
 * Amazon Bedrock implementation of the embedder interface with batching and rate limiting
 */
export class BedrockEmbedder implements IEmbedder {
  private bedrockClient: BedrockRuntimeClient
  private readonly defaultModelId: string

  /**
   * Creates a new Amazon Bedrock embedder
   * @param region AWS region for Bedrock service (required)
   * @param profile AWS profile name for credentials (optional - uses default credential chain if not provided)
   * @param modelId Optional model ID override
   */
  constructor(
    private readonly region: string,
    private readonly profile?: string,
    modelId?: string,
  ) {
    if (!region) {
      throw new Error("Region is required for AWS Bedrock embedder")
    }

    // If profile is specified, use that profile.
    // Otherwise omit credentials so the AWS SDK uses the default provider chain.
    const cfg = this.profile
      ? {
          region: this.region,
          credentials: fromIni({ profile: this.profile }),
        }
      : {
          region: this.region,
        }

    this.bedrockClient = new BedrockRuntimeClient(cfg)

    this.defaultModelId = modelId || getDefaultModelId("bedrock")
  }

  /**
   * Creates embeddings for the given texts with batching and rate limiting
   * @param texts Array of text strings to embed
   * @param model Optional model identifier
   * @returns Promise resolving to embedding response
   */
  async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
    const modelToUse = model || this.defaultModelId

    const allEmbeddings: number[][] = []
    const usage = { promptTokens: 0, totalTokens: 0 }
    const remainingTexts = [...texts]

    while (remainingTexts.length > 0) {
      const currentBatch: string[] = []
      let currentBatchTokens = 0
      const processedIndices: number[] = []

      for (let i = 0; i < remainingTexts.length; i++) {
        const text = remainingTexts[i]
        const itemTokens = Math.ceil(text.length / 4)

        if (itemTokens > MAX_ITEM_TOKENS) {
          log.warn(`Text at index ${i} exceeds token limit (${itemTokens} > ${MAX_ITEM_TOKENS})`)
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
        const embeddings: number[][] = []
        let totalPromptTokens = 0
        let totalTokens = 0

        // Process each text in the batch
        // Note: Amazon Titan models typically don't support batch embedding in a single request
        // So we process them individually
        for (const text of batchTexts) {
          const embedding = await this._invokeEmbeddingModel(text, model)
          embeddings.push(embedding.embedding)
          totalPromptTokens += embedding.inputTextTokenCount || 0
          totalTokens += embedding.inputTextTokenCount || 0
        }

        return {
          embeddings,
          usage: {
            promptTokens: totalPromptTokens,
            totalTokens,
          },
        }
      } catch (error: any) {
        const hasMoreAttempts = attempts < MAX_RETRIES - 1

        // Check if it's a rate limit error
        if (error.name === "ThrottlingException" && hasMoreAttempts) {
          const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempts)
          log.warn(`Rate limit hit, retrying in ${delayMs}ms (attempt ${attempts + 1}/${MAX_RETRIES})`)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          continue
        }

        log.error("Bedrock embedder batch error", {
          err: error instanceof Error ? error.message : String(error),
          location: "BedrockEmbedder:_embedBatchWithRetries",
          attempt: attempts + 1,
        })

        // Format and throw the error
        throw formatEmbeddingError(error, MAX_RETRIES)
      }
    }

    throw new Error(`Embedding failed after ${MAX_RETRIES} attempts`)
  }

  /**
   * Invokes the embedding model for a single text
   * @param text The text to embed
   * @param model The model identifier to use
   * @returns Promise resolving to embedding and token count
   */
  private async _invokeEmbeddingModel(
    text: string,
    model: string,
  ): Promise<{ embedding: number[]; inputTextTokenCount?: number }> {
    let requestBody: any
    let modelId = model

    // Prepare the request body based on the model
    if (model.startsWith("amazon.nova-2-multimodal")) {
      // Nova multimodal embeddings use a task-based format with embeddingParams
      // Reference: https://docs.aws.amazon.com/bedrock/latest/userguide/embeddings-nova.html
      requestBody = {
        taskType: "SINGLE_EMBEDDING",
        singleEmbeddingParams: {
          embeddingPurpose: "GENERIC_INDEX",
          embeddingDimension: 1024, // Nova supports 1024 or 3072
          text: {
            truncationMode: "END",
            value: text,
          },
        },
      }
    } else if (model.startsWith("amazon.titan-embed")) {
      requestBody = {
        inputText: text,
      }
    } else if (model.startsWith("cohere.embed")) {
      requestBody = {
        texts: [text],
        input_type: "search_document", // or "search_query" depending on use case
      }
    } else {
      // Default to Titan format
      requestBody = {
        inputText: text,
      }
    }

    const params: InvokeModelCommandInput = {
      modelId,
      body: JSON.stringify(requestBody),
      contentType: "application/json",
      accept: "application/json",
    }

    const command = new InvokeModelCommand(params)

    const response = await this.bedrockClient.send(command)

    // Parse the response
    const responseBody = JSON.parse(new TextDecoder().decode(response.body))

    // Extract embedding based on model type
    if (model.startsWith("amazon.nova-2-multimodal")) {
      // Nova multimodal returns { embeddings: [{ embedding: [...] }] }
      // Reference: AWS Bedrock documentation
      return {
        embedding: responseBody.embeddings?.[0]?.embedding || responseBody.embedding,
        inputTextTokenCount: responseBody.inputTextTokenCount,
      }
    } else if (model.startsWith("amazon.titan-embed")) {
      return {
        embedding: responseBody.embedding,
        inputTextTokenCount: responseBody.inputTextTokenCount,
      }
    } else if (model.startsWith("cohere.embed")) {
      return {
        embedding: responseBody.embeddings[0],
        // Cohere doesn't provide token count in response
      }
    } else {
      // Default to Titan format
      return {
        embedding: responseBody.embedding,
        inputTextTokenCount: responseBody.inputTextTokenCount,
      }
    }
  }

  /**
   * Validates the Bedrock embedder configuration by attempting a minimal embedding request
   * @returns Promise resolving to validation result with success status and optional error message
   */
  async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
    return withValidationErrorHandling(async () => {
      try {
        // Test with a minimal embedding request
        const result = await this._invokeEmbeddingModel("test", this.defaultModelId)

        // Check if we got a valid response
        if (!result.embedding || result.embedding.length === 0) {
          return {
            valid: false,
            error: "Bedrock returned an invalid response format",
          }
        }

        return { valid: true }
      } catch (error: any) {
        // Check for specific AWS errors
        if (error.name === "UnrecognizedClientException") {
          return {
            valid: false,
            error: "Invalid AWS credentials for Bedrock",
          }
        }

        if (error.name === "AccessDeniedException") {
          return {
            valid: false,
            error: "Access denied to Bedrock embedding model",
          }
        }

        if (error.name === "ResourceNotFoundException") {
          return {
            valid: false,
            error: `Bedrock model '${this.defaultModelId}' not found`,
          }
        }

        log.error("Bedrock embedder validation error", {
          err: error instanceof Error ? error.message : String(error),
          location: "BedrockEmbedder:validateConfiguration",
        })
        throw error
      }
    }, "bedrock")
  }

  get embedderInfo(): EmbedderInfo {
    return {
      name: "bedrock",
    }
  }
}
