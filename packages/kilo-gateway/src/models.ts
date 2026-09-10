import { Effect, Option, Schema } from "effect"
import type { KiloModels } from "@opencode-ai/schema/kilocode/models"
import { Money } from "@opencode-ai/schema/money"
import { Model } from "@opencode-ai/schema/model"
import { PositiveInt } from "@opencode-ai/schema/schema"
import type { GatewayAccount } from "./plugin.js"
import { fetchGatewayJSON } from "./gateway.js"

// Source contract: origin/main ecccd1f, kilo-gateway/src/api/models.ts.
// Keep display metadata separate from model settings sent to inference providers.
export const CatalogResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.optionalKey(Schema.NullOr(Schema.String)),
      context_length: PositiveInt,
      max_completion_tokens: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
      top_provider: Schema.optionalKey(
        Schema.Struct({ max_completion_tokens: Schema.optionalKey(Schema.NullOr(Schema.Finite)) }),
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
        }),
      ),
      preferredIndex: Schema.optionalKey(Schema.Finite),
      // Source contract: origin/main ecccd1f, kilo-gateway/src/api/models.ts:39 — the free-tier
      // flag the Gateway publishes per record. Captured from the public unauthenticated read
      // (GET /api/openrouter/models, HTTP 200): present on every one of 371 records, 19 true.
      // Signed-out eligibility uses only this flag; it is never inferred from prices or ids.
      isFree: Schema.optionalKey(Schema.Boolean),
      hasUserByokAvailable: Schema.optionalKey(Schema.Boolean),
      mayTrainOnYourPrompts: Schema.optionalKey(Schema.Boolean),
      // Source contract: origin/main ecccd1f, kilo-gateway/src/api/models.ts:48 — optional
      // per-model presentation metadata, tolerantly decoded per record below. A malformed
      // value omits the metadata and keeps the model; it never reaches request settings.
      terminalBench: Schema.optionalKey(Schema.Unknown),
      supported_parameters: Schema.optionalKey(Schema.Array(Schema.String)),
      // The catalog record remains usable when this optional presentation field is malformed.
      autoRouting: Schema.optionalKey(Schema.Unknown),
      opencode: Schema.optionalKey(
        Schema.Struct({
          family: Schema.optionalKey(Schema.NullOr(Schema.String)),
          // Source overlays map directly to v2 catalog variants.
          variants: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Json))),
          // V1 tolerates malformed optional policy tags. Prompt assets still need a v2 adaptation;
          // the closed provider tag is decoded per record below, never added to request settings.
          prompt: Schema.optionalKey(Schema.Unknown),
          ai_sdk_provider: Schema.optionalKey(Schema.Unknown),
        }),
      ),
    }),
  ),
})

type SourceModel = (typeof CatalogResponse.Type)["data"][number]

const AISDKProvider = Schema.Literals(["anthropic", "openai", "openai-compatible", "openrouter"])
export type GatewayAISDKProvider = typeof AISDKProvider.Type
const decodeAISDKProvider = Schema.decodeUnknownOption(AISDKProvider)

// Source contract: origin/main ecccd1f, kilo-gateway/src/api/constants.ts PROMPTS closed enum.
// The catalog `opencode.prompt` policy tag is provenance for the host's prompt-selector
// policy, not a model setting: decode it tolerantly per record and surface it on CatalogModel
// without touching family, settings, or credentials. A malformed or out-of-enum value yields
// no tag; the record stays usable.
const Prompt = Schema.Literals([
  "codex",
  "gemini",
  "beast",
  "anthropic",
  "trinity",
  "anthropic_without_todo",
  "ling",
  "gpt55",
])
export type GatewayPrompt = typeof Prompt.Type
const decodePrompt = Schema.decodeUnknownOption(Prompt)

const AutoRouting = Schema.Struct({ models: Schema.Array(Schema.String) })
const decodeAutoRouting = Schema.decodeUnknownOption(AutoRouting)

