import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { toIndexingConfigInput, type IndexingConfig } from "../../../src/config"
import { CacheManager } from "../../../src/indexing/cache-manager"
import { CodeIndexConfigManager } from "../../../src/indexing/config-manager"
import { CodeIndexServiceFactory } from "../../../src/indexing/service-factory"
import type { EmbedderProvider } from "../../../src/indexing/interfaces/manager"

function createFactory(manager: CodeIndexConfigManager) {
  const root = tmpdir()
  return new CodeIndexServiceFactory(manager, root, new CacheManager(root, root), root)
}

const endpoint = "http://localhost:1234/v1"
const kiloModel = { model: "custom/model", dimension: 1024 }

test.each([
  ["kilo", { ...kiloModel, kilo: { apiKey: "test" } }, kiloModel, "Kilo API key is required for embedding."],
  ["openai", { openai: { apiKey: "test" } }, { openai: { apiKey: "" } }, "OpenAI API key is required for embedding."],
  ["ollama", {}, { ollama: { baseUrl: "" } }, "Ollama base URL is required for embedding."],
  ["openai-compatible", { "openai-compatible": { baseUrl: endpoint } }, {}, "OpenAI-compatible base URL is required."],
  ["gemini", { gemini: { apiKey: "test" } }, {}, "Gemini API key is required for embedding."],
  ["mistral", { mistral: { apiKey: "test" } }, {}, "Mistral API key is required for embedding."],
  [
    "vercel-ai-gateway",
    { "vercel-ai-gateway": { apiKey: "test" } },
    {},
    "Vercel AI Gateway API key is required for embedding.",
  ],
  [
    "bedrock",
    { bedrock: { region: "us-east-1" } },
    { bedrock: { profile: "test" } },
    "Bedrock region is required for embedding.",
  ],
  ["openrouter", { openrouter: { apiKey: "test" } }, {}, "OpenRouter API key is required for embedding."],
  ["voyage", { voyage: { apiKey: "test" } }, {}, "Voyage API key is required for embedding."],
] satisfies [EmbedderProvider, IndexingConfig, IndexingConfig, string][])(
  "%s uses only the selected provider's connection settings",
  (provider, ready, incomplete, message) => {
    const configured = new CodeIndexConfigManager(toIndexingConfigInput({ provider, ...ready }))
    expect(configured.isFeatureEnabled).toBe(false)
    expect(configured.isConfigured()).toBe(true)
    expect(createFactory(configured).createEmbedder().embedderInfo).toEqual({ name: provider })

    const missing = new CodeIndexConfigManager(
      toIndexingConfigInput({ provider, openai: { apiKey: "inactive-key" }, ...incomplete }),
    )
    expect(missing.isConfigured()).toBe(false)
    expect(() => createFactory(missing).createEmbedder()).toThrow(new Error(message))
  },
)

test("requires Kilo's model before construction, but its dimension only for indexing readiness", () => {
  const config = { provider: "kilo", kilo: { apiKey: "test" } } satisfies IndexingConfig
  const manager = new CodeIndexConfigManager(toIndexingConfigInput(config))
  const factory = createFactory(manager)

  expect(manager.isConfigured()).toBe(false)
  expect(() => factory.createEmbedder()).toThrow(new Error("Kilo embedding model is required."))

  manager.loadConfiguration(toIndexingConfigInput({ ...config, model: "custom/model" }))

  expect(manager.isConfigured()).toBe(false)
  expect(factory.createEmbedder().embedderInfo).toEqual({ name: "kilo" })
})

test("defaults to OpenAI and LanceDB; an empty Qdrant URL only blocks readiness with Qdrant selected", () => {
  const config = { enabled: true, openai: { apiKey: "test" }, qdrant: { url: "" } } satisfies IndexingConfig
  const manager = new CodeIndexConfigManager(toIndexingConfigInput(config))

  expect(manager.getConfig().vectorStoreProvider).toBe("lancedb")
  expect(manager.isConfigured()).toBe(true)
  expect(manager.currentModelDimension).toBe(1536)
  expect(createFactory(manager).createEmbedder().embedderInfo).toEqual({ name: "openai" })

  manager.loadConfiguration(toIndexingConfigInput({ ...config, vectorStore: "qdrant" }))
  expect(manager.isConfigured()).toBe(false)
  expect(createFactory(manager).createEmbedder().embedderInfo).toEqual({ name: "openai" })

  manager.loadConfiguration(toIndexingConfigInput({ ...config, vectorStore: "qdrant", qdrant: undefined }))
  expect(manager.qdrantConfig.url).toBe("http://localhost:6333")
  expect(manager.isConfigured()).toBe(true)
})

test("retains inactive connection options without injecting defaults for inactive providers", () => {
  const config = {
    enabled: true,
    openai: { apiKey: "test" },
    "openai-compatible": { baseUrl: endpoint, apiKey: "  compatible-key  " },
    bedrock: { region: "us-east-1", profile: "workspace" },
    openrouter: { apiKey: "router-key", specificProvider: "example" },
    qdrant: { url: "http://localhost:6334", apiKey: "qdrant-key" },
  } satisfies IndexingConfig
  const manager = new CodeIndexConfigManager(toIndexingConfigInput(config))

  expect(manager.getConfig()).toMatchObject({
    openAiCompatibleOptions: { baseUrl: endpoint, apiKey: "compatible-key" },
    bedrockOptions: { region: "us-east-1", profile: "workspace" },
    openRouterOptions: { apiKey: "router-key", specificProvider: "example" },
    qdrantUrl: "http://localhost:6334",
    qdrantApiKey: "qdrant-key",
  })
  expect(manager.getConfig().ollamaOptions).toBeUndefined()

  manager.loadConfiguration(toIndexingConfigInput({ ...config, provider: "ollama" }))
  expect(manager.getConfig().ollamaOptions?.baseUrl).toBe("http://localhost:11434")
})

test.each(["unknown", "constructor", "__proto__"])("rejects unsupported provider %s", (provider) => {
  // Exercise a direct caller bypassing the host schema, including inherited object keys.
  const manager = new CodeIndexConfigManager({
    ...toIndexingConfigInput(undefined),
    embedderProvider: provider as EmbedderProvider,
  })

  expect(manager.isConfigured()).toBe(false)
  expect(() => createFactory(manager).createEmbedder()).toThrow(new Error(`Unsupported embedder provider: ${provider}`))
})
