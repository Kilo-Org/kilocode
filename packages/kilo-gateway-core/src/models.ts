export * as KiloModels from "./models.js"

import { Effect, Option, Schedule, Schema } from "effect"
import { EmbeddingCatalog } from "./embedding-catalog.js"
import { KiloHeaders } from "./headers.js"
import { json, request } from "./http.js"
import { KiloServer } from "./server.js"

const TIMEOUT_MS = 10_000

const AISDKProvider = Schema.Literals(["anthropic", "openai", "openai-compatible", "openrouter"])
export type AISDKProvider = typeof AISDKProvider.Type
const decodeAISDKProvider = Schema.decodeUnknownOption(AISDKProvider)

const AutoRouting = Schema.Struct({
  models: Schema.Array(Schema.String),
})
const decodeAutoRouting = Schema.decodeUnknownOption(AutoRouting)

const TerminalBench = Schema.Struct({
  overallScore: Schema.Finite,
  avgAttemptCostUsd: Schema.Finite,
})
const decodeTerminalBench = Schema.decodeUnknownOption(TerminalBench)

// Same shape as `reasoning_options` in models.dev (`packages/core/src/models-dev.ts`).
const ReasoningOption = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("effort"),
    values: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  }),
  Schema.Struct({ type: Schema.Literal("toggle") }),
  Schema.Struct({
    type: Schema.Literal("budget_tokens"),
    min: Schema.optionalKey(Schema.Finite),
    max: Schema.optionalKey(Schema.Finite),
  }),
])
const decodeReasoningOption = Schema.decodeUnknownOption(ReasoningOption)

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

const RawModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  context_length: PositiveInt,
  max_completion_tokens: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  top_provider: Schema.optionalKey(
    Schema.Struct({
      max_completion_tokens: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
    }),
  ),
  pricing: Schema.optionalKey(
    Schema.Struct({
      prompt: Schema.optionalKey(Schema.NullOr(Schema.String)),
      completion: Schema.optionalKey(Schema.NullOr(Schema.String)),
      input_cache_write: Schema.optionalKey(Schema.NullOr(Schema.String)),
      input_cache_read: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
  architecture: Schema.optionalKey(
    Schema.Struct({
      input_modalities: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
      output_modalities: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
      tokenizer: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
  supported_parameters: Schema.optionalKey(Schema.Array(Schema.String)),
  preferredIndex: Schema.optionalKey(Schema.Finite),
  isFree: Schema.optionalKey(Schema.Boolean),
  mayTrainOnYourPrompts: Schema.optionalKey(Schema.Boolean),
  hasUserByokAvailable: Schema.optionalKey(Schema.Boolean),
  autoRouting: Schema.optionalKey(Schema.Unknown),
  terminalBench: Schema.optionalKey(Schema.Unknown),
  opencode: Schema.optionalKey(
    Schema.Struct({
      family: Schema.optionalKey(Schema.NullOr(Schema.String)),
      reasoning_options: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
      ai_sdk_provider: Schema.optionalKey(Schema.Unknown),
    }),
  ),
})

export const CatalogEnvelope = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
})

type RawModel = typeof RawModel.Type
const decodeEnvelope = Schema.decodeUnknownOption(CatalogEnvelope)
const decodeRawModel = Schema.decodeUnknownOption(RawModel)

export interface Cost {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

export type ReasoningOption =
  | { readonly type: "effort"; readonly values?: readonly string[] }
  | { readonly type: "toggle" }
  | { readonly type: "budget_tokens"; readonly min?: number; readonly max?: number }

export interface Model {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly family?: string
  readonly aiSDKProvider?: AISDKProvider
  readonly free: boolean
  readonly recommendedIndex?: number
  readonly hasUserByokAvailable?: boolean
  readonly mayTrainOnYourPrompts?: boolean
  readonly autoRouting?: { readonly models: readonly string[] }
  readonly terminalBench?: { readonly overallScore: number; readonly avgAttemptCostUsd: number }
  readonly reasoning: boolean
  readonly temperature: boolean
  readonly attachment: boolean
  readonly limit: { readonly context: number; readonly output: number }
  readonly cost?: Cost
  readonly capabilities: {
    readonly tools: true
    readonly input: readonly ("text" | "audio" | "image" | "video" | "pdf")[]
    readonly output: readonly ("text" | "audio" | "image" | "video" | "pdf")[]
  }
  readonly reasoningOptions?: readonly ReasoningOption[]
}

export interface Entry {
  readonly id: string
  readonly name: string
  readonly isFree: boolean
  readonly recommendedIndex?: number
  readonly hasUserByokAvailable?: boolean
  readonly mayTrainOnYourPrompts?: boolean
  readonly autoRouting?: { readonly models: readonly string[] }
  readonly terminalBench?: { readonly overallScore: number; readonly avgAttemptCostUsd: number }
  readonly description?: string
  readonly reasoning?: boolean
  readonly family?: string
  readonly aiSDKProvider?: AISDKProvider
}

export interface ImageModel {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface TranscriptionModel {
  readonly id: string
  readonly name: string
}

const TranscriptionCatalog = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
  ),
})
const decodeTranscriptionCatalog = Schema.decodeUnknownOption(TranscriptionCatalog)

export { EmbeddingCatalog } from "./embedding-catalog.js"
const decodeEmbeddingCatalog = Schema.decodeUnknownOption(EmbeddingCatalog)

export interface Failure {
  readonly kind: "unauthorized" | "network" | "schema" | "http" | "organization_missing"
  readonly status?: number
  readonly retryAfter?: number
}

export interface Scope {
  readonly server: string
  readonly token?: string
  readonly organizationID?: string | null
  readonly version?: string
}

export interface Result {
  readonly models: readonly Model[]
  readonly anonymous: boolean
}

// Fetches and validates the Gateway model catalog for the given scope.
// - Team scope (`organizationID` set): reads `${aiGatewayBase}/organizations/{id}/models` (or `/api/organizations/{id}/models`
//   on custom servers) and never falls back to public models.
// - Personal scope (`token` set, no `organizationID`): reads `${aiGatewayBase}/models` (or `/api/openrouter/models` on
//   custom servers); on 401 falls back to the anonymous free catalog, matching v1 (`api/models.ts:239-242`).
// - Anonymous scope (no `token`): reads `${aiGatewayBase}/models` without `Authorization` and keeps only `isFree` models.
export function get(scope: Scope): Effect.Effect<Result, Failure> {
  return Effect.gen(function* () {
    const server = KiloServer.normalize(scope.server)
    const organizationID = scope.token ? (scope.organizationID ?? null) : null
    const url = KiloServer.modelsUrl(server, organizationID)
    const headers: Record<string, string> = {
      ...KiloHeaders.provider({ version: scope.version ?? "unknown", organizationID }),
      ...(scope.token ? { Authorization: `Bearer ${scope.token}` } : {}),
    }
    const response = yield* request(url, { headers }, "Models fetch failed", TIMEOUT_MS).pipe(
      Effect.mapError((): Failure => ({ kind: "network" })),
    )
    if (!response.ok) {
      if (response.status === 401 && scope.token && !organizationID) {
        return yield* get({ server, version: scope.version })
      }
      const kind = response.status === 401 || response.status === 403 ? "unauthorized" : "http"
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"))
      return yield* Effect.fail({
        kind,
        status: response.status,
        ...(retryAfter !== undefined ? { retryAfter } : {}),
      } satisfies Failure)
    }
    const raw = yield* json(response, "Models fetch failed").pipe(
      Effect.mapError((): Failure => ({ kind: "schema" })),
    )
    const parsed = decodeEnvelope(raw)
    if (Option.isNone(parsed)) return yield* Effect.fail({ kind: "schema" } satisfies Failure)
    const anonymous = !scope.token
    return {
      models: catalogModels(parsed.value, anonymous),
      anonymous,
    }
  })
}

// Validates each entry individually so a single malformed model record does not drop the entire catalog.
export function catalogModels(response: { readonly data: readonly unknown[] }, anonymous: boolean): Model[] {
  return response.data
    .flatMap((entry) => Option.toArray(decodeRawModel(entry)))
    .filter(supportsTools)
    .map(toModel)
    .filter((model) => !anonymous || model.free)
}

// Ported from v1 `fetchKiloImageModels` (`api/models.ts:137-154`):
// fetches the Gateway catalog and keeps models whose `architecture.output_modalities` includes `"image"`.
export function imageModels(scope: Scope): Effect.Effect<ImageModel[], Failure> {
  return Effect.gen(function* () {
    const server = KiloServer.normalize(scope.server)
    const organizationID = scope.token ? (scope.organizationID ?? null) : null
    const url = KiloServer.modelsUrl(server, organizationID)
    const headers: Record<string, string> = {
      ...KiloHeaders.provider({ version: scope.version ?? "unknown", organizationID }),
      ...(scope.token ? { Authorization: `Bearer ${scope.token}` } : {}),
    }
    const response = yield* request(url, { headers }, "Image models fetch failed", TIMEOUT_MS).pipe(
      Effect.mapError((): Failure => ({ kind: "network" })),
    )
    if (!response.ok) {
      if (response.status === 401 && scope.token && !organizationID) {
        return yield* imageModels({ server, version: scope.version })
      }
      const kind = response.status === 401 || response.status === 403 ? "unauthorized" : "http"
      return yield* Effect.fail({ kind, status: response.status } satisfies Failure)
    }
    const raw = yield* json(response, "Image models fetch failed").pipe(
      Effect.mapError((): Failure => ({ kind: "schema" })),
    )
    const parsed = decodeEnvelope(raw)
    if (Option.isNone(parsed)) return yield* Effect.fail({ kind: "schema" } satisfies Failure)
    return parsed.value.data
      .flatMap((entry) => Option.toArray(decodeRawModel(entry)))
      .filter((model) => model.architecture?.output_modalities?.includes("image"))
      .map((model) => ({
        id: model.id,
        name: model.name,
        ...(typeof model.description === "string" && model.description.trim() !== ""
          ? { description: model.description.trim() }
          : {}),
      }))
  })
}

// Ported from v1 `fetchKiloTranscriptionModels` (`api/models.ts:156-190`):
// fetches `/api/gateway/transcription-models` and validates `{ id, name }[]`.
export function transcriptionModels(scope: Scope): Effect.Effect<TranscriptionModel[], Failure> {
  return Effect.gen(function* () {
    const server = KiloServer.normalize(scope.server)
    const organizationID = scope.token ? (scope.organizationID ?? null) : null
    const headers: Record<string, string> = {
      ...KiloHeaders.provider({ version: scope.version ?? "unknown", organizationID }),
      ...(scope.token ? { Authorization: `Bearer ${scope.token}` } : {}),
    }
    const response = yield* request(
      `${KiloServer.gateway(server)}/transcription-models`,
      { headers },
      "Transcription models fetch failed",
      TIMEOUT_MS,
    ).pipe(Effect.mapError((): Failure => ({ kind: "network" })))
    if (!response.ok) {
      const kind = response.status === 401 || response.status === 403 ? "unauthorized" : "http"
      return yield* Effect.fail({ kind, status: response.status } satisfies Failure)
    }
    const raw = yield* json(response, "Transcription models fetch failed").pipe(
      Effect.mapError((): Failure => ({ kind: "schema" })),
    )
    const parsed = decodeTranscriptionCatalog(raw)
    if (Option.isNone(parsed) || parsed.value.data.length === 0) {
      return yield* Effect.fail({ kind: "schema" } satisfies Failure)
    }
    return parsed.value.data.map((model) => ({ id: model.id, name: model.name }))
  })
}

// v1 `fetchKiloEmbeddingModelCatalog` also retried HTTP 425, so keep that status for this endpoint only.
const retryableEmbedding = (failure: Failure) =>
  retryable(failure) || (failure.kind === "http" && failure.status === 425)

// Ported from v1 `fetchKiloEmbeddingModelCatalog` (`api/embedding-models.ts`): the embedding model catalog for
// codebase indexing. The route is public, so it sends no token. It refuses redirects, and it retries network
// errors and transient statuses up to 3 attempts in total.
export function embeddingModels(scope: Pick<Scope, "server" | "version">): Effect.Effect<EmbeddingCatalog, Failure> {
  return Effect.gen(function* () {
    const response = yield* request(
      `${KiloServer.gateway(KiloServer.normalize(scope.server))}/embedding-models`,
      { headers: KiloHeaders.provider({ version: scope.version ?? "unknown" }), redirect: "error" },
      "Embedding models fetch failed",
      TIMEOUT_MS,
    ).pipe(Effect.mapError((): Failure => ({ kind: "network" })))
    if (!response.ok) {
      const kind = response.status === 401 || response.status === 403 ? "unauthorized" : "http"
      return yield* Effect.fail({ kind, status: response.status } satisfies Failure)
    }
    const raw = yield* json(response, "Embedding models fetch failed").pipe(
      Effect.mapError((): Failure => ({ kind: "schema" })),
    )
    const parsed = decodeEmbeddingCatalog(raw)
    if (Option.isNone(parsed)) return yield* Effect.fail({ kind: "schema" } satisfies Failure)
    return parsed.value
  }).pipe(Effect.retry({ times: 2, schedule: Schedule.exponential("200 millis"), while: retryableEmbedding }))
}

export function entries(models: readonly Model[]): Entry[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    isFree: model.free,
    ...(model.recommendedIndex !== undefined ? { recommendedIndex: model.recommendedIndex } : {}),
    ...(model.hasUserByokAvailable !== undefined ? { hasUserByokAvailable: model.hasUserByokAvailable } : {}),
    ...(model.mayTrainOnYourPrompts !== undefined ? { mayTrainOnYourPrompts: model.mayTrainOnYourPrompts } : {}),
    ...(model.autoRouting ? { autoRouting: { models: [...model.autoRouting.models] } } : {}),
    ...(model.terminalBench ? { terminalBench: { ...model.terminalBench } } : {}),
    ...(model.description ? { description: model.description } : {}),
    ...(model.reasoning ? { reasoning: true } : {}),
    ...(model.family ? { family: model.family } : {}),
    ...(model.aiSDKProvider ? { aiSDKProvider: model.aiSDKProvider } : {}),
  }))
}

