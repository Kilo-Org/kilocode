import z from "zod"
import type { IndexingConfigInput } from "./indexing/config-manager"
import type { EmbedderProvider } from "./indexing/interfaces/manager"

const providers = [
  "openai",
  "ollama",
  "openai-compatible",
  "gemini",
  "mistral",
  "vercel-ai-gateway",
  "bedrock",
  "openrouter",
  "voyage",
] as const satisfies readonly EmbedderProvider[]

export const IndexingConfig = z
  .object({
    enabled: z.boolean().optional().describe("Enable codebase indexing"),
    provider: z.enum(providers).optional().describe("Embedding provider to use for codebase indexing"),
    model: z.string().optional().describe("Embedding model ID (uses provider default if omitted)"),
    dimension: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Override embedding vector dimension (auto-detected from model if omitted)"),
    vectorStore: z.enum(["lancedb", "qdrant"]).optional().describe("Vector store backend (default: qdrant)"),
    openai: z
      .object({ apiKey: z.string().optional() })
      .strict()
      .optional()
      .describe("OpenAI embedding provider options"),
    ollama: z
      .object({ baseUrl: z.string().optional() })
      .strict()
      .optional()
      .describe("Ollama embedding provider options"),
    "openai-compatible": z
      .object({
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
      })
      .strict()
      .optional()
      .describe("OpenAI-compatible embedding provider options"),
    gemini: z
      .object({ apiKey: z.string().optional() })
      .strict()
      .optional()
      .describe("Gemini embedding provider options"),
    mistral: z
      .object({ apiKey: z.string().optional() })
      .strict()
      .optional()
      .describe("Mistral embedding provider options"),
    "vercel-ai-gateway": z
      .object({ apiKey: z.string().optional() })
      .strict()
      .optional()
      .describe("Vercel AI Gateway embedding provider options"),
    bedrock: z
      .object({
        region: z.string().optional(),
        profile: z.string().optional(),
      })
      .strict()
      .optional()
      .describe("AWS Bedrock embedding provider options"),
    openrouter: z
      .object({
        apiKey: z.string().optional(),
        specificProvider: z.string().optional(),
      })
      .strict()
      .optional()
      .describe("OpenRouter embedding provider options"),
    voyage: z
      .object({ apiKey: z.string().optional() })
      .strict()
      .optional()
      .describe("Voyage embedding provider options"),
    qdrant: z
      .object({
        url: z.string().optional(),
        apiKey: z.string().optional(),
      })
      .strict()
      .optional()
      .describe("Qdrant vector store connection options"),
    lancedb: z
      .object({ directory: z.string().optional() })
      .strict()
      .optional()
      .describe("LanceDB vector store options"),
    searchMinScore: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Minimum similarity score for search results (default: 0.4)"),
    searchMaxResults: z.number().int().positive().optional().describe("Maximum number of search results (default: 50)"),
    embeddingBatchSize: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Number of code segments per embedding batch (default: 60)"),
    scannerMaxBatchRetries: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum retry attempts for failed embedding batches (default: 3)"),
  })
  .strict()
  .meta({ ref: "IndexingConfig" })

export type IndexingConfig = z.infer<typeof IndexingConfig>

export function toIndexingConfigInput(cfg: IndexingConfig | undefined): IndexingConfigInput {
  const provider = cfg?.provider ?? "openai"

  return {
    enabled: cfg?.enabled ?? false,
    embedderProvider: provider,
    vectorStoreProvider: cfg?.vectorStore,
    modelId: cfg?.model,
    modelDimension: cfg?.dimension,
    lancedbVectorStoreDirectory: cfg?.lancedb?.directory,
    qdrantUrl: cfg?.qdrant?.url,
    qdrantApiKey: cfg?.qdrant?.apiKey,
    searchMinScore: cfg?.searchMinScore,
    searchMaxResults: cfg?.searchMaxResults,
    embeddingBatchSize: cfg?.embeddingBatchSize,
    scannerMaxBatchRetries: cfg?.scannerMaxBatchRetries,
    openAiKey: cfg?.openai?.apiKey,
    ollamaBaseUrl: cfg?.ollama?.baseUrl,
    openAiCompatibleBaseUrl: cfg?.["openai-compatible"]?.baseUrl,
    openAiCompatibleApiKey: cfg?.["openai-compatible"]?.apiKey,
    geminiApiKey: cfg?.gemini?.apiKey,
    mistralApiKey: cfg?.mistral?.apiKey,
    vercelAiGatewayApiKey: cfg?.["vercel-ai-gateway"]?.apiKey,
    bedrockRegion: cfg?.bedrock?.region,
    bedrockProfile: cfg?.bedrock?.profile,
    openRouterApiKey: cfg?.openrouter?.apiKey,
    openRouterSpecificProvider: cfg?.openrouter?.specificProvider,
    voyageApiKey: cfg?.voyage?.apiKey,
  }
}
