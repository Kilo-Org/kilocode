import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"

// Set up AWS SDK mocks BEFORE importing modules that use them
const mockSend = mock()
mock.module("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send = mockSend
  },
  InvokeModelCommand: class {
    constructor(public input: any) {}
  },
}))
const mockFromEnv = mock(() => Promise.resolve({}))
const mockFromIni = mock(() => Promise.resolve({}))
mock.module("@aws-sdk/credential-provider-ini", () => ({
  fromIni: mockFromIni,
}))

// Now import the module under test
import { BedrockEmbedder } from "../../../../src/indexing/embedders/bedrock"
import { MAX_ITEM_TOKENS } from "../../../../src/indexing/constants"

describe("BedrockEmbedder", () => {
  let embedder: BedrockEmbedder

  beforeEach(() => {
    mockSend.mockReset()
    embedder = new BedrockEmbedder("us-east-1", "test-profile", "amazon.titan-embed-text-v2:0")
  })

  describe("constructor", () => {
    test("should initialize with provided region, profile and model", () => {
      expect(embedder.embedderInfo.name).toBe("bedrock")
    })

    test("should require region", () => {
      expect(() => new BedrockEmbedder("", "profile", "model")).toThrow("Region is required for AWS Bedrock embedder")
    })

    test("should use profile for credentials", () => {
      mockFromEnv.mockReset()
      mockFromIni.mockReset()
      const inst = new BedrockEmbedder("us-west-2", "dev-profile")
      expect(inst).toBeDefined()
      expect(mockFromIni).toHaveBeenCalledWith({ profile: "dev-profile" })
      expect(mockFromEnv).not.toHaveBeenCalled()
    })

    test("should use default credential chain when profile is not provided", () => {
      mockFromEnv.mockReset()
      mockFromIni.mockReset()

      const inst = new BedrockEmbedder("us-west-2")

      expect(inst).toBeDefined()
      expect(mockFromIni).not.toHaveBeenCalled()
      expect(mockFromEnv).not.toHaveBeenCalled()
    })
  })

  describe("createEmbeddings", () => {
    const testModelId = "amazon.titan-embed-text-v2:0"

    test("should create embeddings for a single text with Titan model", async () => {
      const testTexts = ["Hello world"]
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: [0.1, 0.2, 0.3],
            inputTextTokenCount: 2,
          }),
        ),
      }
      mockSend.mockResolvedValue(mockResponse)

      const result = await embedder.createEmbeddings(testTexts)

      expect(mockSend).toHaveBeenCalled()
      const command = mockSend.mock.calls[0][0] as any
      expect(command.input.modelId).toBe(testModelId)
      const bodyStr =
        typeof command.input.body === "string"
          ? command.input.body
          : new TextDecoder().decode(command.input.body as Uint8Array)
      expect(JSON.parse(bodyStr || "{}")).toEqual({
        inputText: "Hello world",
      })

      expect(result).toEqual({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { promptTokens: 2, totalTokens: 2 },
      })
    })

    test("should create embeddings for multiple texts", async () => {
      const testTexts = ["Hello world", "Another text"]
      const mockResponses = [
        {
          body: new TextEncoder().encode(
            JSON.stringify({
              embedding: [0.1, 0.2, 0.3],
              inputTextTokenCount: 2,
            }),
          ),
        },
        {
          body: new TextEncoder().encode(
            JSON.stringify({
              embedding: [0.4, 0.5, 0.6],
              inputTextTokenCount: 3,
            }),
          ),
        },
      ]

      mockSend.mockResolvedValueOnce(mockResponses[0]).mockResolvedValueOnce(mockResponses[1])

      const result = await embedder.createEmbeddings(testTexts)

      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(result).toEqual({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ],
        usage: { promptTokens: 5, totalTokens: 5 },
      })
    })

    test("should handle Cohere model format", async () => {
      const cohereEmbedder = new BedrockEmbedder("us-east-1", "test-profile", "cohere.embed-english-v3")
      const testTexts = ["Hello world"]
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embeddings: [[0.1, 0.2, 0.3]],
          }),
        ),
      }
      mockSend.mockResolvedValue(mockResponse)

      const result = await cohereEmbedder.createEmbeddings(testTexts)

      const command = mockSend.mock.calls[0][0] as any
      const bodyStr =
        typeof command.input.body === "string"
          ? command.input.body
          : new TextDecoder().decode(command.input.body as Uint8Array)
      expect(JSON.parse(bodyStr || "{}")).toEqual({
        texts: ["Hello world"],
        input_type: "search_document",
      })

      expect(result).toEqual({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { promptTokens: 0, totalTokens: 0 },
      })
    })

    test("should create embeddings with Nova multimodal model", async () => {
      const novaMultimodalEmbedder = new BedrockEmbedder(
        "us-east-1",
        "test-profile",
        "amazon.nova-2-multimodal-embeddings-v1:0",
      )
      const testTexts = ["Hello world"]
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embeddings: [
              {
                embedding: [0.1, 0.2, 0.3],
              },
            ],
            inputTextTokenCount: 2,
          }),
        ),
      }
      mockSend.mockResolvedValue(mockResponse)

      const result = await novaMultimodalEmbedder.createEmbeddings(testTexts)

      expect(mockSend).toHaveBeenCalled()
      const command = mockSend.mock.calls[0][0] as any
      expect(command.input.modelId).toBe("amazon.nova-2-multimodal-embeddings-v1:0")
      const bodyStr =
        typeof command.input.body === "string"
          ? command.input.body
          : new TextDecoder().decode(command.input.body as Uint8Array)
      expect(JSON.parse(bodyStr || "{}")).toEqual({
        taskType: "SINGLE_EMBEDDING",
        singleEmbeddingParams: {
          embeddingPurpose: "GENERIC_INDEX",
          embeddingDimension: 1024,
          text: {
            truncationMode: "END",
            value: "Hello world",
          },
        },
      })

      expect(result).toEqual({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { promptTokens: 2, totalTokens: 2 },
      })
    })

    test("should handle Nova multimodal model with multiple texts", async () => {
      const novaMultimodalEmbedder = new BedrockEmbedder(
        "us-east-1",
        "test-profile",
        "amazon.nova-2-multimodal-embeddings-v1:0",
      )
      const testTexts = ["Hello world", "Another text"]
      const mockResponses = [
        {
          body: new TextEncoder().encode(
            JSON.stringify({
              embeddings: [
                {
                  embedding: [0.1, 0.2, 0.3],
                },
              ],
              inputTextTokenCount: 2,
            }),
          ),
        },
        {
          body: new TextEncoder().encode(
            JSON.stringify({
              embeddings: [
                {
                  embedding: [0.4, 0.5, 0.6],
                },
              ],
              inputTextTokenCount: 3,
            }),
          ),
        },
      ]

      mockSend.mockResolvedValueOnce(mockResponses[0]).mockResolvedValueOnce(mockResponses[1])

      const result = await novaMultimodalEmbedder.createEmbeddings(testTexts)

      expect(mockSend).toHaveBeenCalledTimes(2)

      // Verify the request format for both texts
      const firstCommand = mockSend.mock.calls[0][0] as any
      const firstBodyStr =
        typeof firstCommand.input.body === "string"
          ? firstCommand.input.body
          : new TextDecoder().decode(firstCommand.input.body as Uint8Array)
      expect(JSON.parse(firstBodyStr || "{}")).toEqual({
        taskType: "SINGLE_EMBEDDING",
        singleEmbeddingParams: {
          embeddingPurpose: "GENERIC_INDEX",
          embeddingDimension: 1024,
          text: {
            truncationMode: "END",
            value: "Hello world",
          },
        },
      })

      const secondCommand = mockSend.mock.calls[1][0] as any
      const secondBodyStr =
        typeof secondCommand.input.body === "string"
          ? secondCommand.input.body
          : new TextDecoder().decode(secondCommand.input.body as Uint8Array)
      expect(JSON.parse(secondBodyStr || "{}")).toEqual({
        taskType: "SINGLE_EMBEDDING",
        singleEmbeddingParams: {
          embeddingPurpose: "GENERIC_INDEX",
          embeddingDimension: 1024,
          text: {
            truncationMode: "END",
            value: "Another text",
          },
        },
      })

      expect(result).toEqual({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ],
        usage: { promptTokens: 5, totalTokens: 5 },
      })
    })

    test("should use custom model when provided", async () => {
      const testTexts = ["Hello world"]
      const customModel = "amazon.titan-embed-text-v1"
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: [0.1, 0.2, 0.3],
            inputTextTokenCount: 2,
          }),
        ),
      }
      mockSend.mockResolvedValue(mockResponse)

      await embedder.createEmbeddings(testTexts, customModel)

      const command = mockSend.mock.calls[0][0] as any
      expect(command.input.modelId).toBe(customModel)
    })

    test("should handle missing token count data gracefully", async () => {
      const testTexts = ["Hello world"]
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: [0.1, 0.2, 0.3],
          }),
        ),
      }
      mockSend.mockResolvedValue(mockResponse)

      const result = await embedder.createEmbeddings(testTexts)

      expect(result).toEqual({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { promptTokens: 0, totalTokens: 0 },
      })
    })

    describe("batching logic", () => {
      test("should skip texts exceeding maximum token limit", async () => {
        // Create a text that exceeds MAX_ITEM_TOKENS (4 characters ~ 1 token)
        const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 4 + 100)
        const normalText = "normal text"
        const testTexts = [normalText, oversizedText, "another normal"]

        const mockResponses = [
          {
            body: new TextEncoder().encode(
              JSON.stringify({
                embedding: [0.1, 0.2, 0.3],
                inputTextTokenCount: 3,
              }),
            ),
          },
          {
            body: new TextEncoder().encode(
              JSON.stringify({
                embedding: [0.4, 0.5, 0.6],
                inputTextTokenCount: 3,
              }),
            ),
          },
        ]

        mockSend.mockResolvedValueOnce(mockResponses[0]).mockResolvedValueOnce(mockResponses[1])

        const result = await embedder.createEmbeddings(testTexts)

        // Verify only normal texts were processed (oversized skipped)
        expect(mockSend).toHaveBeenCalledTimes(2)
        expect(result.embeddings).toHaveLength(2)
      })

      test("should handle all texts being skipped due to size", async () => {
        const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 4 + 100)
        const testTexts = [oversizedText, oversizedText]

        const result = await embedder.createEmbeddings(testTexts)

        expect(mockSend).not.toHaveBeenCalled()
        expect(result).toEqual({
          embeddings: [],
          usage: { promptTokens: 0, totalTokens: 0 },
        })
      })
    })

    describe("retry logic", () => {
      // TODO: bun:test doesn't support fake timers
      test.skip("should retry on throttling errors with exponential backoff", async () => {
        const testTexts = ["Hello world"]
        const throttlingError = new Error("Rate limit exceeded")
        throttlingError.name = "ThrottlingException"

        mockSend
          .mockRejectedValueOnce(throttlingError)
          .mockRejectedValueOnce(throttlingError)
          .mockResolvedValueOnce({
            body: new TextEncoder().encode(
              JSON.stringify({
                embedding: [0.1, 0.2, 0.3],
                inputTextTokenCount: 2,
              }),
            ),
          })

        const result = await embedder.createEmbeddings(testTexts)

        expect(mockSend).toHaveBeenCalledTimes(3)
        expect(result).toEqual({
          embeddings: [[0.1, 0.2, 0.3]],
          usage: { promptTokens: 2, totalTokens: 2 },
        })
      })

      test("should not retry on non-throttling errors", async () => {
        const testTexts = ["Hello world"]
        const authError = new Error("Unauthorized")
        authError.name = "UnrecognizedClientException"

        mockSend.mockRejectedValue(authError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: Unauthorized",
        )

        expect(mockSend).toHaveBeenCalledTimes(1)
      })
    })

    describe("error handling", () => {
      test("should handle API errors gracefully", async () => {
        const testTexts = ["Hello world"]
        const apiError = new Error("API connection failed")

        mockSend.mockRejectedValue(apiError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: API connection failed",
        )
      })

      test("should handle empty text arrays", async () => {
        const testTexts: string[] = []

        const result = await embedder.createEmbeddings(testTexts)

        expect(result).toEqual({
          embeddings: [],
          usage: { promptTokens: 0, totalTokens: 0 },
        })
        expect(mockSend).not.toHaveBeenCalled()
      })

      test("should handle malformed API responses", async () => {
        const testTexts = ["Hello world"]
        const malformedResponse = {
          body: new TextEncoder().encode("not json"),
        }

        mockSend.mockResolvedValue(malformedResponse)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow()
      })

      test("should handle AWS-specific errors", async () => {
        const testTexts = ["Hello world"]

        // Test UnrecognizedClientException
        const authError = new Error("Invalid credentials")
        authError.name = "UnrecognizedClientException"
        mockSend.mockRejectedValueOnce(authError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: Invalid credentials",
        )

        // Test AccessDeniedException
        const accessError = new Error("Access denied")
        accessError.name = "AccessDeniedException"
        mockSend.mockRejectedValueOnce(accessError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: Access denied",
        )

        // Test ResourceNotFoundException
        const notFoundError = new Error("Model not found")
        notFoundError.name = "ResourceNotFoundException"
        mockSend.mockRejectedValueOnce(notFoundError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: Model not found",
        )
      })
    })
  })

  describe("validateConfiguration", () => {
    test("should validate successfully with valid configuration", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: [0.1, 0.2, 0.3],
            inputTextTokenCount: 1,
          }),
        ),
      }
      mockSend.mockResolvedValue(mockResponse)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
      expect(mockSend).toHaveBeenCalled()
    })

    test("should fail validation with authentication error", async () => {
      const authError = new Error("Invalid credentials")
      authError.name = "UnrecognizedClientException"
      mockSend.mockRejectedValue(authError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Invalid AWS credentials for Bedrock")
    })

    test("should fail validation with access denied error", async () => {
      const accessError = new Error("Access denied")
      accessError.name = "AccessDeniedException"
      mockSend.mockRejectedValue(accessError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Access denied to Bedrock embedding model")
    })

    test("should fail validation with model not found error", async () => {
      const notFoundError = new Error("Model not found")
      notFoundError.name = "ResourceNotFoundException"
      mockSend.mockRejectedValue(notFoundError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("not found")
    })

    test("should fail validation with invalid response", async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            // Missing embedding field
            inputTextTokenCount: 1,
          }),
        ),
      }
      mockSend.mockResolvedValue(mockResponse)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Bedrock returned an invalid response format")
    })

    test("should fail validation with connection error", async () => {
      const connectionError = new Error("ECONNREFUSED")
      mockSend.mockRejectedValue(connectionError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("Connection failed")
    })

    test("should fail validation with generic error", async () => {
      const genericError = new Error("Unknown error")
      mockSend.mockRejectedValue(genericError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("Configuration error")
    })
  })
})
