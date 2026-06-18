import { describe, expect, test } from "bun:test"
import { toIndexingConfigInput } from "../../../src/config"
import { CodeIndexConfigManager, type IndexingConfigInput } from "../../../src/indexing/config-manager"

function createInput(input: Partial<IndexingConfigInput> = {}): IndexingConfigInput {
  return {
    enabled: true,
    embedderProvider: "openai",
    vectorStoreProvider: "lancedb",
    openAiKey: "sk-test",
    ...input,
  }
}

describe("CodeIndexConfigManager", () => {
  test("uses default ollama base URL when omitted", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "ollama",
        openAiKey: undefined,
        ollamaBaseUrl: undefined,
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(true)
    expect(cfg.getConfig().ollamaOptions?.baseUrl).toBe("http://localhost:11434")
  })

  test("configures an OpenAI-compatible endpoint without an API key", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "openai-compatible",
        openAiKey: undefined,
        openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(true)
    expect(cfg.getConfig().openAiCompatibleOptions).toEqual({
      baseUrl: "http://localhost:1234/v1",
      apiKey: undefined,
    })
  })

  test("requires a base URL for an OpenAI-compatible endpoint", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "openai-compatible",
        openAiKey: undefined,
        openAiCompatibleApiKey: "sk-test",
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(false)
  })

  test("defaults vector store to LanceDB when omitted", () => {
    const cfg = new CodeIndexConfigManager(createInput({ vectorStoreProvider: undefined }))

    expect(cfg.getConfig().vectorStoreProvider).toBe("lancedb")
  })

  test("normalizes omitted vector store config to LanceDB for hosts", () => {
    expect(toIndexingConfigInput(undefined).vectorStoreProvider).toBe("lancedb")
  })

  test("preserves an explicit Qdrant override", () => {
    const input = toIndexingConfigInput({ vectorStore: "qdrant" })
    const cfg = new CodeIndexConfigManager(input)

    expect(input.vectorStoreProvider).toBe("qdrant")
    expect(cfg.getConfig().vectorStoreProvider).toBe("qdrant")
  })

  test("configures Kilo with hosted auth options and explicit model metadata", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "kilo",
        openAiKey: undefined,
        kiloApiKey: "kilo-token",
        kiloBaseUrl: "https://example.test/api/gateway/",
        kiloOrganizationId: "org_123",
        modelId: "mistralai/mistral-embed-2312",
        modelDimension: 1024,
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(true)
    expect(cfg.getConfig().kiloOptions).toEqual({
      apiKey: "kilo-token",
      baseUrl: "https://example.test/api/gateway/",
      organizationId: "org_123",
    })
    expect(cfg.currentModelId).toBe("mistralai/mistral-embed-2312")
    expect(cfg.currentModelDimension).toBe(1024)
  })

  test("requires Kilo model metadata from Cloud config", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "kilo",
        openAiKey: undefined,
        kiloApiKey: "kilo-token",
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(false)
    expect(cfg.currentModelId).toBeUndefined()
    expect(cfg.currentModelDimension).toBeUndefined()
  })

  test("uses configured dimension for Kilo models outside the fallback catalog", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "kilo",
        openAiKey: undefined,
        kiloApiKey: "kilo-token",
        modelId: "custom/model",
        modelDimension: 2048,
      }),
    )

    expect(cfg.currentModelId).toBe("custom/model")
    expect(cfg.currentModelDimension).toBe(2048)
  })

  test("uses configured dimension before static model metadata", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "openrouter",
        openAiKey: undefined,
        openRouterApiKey: "or-test",
        modelId: "google/gemini-embedding-2-preview",
        modelDimension: 1536,
      }),
    )

    expect(cfg.currentModelDimension).toBe(1536)
  })

  describe("loadConfiguration restart checks", () => {
    test("requires restart when model changes with same dimension", () => {
      const cfg = new CodeIndexConfigManager(createInput({ modelId: "text-embedding-3-small" }))

      const result = cfg.loadConfiguration(createInput({ modelId: "text-embedding-ada-002" }))

      expect(result.requiresRestart).toBe(true)
    })

    test("does not restart when default model is made explicit", () => {
      const cfg = new CodeIndexConfigManager(createInput())

      const result = cfg.loadConfiguration(createInput({ modelId: "text-embedding-3-small" }))

      expect(result.requiresRestart).toBe(false)
    })

    test("requires restart when provider changes with same dimension", () => {
      const cfg = new CodeIndexConfigManager(createInput({ modelId: "text-embedding-3-small" }))

      const result = cfg.loadConfiguration(
        createInput({
          embedderProvider: "vercel-ai-gateway",
          vercelAiGatewayApiKey: "kg-test",
          openAiKey: undefined,
          modelId: "text-embedding-3-small",
        }),
      )

      expect(result.requiresRestart).toBe(true)
    })

    test("requires restart when OpenAI-compatible auth is added or removed", () => {
      const input = createInput({
        embedderProvider: "openai-compatible",
        openAiKey: undefined,
        openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      })
      const cfg = new CodeIndexConfigManager(input)

      expect(cfg.loadConfiguration({ ...input, openAiCompatibleApiKey: "sk-test" }).requiresRestart).toBe(true)
      expect(cfg.loadConfiguration(input).requiresRestart).toBe(true)
      expect(cfg.loadConfiguration(input).requiresRestart).toBe(false)
    })

    test("requires restart when Kilo auth changes", () => {
      const cfg = new CodeIndexConfigManager(
        createInput({
          embedderProvider: "kilo",
          openAiKey: undefined,
          kiloApiKey: "old-token",
          modelId: "mistralai/mistral-embed-2312",
          modelDimension: 1024,
        }),
      )

      const result = cfg.loadConfiguration(
        createInput({
          embedderProvider: "kilo",
          openAiKey: undefined,
          kiloApiKey: "new-token",
          modelId: "mistralai/mistral-embed-2312",
          modelDimension: 1024,
        }),
      )

      expect(result.requiresRestart).toBe(true)
    })
  })
})
