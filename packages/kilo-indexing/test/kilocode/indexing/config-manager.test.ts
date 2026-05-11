import { describe, expect, test } from "bun:test"
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

  test("defaults vector store to qdrant when omitted", () => {
    const cfg = new CodeIndexConfigManager(createInput({ vectorStoreProvider: undefined }))

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
