import { describe, expect, test } from "bun:test"
import {
  IndexingConfig,
  normalizeFileExtensions,
  parseFileExtensions,
  toIndexingConfigInput,
} from "../../../src/config"
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

  test("preserves an explicit Milvus override", () => {
    const input = toIndexingConfigInput({
      vectorStore: "milvus",
      milvus: {
        address: "https://cluster.example.com",
        token: "token",
        database: "code",
      },
    })
    const cfg = new CodeIndexConfigManager(input)

    expect(input.vectorStoreProvider).toBe("milvus")
    expect(input.milvusAddress).toBe("https://cluster.example.com")
    expect(cfg.getConfig().vectorStoreProvider).toBe("milvus")
    expect(cfg.getConfig().milvusAddress).toBe("https://cluster.example.com")
    expect(cfg.getConfig().milvusToken).toBe("token")
    expect(cfg.getConfig().milvusDatabase).toBe("code")
  })

  test("uses the default Milvus address when omitted", () => {
    const cfg = new CodeIndexConfigManager(createInput({ vectorStoreProvider: "milvus" }))

    expect(cfg.isFeatureConfigured).toBe(true)
    expect(cfg.getConfig().milvusAddress).toBe("localhost:19530")
  })

  test("normalizes configured file extensions", () => {
    expect(normalizeFileExtensions([" PHP ", ".JS", "js", "css"])).toEqual([".css", ".js", ".php"])
    expect(parseFileExtensions(" PHP, .JS, js, css ")).toEqual([".css", ".js", ".php"])
    expect(parseFileExtensions("  ")).toBeUndefined()
    expect(toIndexingConfigInput({ fileExtensions: ["PHP", ".JS"] }).fileExtensions).toEqual([".js", ".php"])
    expect(normalizeFileExtensions(["", "  "])).toBeUndefined()
    expect(
      normalizeFileExtensions(Array.from({ length: 10_000 }, (_, index) => (index % 2 ? " PHP " : ".JS"))),
    ).toEqual([".js", ".php"])
  })

  test("validates file extension tokens", () => {
    expect(IndexingConfig.safeParse({ fileExtensions: ["php", " .JS "] }).success).toBe(true)
    expect(IndexingConfig.safeParse({ fileExtensions: [] }).success).toBe(false)
    expect(IndexingConfig.safeParse({ fileExtensions: ["*.js"] }).success).toBe(false)
    expect(IndexingConfig.safeParse({ fileExtensions: ["src/php"] }).success).toBe(false)
    expect(IndexingConfig.safeParse({ fileExtensions: [".d.ts"] }).success).toBe(false)
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

    test("requires restart when Milvus connection settings change", () => {
      const input = createInput({
        vectorStoreProvider: "milvus",
        milvusAddress: "localhost:19530",
        milvusToken: "old-token",
      })
      const cfg = new CodeIndexConfigManager(input)

      expect(cfg.loadConfiguration({ ...input, milvusAddress: "localhost:19531" }).requiresRestart).toBe(true)
      expect(cfg.loadConfiguration({ ...input, milvusToken: "new-token" }).requiresRestart).toBe(true)
      expect(cfg.loadConfiguration({ ...input, milvusDatabase: "code" }).requiresRestart).toBe(true)
      expect(cfg.loadConfiguration({ ...input, milvusDatabase: "code" }).requiresRestart).toBe(false)
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

    test("restarts only when the normalized file extension allowlist changes", () => {
      const cfg = new CodeIndexConfigManager(createInput({ fileExtensions: ["php", ".JS"] }))

      expect(cfg.getConfig().fileExtensions).toEqual([".js", ".php"])
      expect(cfg.loadConfiguration(createInput({ fileExtensions: [".js", ".PHP", "php"] })).requiresRestart).toBe(false)
      expect(cfg.loadConfiguration(createInput({ fileExtensions: [".css"] })).requiresRestart).toBe(true)
    })
  })
})
