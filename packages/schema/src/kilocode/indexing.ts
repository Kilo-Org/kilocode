export * as KiloIndexingRpc from "./indexing.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

// The `kilocode.indexing` RPC contract: codebase indexing status, warnings and machine-local consent of a location,
// and the `indexing` key of its global and project config files. The indexing plugin in packages/kilo-plugin registers
// the handlers; clients import this contract from `@opencode/schema/kilocode/indexing`. The Kilo embedding models
// come from the `models.embeddings` method of `kilocode.gateway`.
const portable = Schema.toStandardSchemaV1

export const States = ["Disabled", "In Progress", "Complete", "Error", "Standby"] as const
export const State = Schema.Literals(States).annotate({ identifier: "IndexingStatusState" })
export type State = typeof State.Type

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Status = Schema.Struct({
  state: State,
  message: Schema.String,
  processedFiles: Count,
  totalFiles: Count,
  percent: Count.check(Schema.isLessThanOrEqualTo(100)),
}).annotate({ identifier: "IndexingStatus" })
export type Status = typeof Status.Type

export const WarningCodes = ["qdrant.version-incompatible", "qdrant.version-unavailable"] as const
export const Warning = Schema.Struct({
  code: Schema.Literals(WarningCodes),
  message: Schema.String,
}).annotate({ identifier: "IndexingWarning" })
export type Warning = typeof Warning.Type

export const Consent = Schema.Struct({
  enabled: Schema.Boolean,
})

const Providers = [
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
] as const
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const Score = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))
const options = <F extends Schema.Struct.Fields>(fields: F, description: string) =>
  Schema.optional(Schema.Struct(fields)).annotate({ description })
const key = { apiKey: Schema.optional(Schema.String) }

/** The `indexing` config key. */
export const Config = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "Enable codebase indexing" }),
  provider: Schema.optional(Schema.Literals(Providers)).annotate({
    description: "Embedding provider to use for codebase indexing",
  }),
  model: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description: "Embedding model ID (uses provider default if omitted)",
  }),
  dimension: Schema.optional(Schema.NullOr(PositiveInt)).annotate({
    description: "Override embedding vector dimension (auto-detected from model if omitted)",
  }),
  vectorStore: Schema.optional(Schema.Literals(["lancedb", "qdrant"])).annotate({
    description: "Vector store backend (default: lancedb)",
  }),
  kilo: options(
    {
      apiKey: Schema.optional(Schema.String),
      baseUrl: Schema.optional(Schema.String),
      organizationId: Schema.optional(Schema.String),
    },
    "Kilo-hosted embedding provider options",
  ),
  openai: options(key, "OpenAI embedding provider options"),
  ollama: options({ baseUrl: Schema.optional(Schema.String) }, "Ollama embedding provider options"),
  "openai-compatible": options(
    { baseUrl: Schema.optional(Schema.String), apiKey: Schema.optional(Schema.String) },
    "OpenAI-compatible embedding provider options",
  ),
  gemini: options(key, "Gemini embedding provider options"),
  mistral: options(key, "Mistral embedding provider options"),
  "vercel-ai-gateway": options(key, "Vercel AI Gateway embedding provider options"),
  bedrock: options(
    { region: Schema.optional(Schema.String), profile: Schema.optional(Schema.String) },
    "AWS Bedrock embedding provider options",
  ),
  openrouter: options(
    { apiKey: Schema.optional(Schema.String), specificProvider: Schema.optional(Schema.String) },
    "OpenRouter embedding provider options",
  ),
  voyage: options(key, "Voyage embedding provider options"),
  qdrant: options(
    { url: Schema.optional(Schema.String), apiKey: Schema.optional(Schema.String) },
    "Qdrant vector store connection options",
  ),
  lancedb: options({ directory: Schema.optional(Schema.String) }, "LanceDB vector store options"),
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
  fileExtensions: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isPattern(/^\s*\.?[A-Za-z0-9][A-Za-z0-9_+-]*\s*$/))).check(
      Schema.isMinLength(1),
    ),
  ).annotate({
    description: "File extension allowlist for codebase indexing (uses built-in defaults if omitted)",
  }),
}).annotate({ identifier: "IndexingConfig", description: "Codebase indexing configuration" })
export type Config = typeof Config.Type

export const Scope = Schema.Literals(["global", "project"])
export type Scope = typeof Scope.Type

export const Settings = Schema.Struct({
  /** The `indexing` key of the global config file, `{}` when it has none. */
  global: Config,
  /** The `indexing` key of the project config file of the location, `{}` when it has none. */
  project: Config,
  /** True when Kilo credentials are available, so the `kilo` embedding provider can be used. */
  kilo: Schema.Boolean,
})
export type Settings = typeof Settings.Type

export const Update = Schema.Struct({
  scope: Scope,
  /** The new `indexing` key of that file. An empty object removes the key. */
  config: Config,
})

export const Definition = Rpc.define({
  id: "kilocode.indexing",
  methods: {
    /** The current indexing status of the location. */
    status: {
      input: portable(Schema.Struct({})),
      output: portable(Status),
    },
    /** The vector store warnings reported since indexing started for the location. */
    warnings: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(Warning)),
    },
    /**
     * Machine-local consent for the project of the location. Only a server started by VS Code (`KILO_PLATFORM=vscode`)
     * gates indexing on it; elsewhere the call only answers the status.
     */
    consent: {
      input: portable(Consent),
      output: portable(Status),
    },
    /** The `indexing` key of the global and project config files, for a settings editor. */
    config: {
      input: portable(Schema.Struct({})),
      output: portable(Settings),
    },
    /** Replace the `indexing` key of the global or project config file. Indexing restarts with the new settings. */
    "config.update": {
      input: portable(Update),
      output: portable(Schema.Struct({})),
      errors: { write_failed: portable(Schema.Undefined) },
    },
  },
  events: {
    /** The indexing status of the location changed. */
    status: { schema: portable(Schema.Struct({ status: Status })) },
    /** A new vector store warning. */
    warning: { schema: portable(Warning) },
  },
})
