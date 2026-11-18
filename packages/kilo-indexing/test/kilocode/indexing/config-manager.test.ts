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
    const disabled = { enabled: false }
    const incomplete = { openAiKey: undefined }
    const ready = {}

    test.each([
      ["enabling configured indexing", disabled, ready, true],
      ["enabling unconfigured indexing", { ...disabled, ...incomplete }, incomplete, false],
      ["completing configuration while enabled", incomplete, ready, true],
      ["losing configuration while enabled", ready, incomplete, true],
      ["disabling configured indexing", ready, disabled, true],
      ["disabling unconfigured indexing", incomplete, { ...disabled, ...incomplete }, true],
      ["changes while disabled", disabled, { ...disabled, openAiKey: "new-key" }, false],
      ["changes while enabled but still unconfigured", incomplete, { ...incomplete, modelId: "new-model" }, false],
    ] satisfies [string, Partial<IndexingConfigInput>, Partial<IndexingConfigInput>, boolean][])(
      "handles %s",
      (_name, before, after, requiresRestart) => {
        const cfg = new CodeIndexConfigManager(createInput(before))
        expect(cfg.loadConfiguration(createInput(after)).requiresRestart).toBe(requiresRestart)
      },
    )

    test.each([
      ["Kilo key", {}, { kiloApiKey: "kilo-test" }],
      ["Kilo base URL", { kiloApiKey: "kilo-test" }, { kiloBaseUrl: "https://example.test" }],
      ["Kilo organization", { kiloApiKey: "kilo-test" }, { kiloOrganizationId: "test-org" }],
      ["OpenAI key", {}, { openAiKey: "new-key" }],
      ["Ollama URL", {}, { ollamaBaseUrl: "http://localhost:11434" }],
      ["OpenAI-compatible URL", {}, { openAiCompatibleBaseUrl: "http://localhost:1234/v1" }],
      ["Gemini key", {}, { geminiApiKey: "gemini-test" }],
      ["Mistral key", {}, { mistralApiKey: "mistral-test" }],
      ["Vercel AI Gateway key", {}, { vercelAiGatewayApiKey: "gateway-test" }],
      ["Bedrock region", {}, { bedrockRegion: "us-east-1" }],
      ["Bedrock profile", { bedrockRegion: "us-east-1" }, { bedrockProfile: "test-profile" }],
      ["OpenRouter key", {}, { openRouterApiKey: "openrouter-test" }],
      ["OpenRouter provider", { openRouterApiKey: "openrouter-test" }, { openRouterSpecificProvider: "test-provider" }],
      ["Voyage key", {}, { voyageApiKey: "voyage-test" }],
      ["vector store provider", {}, { vectorStoreProvider: "qdrant" }],
      ["LanceDB path", {}, { lancedbVectorStoreDirectory: "index" }],
      ["Qdrant URL even with LanceDB active", {}, { qdrantUrl: "http://localhost:6334" }],
      ["Qdrant key even with LanceDB active", {}, { qdrantApiKey: "qdrant-test" }],
    ] satisfies [string, Partial<IndexingConfigInput>, Partial<IndexingConfigInput>][])(
      "restarts when %s changes",
      (_name, before, change) => {
        const input = createInput(before)
        const cfg = new CodeIndexConfigManager(input)
        expect(cfg.loadConfiguration({ ...input, ...change }).requiresRestart).toBe(true)
      },
    )

    test.each([
      [
        "explicit store defaults",
        { vectorStoreProvider: undefined },
        { vectorStoreProvider: "lancedb", qdrantUrl: "http://localhost:6333" },
      ],
      ["explicit Ollama URL default", { embedderProvider: "ollama" }, { ollamaBaseUrl: "http://localhost:11434" }],
      ["empty optional strings", {}, { lancedbVectorStoreDirectory: "", qdrantApiKey: "" }],
      ["LanceDB path with Qdrant active", { vectorStoreProvider: "qdrant" }, { lancedbVectorStoreDirectory: "index" }],
      [
        "search and scanner tuning",
        {},
        { searchMinScore: 0.5, searchMaxResults: 12, embeddingBatchSize: 4, scannerMaxBatchRetries: 2 },
      ],
      ["explicit registered dimension", {}, { modelDimension: 1536 }],
      ["invalid dimension falling back to the registry", {}, { modelDimension: -1 }],
      ["same model when only the new profile resolves", { modelId: "custom-model" }, { modelDimension: 2048 }],
      [
        "same model when only the old profile resolves",
        { modelId: "custom-model", modelDimension: 2048 },
        { modelDimension: undefined },
      ],
    ] satisfies [string, Partial<IndexingConfigInput>, Partial<IndexingConfigInput>][])(
      "does not restart for %s",
      (_name, before, change) => {
        const input = createInput(before)
        const cfg = new CodeIndexConfigManager(input)
        expect(cfg.loadConfiguration({ ...input, ...change }).requiresRestart).toBe(false)
      },
    )

    test("restarts when the resolved dimension changes for the same model", () => {
      const cfg = new CodeIndexConfigManager(createInput())

      expect(cfg.loadConfiguration(createInput({ modelDimension: 1024 })).requiresRestart).toBe(true)
    })

    test("restarts when the model ID changes and neither profile resolves", () => {
      const cfg = new CodeIndexConfigManager(createInput({ modelId: "custom-model" }))

      expect(cfg.loadConfiguration(createInput({ modelId: "other-custom-model" })).requiresRestart).toBe(true)
    })

    test("defaults a missing previous store provider to LanceDB, but not a missing Qdrant URL", () => {
      const cfg = new CodeIndexConfigManager(createInput())
      const previous = {
        enabled: true,
        configured: true,
        embedderProvider: "openai" as const,
        openAiKey: "sk-test",
        fileExtensions: cfg.getConfig().fileExtensions,
      }

      expect(cfg.doesConfigChangeRequireRestart({ ...previous, qdrantUrl: "http://localhost:6333" })).toBe(false)
      expect(cfg.doesConfigChangeRequireRestart(previous)).toBe(true)
    })

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
      const input = createInput({ modelId: "text-embedding-3-small", vercelAiGatewayApiKey: "kg-test" })
      const cfg = new CodeIndexConfigManager(input)

      const result = cfg.loadConfiguration({ ...input, embedderProvider: "vercel-ai-gateway" })

      expect(result.requiresRestart).toBe(true)
    })

    test("requires restart when OpenAI-compatible auth is added or removed", () => {
      const input = createInput({
        embedderProvider: "openai-compatible",
        openAiKey: undefined,
        openAiCompatibleBaseUrl: "http://localhost:1234/v1",
      })
      const cfg = new CodeIndexConfigManager(input)

      expect(cfg.loadConfiguration({ ...input, openAiCompatibleApiKey: "  " }).requiresRestart).toBe(false)
      expect(cfg.loadConfiguration({ ...input, openAiCompatibleApiKey: "sk-test" }).requiresRestart).toBe(true)
      expect(cfg.loadConfiguration({ ...input, openAiCompatibleApiKey: " sk-test " }).requiresRestart).toBe(false)
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

    test("restarts only when the normalized file extension allowlist changes", () => {
      const cfg = new CodeIndexConfigManager(createInput({ fileExtensions: ["php", ".JS"] }))

      expect(cfg.getConfig().fileExtensions).toEqual([".js", ".php"])
      expect(cfg.loadConfiguration(createInput({ fileExtensions: [".js", ".PHP", "php"] })).requiresRestart).toBe(false)
      expect(cfg.loadConfiguration(createInput({ fileExtensions: [".css"] })).requiresRestart).toBe(true)
    })
  })
})
