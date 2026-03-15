// TODO: These tests require fake timers (vitest.useFakeTimers) which bun:test doesn't support

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { mockEmbeddingsCreate, openAIMockFactory } from "./__helpers__/openai-mock"

mock.module("openai", openAIMockFactory)

import { OpenAICompatibleEmbedder } from "../../../../src/indexing/embedders/openai-compatible"

describe.skip("OpenAICompatibleEmbedder - Global Rate Limiting", () => {
  const testBaseUrl = "https://api.openai.com/v1"
  const testApiKey = "test-api-key"
  const testModelId = "text-embedding-3-small"

  beforeEach(() => {
    mockEmbeddingsCreate.mockReset()

    mockEmbeddingsCreate.mockImplementation(() => mockEmbeddingsCreate)

    // Reset global rate limit state
    const embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
    ;(embedder as any).constructor.globalRateLimitState = {
      isRateLimited: false,
      rateLimitResetTime: 0,
      consecutiveRateLimitErrors: 0,
      lastRateLimitError: 0,
      mutex: (embedder as any).constructor.globalRateLimitState.mutex,
    }
  })

  afterEach(() => {
    mockEmbeddingsCreate.mockReset()
  })

  test("should apply global rate limiting across multiple batch requests", async () => {
    const embedder1 = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
    const embedder2 = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

    // First batch hits rate limit
    const rateLimitError = new Error("Rate limit exceeded") as any
    rateLimitError.status = 429

    mockEmbeddingsCreate
      .mockRejectedValueOnce(rateLimitError) // First attempt fails
      .mockResolvedValue({
        data: [{ embedding: "base64encodeddata" }],
        usage: { prompt_tokens: 10, total_tokens: 15 },
      })

    // Start first batch request
    const batch1Promise = embedder1.createEmbeddings(["test1"])

    // Start second batch request while global rate limit is active
    const batch2Promise = embedder2.createEmbeddings(["test2"])

    // Check that global rate limit was set
    const state = (embedder1 as any).constructor.globalRateLimitState
    expect(state.isRateLimited).toBe(true)
    expect(state.consecutiveRateLimitErrors).toBe(1)

    // Both requests should complete
    const [result1, result2] = await Promise.all([batch1Promise, batch2Promise])

    expect(result1.embeddings).toHaveLength(1)
    expect(result2.embeddings).toHaveLength(1)
  })

  test("should track consecutive rate limit errors", async () => {
    const embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
    const state = (embedder as any).constructor.globalRateLimitState

    const rateLimitError = new Error("Rate limit exceeded") as any
    rateLimitError.status = 429

    // Test that consecutive errors increment when they happen quickly
    // Mock multiple rate limit errors in a single request
    mockEmbeddingsCreate
      .mockRejectedValueOnce(rateLimitError) // First attempt
      .mockRejectedValueOnce(rateLimitError) // Retry 1
      .mockResolvedValueOnce({
        data: [{ embedding: "base64encodeddata" }],
        usage: { prompt_tokens: 10, total_tokens: 15 },
      })

    const promise1 = embedder.createEmbeddings(["test1"])
    expect(state.consecutiveRateLimitErrors).toBe(1)

    await promise1

    // Verify the delay increases with consecutive errors
    // Make another request immediately that also hits rate limit
    mockEmbeddingsCreate.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({
      data: [{ embedding: "base64encodeddata" }],
      usage: { prompt_tokens: 10, total_tokens: 15 },
    })

    // Store the current consecutive count before the next request
    const previousCount = state.consecutiveRateLimitErrors

    const promise2 = embedder.createEmbeddings(["test2"])

    // Should have incremented from the previous count
    expect(state.consecutiveRateLimitErrors).toBeGreaterThan(previousCount)

    // Complete the second request
    await promise2
  })

  test("should reset consecutive error count after time passes", async () => {
    const embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
    const state = (embedder as any).constructor.globalRateLimitState

    // Manually set state to simulate previous errors
    state.consecutiveRateLimitErrors = 3
    state.lastRateLimitError = Date.now() - 70000 // 70 seconds ago

    const rateLimitError = new Error("Rate limit exceeded") as any
    rateLimitError.status = 429

    mockEmbeddingsCreate.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({
      data: [{ embedding: "base64encodeddata" }],
      usage: { prompt_tokens: 10, total_tokens: 15 },
    })

    // Trigger the updateGlobalRateLimitState method
    await (embedder as any).updateGlobalRateLimitState(rateLimitError)

    // Should reset to 1 since more than 60 seconds passed
    expect(state.consecutiveRateLimitErrors).toBe(1)
  })

  test("should not exceed maximum delay of 5 minutes", async () => {
    const embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
    const state = (embedder as any).constructor.globalRateLimitState

    // Set state to simulate many consecutive errors
    state.consecutiveRateLimitErrors = 10 // This would normally result in a very long delay

    const rateLimitError = new Error("Rate limit exceeded") as any
    rateLimitError.status = 429

    // Trigger the updateGlobalRateLimitState method
    await (embedder as any).updateGlobalRateLimitState(rateLimitError)

    // Calculate the expected delay
    const now = Date.now()
    const delay = state.rateLimitResetTime - now

    // Should be capped at 5 minutes (300000ms)
    expect(delay).toBeLessThanOrEqual(300000)
    expect(delay).toBeGreaterThan(0)
  })
})
