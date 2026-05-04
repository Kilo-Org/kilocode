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

  test("configures Kilo with hosted auth options", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "kilo",
        openAiKey: undefined,
        kiloApiKey: "kilo-token",
        kiloBaseUrl: "https://example.test/api/gateway/",
        kiloOrganizationId: "org_123",
      }),
    )

    expect(cfg.isFeatureConfigured).toBe(true)
    expect(cfg.getConfig().kiloOptions).toEqual({
      apiKey: "kilo-token",
      baseUrl: "https://example.test/api/gateway/",
      organizationId: "org_123",
    })
    expect(cfg.currentModelId).toBeUndefined()
    expect(cfg.currentModelDimension).toBe(1536)
  })

  test("normalizes bare OpenAI model IDs for Kilo", () => {
    const cfg = new CodeIndexConfigManager(
      createInput({
        embedderProvider: "kilo",
        openAiKey: undefined,
        kiloApiKey: "kilo-token",
        modelId: "text-embedding-3-small",
      }),
    )

    expect(cfg.currentModelId).toBe("openai/text-embedding-3-small")
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

    test("requires restart when Kilo auth changes", () => {
      const cfg = new CodeIndexConfigManager(
        createInput({ embedderProvider: "kilo", openAiKey: undefined, kiloApiKey: "old-token" }),
      )

      const result = cfg.loadConfiguration(
        createInput({ embedderProvider: "kilo", openAiKey: undefined, kiloApiKey: "new-token" }),
      )

      expect(result.requiresRestart).toBe(true)
    })
  })
})