// Same rule as v1 `supportsTools` (`api/models.ts:272-276`, commit c4506f7ef87):
// models with a missing or empty `supported_parameters` array are treated as tool-capable.
export function supportsTools(model: { readonly supported_parameters?: readonly string[] }): boolean {
  const params = model.supported_parameters
  if (!params || params.length === 0) return true
  return params.includes("tools")
}

// Retry predicate and exponential backoff from v1 `catalog-recovery.ts`.
export function retryable(failure: Failure): boolean {
  if (failure.kind === "network") return true
  if (failure.kind === "http") {
    return failure.status === 408 || failure.status === 429 || (failure.status !== undefined && failure.status >= 500)
  }
  return false
}

export function retryDelayMs(attempt: number, retryAfterSeconds?: number): number {
  const base = Math.min(30 * 2 ** Math.min(attempt, 4), 300)
  return Math.max(base, retryAfterSeconds ?? 0) * 1000
}

function toModel(model: RawModel): Model {
  const params = model.supported_parameters ?? []
  const output =
    positiveInteger(model.top_provider?.max_completion_tokens) ??
    positiveInteger(model.max_completion_tokens) ??
    Math.ceil(model.context_length * 0.2)
  const inputPrice = perMillion(model.pricing?.prompt)
  const outputPrice = perMillion(model.pricing?.completion)
  const cacheRead = perMillion(model.pricing?.input_cache_read)
  const cacheWrite = perMillion(model.pricing?.input_cache_write)
  const inputModalities = modalities(model.architecture?.input_modalities)
  const outputModalities = modalities(model.architecture?.output_modalities)
  const explicitFamily =
    typeof model.opencode?.family === "string" && model.opencode.family.trim() !== ""
      ? model.opencode.family.trim()
      : undefined
  const family = explicitFamily ?? extractFamily(model.id)
  // Decode each entry so one malformed option drops only itself, never the model or the catalog.
  // Null effort values are dropped, as in models.dev.
  const reasoningOptions = model.opencode?.reasoning_options?.flatMap((entry) =>
    Option.toArray(decodeReasoningOption(entry)).map(
      (option): ReasoningOption =>
        option.type === "effort"
          ? {
              type: "effort",
              values: option.values?.filter((value): value is string => value !== null && value !== "null"),
            }
          : option,
    ),
  )
  return {
    id: model.id,
    name: model.name,
    ...(typeof model.description === "string" && model.description.trim() !== ""
      ? { description: model.description.trim() }
      : {}),
    ...(family ? { family } : {}),
    ...Option.match(decodeAISDKProvider(model.opencode?.ai_sdk_provider), {
      onNone: () => ({}),
      onSome: (aiSDKProvider) => ({ aiSDKProvider }),
    }),
    free: model.isFree === true,
    ...(model.preferredIndex !== undefined ? { recommendedIndex: model.preferredIndex } : {}),
    ...(model.hasUserByokAvailable !== undefined ? { hasUserByokAvailable: model.hasUserByokAvailable } : {}),
    ...(model.mayTrainOnYourPrompts !== undefined ? { mayTrainOnYourPrompts: model.mayTrainOnYourPrompts } : {}),
    ...(model.autoRouting === undefined
      ? {}
      : Option.match(decodeAutoRouting(model.autoRouting), {
          onNone: () => ({}),
          onSome: (autoRouting) => ({ autoRouting }),
        })),
    ...(model.terminalBench === undefined
      ? {}
      : Option.match(decodeTerminalBench(model.terminalBench), {
          onNone: () => ({}),
          onSome: (terminalBench) => ({ terminalBench }),
        })),
    reasoning: params.includes("reasoning"),
    temperature: params.includes("temperature"),
    attachment: inputModalities.includes("image"),
    limit: { context: model.context_length, output },
    ...(inputPrice !== undefined && outputPrice !== undefined
      ? {
          cost: {
            input: inputPrice,
            output: outputPrice,
            ...(cacheRead !== undefined ? { cacheRead } : {}),
            ...(cacheWrite !== undefined ? { cacheWrite } : {}),
          },
        }
      : {}),
    capabilities: {
      tools: true,
      input: inputModalities,
      output: outputModalities,
    },
    // `[]` means reasoning is always on, so the model has no variants (same as models.dev).
    ...(reasoningOptions ? { reasoningOptions } : {}),
  }
}

