import { Effect, Option, Schema } from "effect"
import type { KiloModels } from "@opencode-ai/schema/kilocode/models"
import { Money } from "@opencode-ai/schema/money"
import { Model } from "@opencode-ai/schema/model"
import { PositiveInt } from "@opencode-ai/schema/schema"
import type { GatewayAccount } from "./plugin.js"
import { fetchAuthenticatedJSON } from "./gateway.js"

// Source contract: origin/main ecccd1f, kilo-gateway/src/api/models.ts.
// Keep display metadata separate from model settings sent to inference providers.
const Response = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
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
      hasUserByokAvailable: Schema.optionalKey(Schema.Boolean),
      mayTrainOnYourPrompts: Schema.optionalKey(Schema.Boolean),
      supported_parameters: Schema.optionalKey(Schema.Array(Schema.String)),
      // The catalog record remains usable when this optional presentation field is malformed.
      autoRouting: Schema.optionalKey(Schema.Unknown),
      opencode: Schema.optionalKey(
        Schema.Struct({
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

type SourceModel = (typeof Response.Type)["data"][number]

const AISDKProvider = Schema.Literals(["anthropic", "openai", "openai-compatible", "openrouter"])
export type GatewayAISDKProvider = typeof AISDKProvider.Type
const decodeAISDKProvider = Schema.decodeUnknownOption(AISDKProvider)

const AutoRouting = Schema.Struct({ models: Schema.Array(Schema.String) })
const decodeAutoRouting = Schema.decodeUnknownOption(AutoRouting)

export type CatalogModel = {
  readonly id: string
  readonly name: string
  /** Selects the Gateway API dialect for this model. Missing or invalid values use OpenRouter chat. */
  readonly aiSDKProvider?: GatewayAISDKProvider
  readonly recommendedIndex?: number
  readonly autoRouting?: { readonly models: readonly string[] }
  readonly hasUserByokAvailable?: boolean
  readonly mayTrainOnYourPrompts?: boolean
  readonly variants?: readonly Model.Variant[]
  readonly limit?: { readonly context: number; readonly output: number }
  readonly cost?: {
    readonly input: Money.USDPerMillionTokens
    readonly output: Money.USDPerMillionTokens
    readonly cache: { readonly read: Money.USDPerMillionTokens; readonly write: Money.USDPerMillionTokens }
  }
  readonly capabilities?: { readonly tools: true; readonly input: string[]; readonly output: string[] }
}

export function fetchModelMetadata(account: GatewayAccount) {
  return fetchCatalogModels(account).pipe(
    Effect.map((models): KiloModels.Entry[] =>
      models.map((model) => ({
        id: model.id,
        ...(model.recommendedIndex !== undefined ? { recommendedIndex: model.recommendedIndex } : {}),
        ...(model.autoRouting ? { autoRouting: { models: [...model.autoRouting.models] } } : {}),
        ...(model.hasUserByokAvailable === undefined ? {} : { hasUserByokAvailable: model.hasUserByokAvailable }),
        ...(model.mayTrainOnYourPrompts === undefined ? {} : { mayTrainOnYourPrompts: model.mayTrainOnYourPrompts }),
      })),
    ),
  )
}

/** Maps the Gateway's OpenRouter record into the portion of v2's native catalog it can represent. */
export function fetchCatalogModels(account: GatewayAccount) {
  return fetch(account).pipe(Effect.map((response) => response.data.filter(supportsTools).map(catalogModel)))
}

function fetch(account: GatewayAccount) {
  const path =
    account.organizationID === null
      ? "/api/openrouter/models"
      : `/api/organizations/${encodeURIComponent(account.organizationID)}/models`
  return fetchAuthenticatedJSON(
    account.server,
    account.token,
    path,
    Response,
    account.organizationID ? { "X-KILOCODE-ORGANIZATIONID": account.organizationID } : {},
  )
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
    ...(model.preferredIndex === undefined ? {} : { recommendedIndex: model.preferredIndex }),
    ...(model.autoRouting === undefined
      ? {}
      : Option.match(decodeAutoRouting(model.autoRouting), {
          onNone: () => ({}),
          onSome: (autoRouting) => ({ autoRouting }),
        })),
    ...(model.hasUserByokAvailable === undefined ? {} : { hasUserByokAvailable: model.hasUserByokAvailable }),
    ...(model.mayTrainOnYourPrompts === undefined ? {} : { mayTrainOnYourPrompts: model.mayTrainOnYourPrompts }),
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