// V1 display contract (pinned): Completion = (overallScore * 100).toFixed(1)%,
// Cost / attempt = $avgAttemptCostUsd.toFixed(2). Both values are finite numbers.
const TerminalBench = Schema.Struct({
  overallScore: Schema.Finite,
  avgAttemptCostUsd: Schema.Finite,
})
const decodeTerminalBench = Schema.decodeUnknownOption(TerminalBench)

export type CatalogModel = {
  readonly id: string
  readonly name: string
  /** Selects the Gateway API dialect for this model. Missing or invalid values use OpenRouter chat. */
  readonly aiSDKProvider?: GatewayAISDKProvider
  /** Catalog `opencode.prompt` policy tag. Absent when the source omits it or it fails the closed-enum decode. */
  readonly prompt?: GatewayPrompt
  readonly recommendedIndex?: number
  readonly autoRouting?: { readonly models: readonly string[] }
  readonly hasUserByokAvailable?: boolean
  /** The Gateway's own free-tier flag (`isFree`). Signed-out scopes expose only these records. */
  readonly free: boolean
  readonly mayTrainOnYourPrompts?: boolean
  readonly terminalBench?: { readonly overallScore: number; readonly avgAttemptCostUsd: number }
  readonly description?: string
  readonly reasoning?: boolean
  readonly family?: string
  readonly variants?: readonly Model.Variant[]
  readonly limit?: { readonly context: number; readonly output: number }
  readonly cost?: {
    readonly input: Money.USDPerMillionTokens
    readonly output: Money.USDPerMillionTokens
    readonly cache: { readonly read: Money.USDPerMillionTokens; readonly write: Money.USDPerMillionTokens }
  }
  readonly capabilities?: { readonly tools: true; readonly input: string[]; readonly output: string[] }
}

/** The public metadata projection of an already-read catalog. */
export function catalogEntries(models: readonly CatalogModel[]): KiloModels.Entry[] {
  return models.map((model) => ({
    id: model.id,
    ...(model.recommendedIndex !== undefined ? { recommendedIndex: model.recommendedIndex } : {}),
    ...(model.autoRouting ? { autoRouting: { models: [...model.autoRouting.models] } } : {}),
    ...(model.hasUserByokAvailable === undefined ? {} : { hasUserByokAvailable: model.hasUserByokAvailable }),
    ...(model.mayTrainOnYourPrompts === undefined ? {} : { mayTrainOnYourPrompts: model.mayTrainOnYourPrompts }),
    ...(model.terminalBench ? { terminalBench: { ...model.terminalBench } } : {}),
    ...(model.description ? { description: model.description } : {}),
    ...(model.reasoning ? { reasoning: true } : {}),
    ...(model.family ? { family: model.family } : {}),
  }))
}

export function fetchModelMetadata(account: GatewayAccount) {
  return fetchCatalogModels(account).pipe(Effect.map(catalogEntries))
}

/**
 * A catalog read scope. Omitting `token` is the signed-out read: the request
 * carries no `Authorization`, and only records the Gateway itself marks
 * `isFree` are returned, so a signed-out catalog never offers a model the
 * anonymous key cannot execute. This is stricter than v1, which listed the
 * whole anonymous catalog and let the server reject paid models at request
 * time (v1 used `isFree` only for export eligibility and pricing display).
 */
export type GatewayCatalogScope = {
  readonly server: string
  readonly organizationID: string | null
  readonly token?: string
}

/** Maps the Gateway's OpenRouter record into the portion of v2's native catalog it can represent. */
export function fetchCatalogModels(account: GatewayCatalogScope) {
  return fetchCatalogSource(account).pipe(
    Effect.map((response) => catalogModels(response, account.token === undefined)),
  )
}

/**
 * Reads the scoped catalog. An anonymous scope (no token) reads only the public
 * personal endpoint and sends no organization header — an organization catalog is
 * never requested without a credential.
 */
