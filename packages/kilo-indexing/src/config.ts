import { Schema } from "effect"
import z from "zod"
import type { IndexingConfigInput } from "./indexing/config-manager"
import { DEFAULT_VECTOR_STORE } from "./indexing/constants"
import type { EmbedderProvider } from "./indexing/interfaces/manager"

export { DEFAULT_VECTOR_STORE } from "./indexing/constants"

const providers = [
  "kilo",
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
const stores = ["lancedb", "qdrant", "valkey"] as const

export const IndexingConfig = z
  .object({
    enabled: z.boolean().optional().describe("Enable codebase indexing"),
    provider: z.enum(providers).optional().describe("Embedding provider to use for codebase indexing"),
    model: z.string().nullable().optional().describe("Embedding model ID (uses provider default if omitted)"),
    dimension: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe("Override embedding vector dimension (auto-detected from model if omitted)"),
    vectorStore: z.enum(stores).optional().describe("Vector store backend (default: lancedb)"),
    kilo: z
      .object({
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        organizationId: z.string().optional(),
      })
      .strict()
      .optional()
      .describe("Kilo-hosted embedding provider options"),
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
    valkey: z
      .object({
        url: z.string().optional(),
        password: z.string().optional(),
      })
      .strict()
      .optional()
      .describe("Valkey vector store connection options"),
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

const Provider = Schema.Literals(providers)
const Store = Schema.Literals(stores)
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const Score = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))

export const IndexingSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "Enable codebase indexing" }),
  provider: Schema.optional(Provider).annotate({
    description: "Embedding provider to use for codebase indexing",
  }),
  model: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Embedding model ID (uses provider default if omitted)",
  }),
  dimension: Schema.optional(Schema.NullOr(PositiveInt)).annotate({
    description: "Override embedding vector dimension (auto-detected from model if omitted)",
  }),
  vectorStore: Schema.optional(Store).annotate({ description: "Vector store backend (default: lancedb)" }),
  kilo: Schema.optional(
    Schema.Struct({
      apiKey: Schema.optional(Schema.String),
      baseUrl: Schema.optional(Schema.String),
      organizationId: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Kilo-hosted embedding provider options" }),
  openai: Schema.optional(
    Schema.Struct({
      apiKey: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "OpenAI embedding provider options" }),
  ollama: Schema.optional(
    Schema.Struct({
      baseUrl: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Ollama embedding provider options" }),
  "openai-compatible": Schema.optional(
    Schema.Struct({
      baseUrl: Schema.optional(Schema.String),
      apiKey: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "OpenAI-compatible embedding provider options" }),
  gemini: Schema.optional(
    Schema.Struct({
      apiKey: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Gemini embedding provider options" }),
  mistral: Schema.optional(
    Schema.Struct({
      apiKey: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Mistral embedding provider options" }),
  "vercel-ai-gateway": Schema.optional(
    Schema.Struct({
      apiKey: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Vercel AI Gateway embedding provider options" }),
  bedrock: Schema.optional(
    Schema.Struct({
      region: Schema.optional(Schema.String),
      profile: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "AWS Bedrock embedding provider options" }),
  openrouter: Schema.optional(
    Schema.Struct({
      apiKey: Schema.optional(Schema.String),
      specificProvider: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "OpenRouter embedding provider options" }),
  voyage: Schema.optional(
    Schema.Struct({
      apiKey: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Voyage embedding provider options" }),
  qdrant: Schema.optional(
    Schema.Struct({
      url: Schema.optional(Schema.String),
      apiKey: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Qdrant vector store connection options" }),
  lancedb: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "LanceDB vector store options" }),
  valkey: Schema.optional(
    Schema.Struct({
      url: Schema.optional(Schema.String),
      password: Schema.optional(Schema.String),
    }),
  ).annotate({ description: "Valkey vector store connection options" }),
  searchMinScore: Schema.optional(Score).annotate({
    description: "Minimum similarity score for search results (default: 0.4)",
  }),
  searchMaxResults: Schema.optional(PositiveInt).annotate({
    description: "Maximum number of search results (default: 50)",
  }),
  embeddingBatchSize: Schema.optional(PositiveInt).annotate({
    description: "Number of code segments per embedding batch (default: 60)",
  }),
  scannerMaxBatchRetries: Schema.optional(PositiveInt).annotate({
    description: "Maximum retry attempts for failed embedding batches (default: 3)",
  }),
}).annotate({
  identifier: "IndexingConfig",
  description: "Codebase indexing configuration",
})

export function toIndexingConfigInput(cfg: IndexingConfig | undefined): IndexingConfigInput {
  const provider = cfg?.provider ?? "openai"

  return {
    enabled: cfg?.enabled ?? false,
    embedderProvider: provider,
    vectorStoreProvider: cfg?.vectorStore ?? DEFAULT_VECTOR_STORE,
    modelId: cfg?.model ?? undefined,
    modelDimension: cfg?.dimension ?? undefined,
    lancedbVectorStoreDirectory: cfg?.lancedb?.directory,
    qdrantUrl: cfg?.qdrant?.url,
    qdrantApiKey: cfg?.qdrant?.apiKey,
    valkeyUrl: cfg?.valkey?.url,
    valkeyPassword: cfg?.valkey?.password,
    searchMinScore: cfg?.searchMinScore,
    searchMaxResults: cfg?.searchMaxResults,
    embeddingBatchSize: cfg?.embeddingBatchSize,
    scannerMaxBatchRetries: cfg?.scannerMaxBatchRetries,
    kiloApiKey: cfg?.kilo?.apiKey,
    kiloBaseUrl: cfg?.kilo?.baseUrl,
    kiloOrganizationId: cfg?.kilo?.organizationId,
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