function extractFamily(modelID: string): string | undefined {
  // Map `kilo-auto/small` (and `auto-small`) to the highest-priority small-model family so
  // `Model.small("kilo")` selects Kilo's small router for title generation and utility tasks.
  if (modelID === "kilo-auto/small" || modelID === "auto-small") return "gpt-luna"
  const parts = modelID.split("/")
  if (parts.length < 2) return undefined
  const name = parts[1] ?? ""
  if (name.includes("claude")) return "claude"
  if (name.includes("gpt")) return "gpt"
  if (name.includes("gemini")) return "gemini"
  if (name.includes("llama")) return "llama"
  if (name.includes("mistral")) return "mistral"
  return undefined
}

function positiveInteger(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null || !Number.isInteger(value) || value <= 0) return undefined
  return value
}

function perMillion(value: string | null | undefined): number | undefined {
  if (value === undefined || value === null || value.trim() === "") return undefined
  const parsed = Number(value)
  const result = parsed * 1_000_000
  if (!Number.isFinite(parsed) || !Number.isFinite(result) || parsed < 0) return undefined
  return result
}

function modalities(
  value: readonly string[] | null | undefined,
): ("text" | "audio" | "image" | "video" | "pdf")[] {
  if (!value || value.length === 0) return ["text"]
  const allowed = value.filter(
    (item): item is "text" | "audio" | "image" | "video" | "pdf" =>
      item === "text" || item === "audio" || item === "image" || item === "video" || item === "pdf",
  )
  return allowed.includes("text") ? allowed : ["text", ...allowed]
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined
  const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined
}