export function fetchCatalogSource(account: GatewayCatalogScope) {
  const organizationID = account.token === undefined ? null : account.organizationID
  const path =
    organizationID === null
      ? "/api/openrouter/models"
      : `/api/organizations/${encodeURIComponent(organizationID)}/models`
  return fetchGatewayJSON(
    account.server,
    account.token,
    path,
    CatalogResponse,
    organizationID ? { "X-KILOCODE-ORGANIZATIONID": organizationID } : {},
  )
}

export function catalogModels(response: typeof CatalogResponse.Type, anonymous: boolean): CatalogModel[] {
  return response.data
    .filter(supportsTools)
    .map(catalogModel)
    .filter((model) => !anonymous || model.free)
}

function supportsTools(model: SourceModel) {
  return model.supported_parameters === undefined || model.supported_parameters.includes("tools")
}

function catalogModel(model: SourceModel): CatalogModel {
  const output = positiveInteger(model.top_provider?.max_completion_tokens ?? model.max_completion_tokens)
  const inputPrice = perMillion(model.pricing?.prompt)
  const outputPrice = perMillion(model.pricing?.completion)
  const cacheRead = perMillion(model.pricing?.input_cache_read)
  const cacheWrite = perMillion(model.pricing?.input_cache_write)
  const input = modalities(model.architecture?.input_modalities)
  const outputModalities = modalities(model.architecture?.output_modalities)
  return {
    id: model.id,
    name: model.name,
    ...Option.match(decodeAISDKProvider(model.opencode?.ai_sdk_provider), {
      onNone: () => ({}),
      onSome: (aiSDKProvider) => ({ aiSDKProvider }),
    }),
    ...Option.match(decodePrompt(model.opencode?.prompt), {
      onNone: () => ({}),
      onSome: (prompt) => ({ prompt }),
    }),
    ...(model.preferredIndex === undefined ? {} : { recommendedIndex: model.preferredIndex }),
    ...(model.autoRouting === undefined
      ? {}
      : Option.match(decodeAutoRouting(model.autoRouting), {
          onNone: () => ({}),
          onSome: (autoRouting) => ({ autoRouting }),
        })),
    ...(model.hasUserByokAvailable === undefined ? {} : { hasUserByokAvailable: model.hasUserByokAvailable }),
    free: model.isFree === true,
    ...(model.mayTrainOnYourPrompts === undefined ? {} : { mayTrainOnYourPrompts: model.mayTrainOnYourPrompts }),
    ...(model.terminalBench === undefined
      ? {}
      : Option.match(decodeTerminalBench(model.terminalBench), {
          onNone: () => ({}),
          onSome: (terminalBench) => ({ terminalBench }),
        })),
    ...(typeof model.description === "string" && model.description.trim() !== ""
      ? { description: model.description.trim() }
      : {}),
    ...(model.supported_parameters !== undefined
      ? { reasoning: model.supported_parameters.includes("reasoning") }
      : {}),
    ...(typeof model.opencode?.family === "string" && model.opencode.family.trim() !== ""
      ? { family: model.opencode.family.trim() }
      : {}),
    ...(model.opencode?.variants === undefined
      ? {}
      : {
          variants: Object.entries(model.opencode.variants).map(([id, settings]) => ({
            id: Model.VariantID.make(id),
            settings,
          })),
        }),
    limit: { context: model.context_length, output: output ?? Math.ceil(model.context_length * 0.2) },
    ...(inputPrice === undefined || outputPrice === undefined
      ? {}
      : {
          cost: {
            input: Money.USDPerMillionTokens.make(inputPrice),
            output: Money.USDPerMillionTokens.make(outputPrice),
            cache: {
              read: Money.USDPerMillionTokens.make(cacheRead ?? 0),
              write: Money.USDPerMillionTokens.make(cacheWrite ?? 0),
            },
          },
        }),
    capabilities: { tools: true, input: input ?? ["text"], output: outputModalities ?? ["text"] },
  }
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

function modalities(value: readonly string[] | null | undefined): string[] | undefined {
  if (value === undefined || value === null) return undefined
  const result = value.filter((item) => ["text", "audio", "image", "video", "pdf"].includes(item))
  return result.includes("text") ? result : ["text", ...result]
}
