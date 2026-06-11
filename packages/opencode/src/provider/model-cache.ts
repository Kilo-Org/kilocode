// kilocode_change - new file
import { fetchKiloModels, type KiloModelsResult } from "@kilocode/kilo-gateway"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Config } from "../config/config"
import { Auth } from "../auth"
import type { Provider } from "@opencode-ai/core/models"
import * as Log from "@opencode-ai/core/util/log"

type Models = Provider["models"]
type KiloOptions = NonNullable<Parameters<typeof fetchKiloModels>[0]>
type Options = { -readonly [K in keyof KiloOptions]?: KiloOptions[K] } & { apiKey?: string }
type Failure = NonNullable<KiloModelsResult["error"]>
type Result = { readonly models: Models; readonly error?: Failure }
type View = { models?: Models; timestamp?: number }

export interface KiloModels {
  readonly fetch: (options: KiloOptions) => Effect.Effect<KiloModelsResult, unknown>
}

export class KiloModelsService extends Context.Service<KiloModelsService, KiloModels>()(
  "@kilocode/ModelCache/KiloModels",
) {}

export const kiloModelsLayer = Layer.succeed(
  KiloModelsService,
  KiloModelsService.of({ fetch: (options) => Effect.tryPromise(() => fetchKiloModels(options)) }),
)
type Cell = {
  readonly providerID: string
  readonly view: View
  readonly cached: Effect.Effect<Result, unknown>
  readonly invalidate: Effect.Effect<void>
}

export interface Interface {
  readonly getFailure: (providerID: string) => Effect.Effect<Failure | undefined>
  readonly failedProviders: () => Effect.Effect<string[]>
  readonly get: (providerID: string) => Effect.Effect<Models | undefined>
  readonly fetch: (providerID: string, options?: Options) => Effect.Effect<Models, unknown>
  readonly refresh: (providerID: string, options?: Options) => Effect.Effect<Models, unknown>
  readonly clear: (providerID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/ModelCache") {}

const log = Log.create({ service: "model-cache" })
const ttl = Duration.minutes(5)
const APERTIS_BASE_URL = "https://api.apertis.ai/v1"
const LLMAPI_BASE_URL = "https://api.llmapi.ai/v1"

// OpenAI-compatible /models. Beyond the minimal `{id, owned_by}` that any
// OpenAI-style endpoint returns, OpenRouter-shaped gateways (LLMAPI) also expose
// pricing/context/architecture/capabilities — all optional so a minimal endpoint
// (e.g. apertis) still decodes and falls back to sensible defaults in `toModel`.
const OpenAICompatItem = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  owned_by: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  released_at: Schema.optional(Schema.String),
  context_length: Schema.optional(Schema.Number),
  max_completion_tokens: Schema.optional(Schema.Number),
  pricing: Schema.optional(
    Schema.Struct({
      prompt: Schema.optional(Schema.String),
      completion: Schema.optional(Schema.String),
      input_cache_read: Schema.optional(Schema.String),
      input_cache_write: Schema.optional(Schema.String),
    }),
  ),
  architecture: Schema.optional(
    Schema.Struct({
      input_modalities: Schema.optional(Schema.Array(Schema.String)),
      output_modalities: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  top_provider: Schema.optional(Schema.Struct({ max_completion_tokens: Schema.optional(Schema.Number) })),
  supported_parameters: Schema.optional(Schema.Array(Schema.String)),
})
const OpenAICompatModels = Schema.Struct({ data: Schema.optional(Schema.Array(OpenAICompatItem)) })
type OpenAICompatItem = Schema.Schema.Type<typeof OpenAICompatItem>

const KNOWN_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const
type KnownModality = (typeof KNOWN_MODALITIES)[number]
const mapModalities = (xs: readonly string[] | undefined): KnownModality[] =>
  (xs ?? []).filter((x): x is KnownModality => (KNOWN_MODALITIES as readonly string[]).includes(x))

// OpenRouter-style gateways quote prices in $/token strings; Kilo's cost model
// (and downstream usage math) expects $/M tokens.
const parseApiPrice = (price: string | undefined): number | undefined => {
  if (!price) return undefined
  const parsed = Number.parseFloat(price)
  if (Number.isNaN(parsed)) return undefined
  return parsed * 1_000_000
}

export const layer: Layer.Layer<
  Service,
  never,
  Auth.Service | Config.Service | KiloModelsService | HttpClient.HttpClient
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const cfg = yield* Config.Service
    const kilo = yield* KiloModelsService
    const http = yield* HttpClient.HttpClient
    const cells = new Map<string, Cell>()
    const active = new Map<string, Cell>()
    const versions = new Map<string, number>()
    const failures = new Map<string, Failure>()

    const getFailure = Effect.fn("ModelCache.getFailure")(function* (providerID: string) {
      return failures.get(providerID)
    })

    const failedProviders = Effect.fn("ModelCache.failedProviders")(function* () {
      return [...failures.keys()]
    })

    const toModel = (item: OpenAICompatItem): Models[string] => {
      const supported = item.supported_parameters
      const inputMods = mapModalities(item.architecture?.input_modalities)
      const outputMods = mapModalities(item.architecture?.output_modalities)
      const inputPrice = parseApiPrice(item.pricing?.prompt)
      const outputPrice = parseApiPrice(item.pricing?.completion)
      const cacheRead = parseApiPrice(item.pricing?.input_cache_read)
      const cacheWrite = parseApiPrice(item.pricing?.input_cache_write)
      const context = item.context_length && item.context_length > 0 ? item.context_length : 128000
      const output =
        item.top_provider?.max_completion_tokens ||
        item.max_completion_tokens ||
        (item.context_length ? Math.ceil(item.context_length * 0.2) : 4096)

      return {
        id: item.id,
        name: item.name ?? item.id,
        family: item.family ?? item.owned_by ?? "",
        release_date: item.released_at ?? "",
        // When the endpoint advertises modalities/capabilities, derive from them;
        // otherwise fall back to the permissive defaults a bare endpoint implies.
        attachment: item.architecture?.input_modalities ? inputMods.includes("image") : true,
        reasoning: supported ? supported.includes("reasoning") : false,
        temperature: supported ? supported.includes("temperature") : true,
        tool_call: supported ? supported.includes("tools") : true,
        cost:
          inputPrice !== undefined && outputPrice !== undefined
            ? {
                input: inputPrice,
                output: outputPrice,
                ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
                ...(cacheWrite !== undefined ? { cache_write: cacheWrite } : {}),
              }
            : { input: 0, output: 0 },
        limit: { context, output },
        modalities:
          inputMods.length > 0 || outputMods.length > 0
            ? { input: inputMods, output: outputMods }
            : { input: ["text", "image"], output: ["text"] },
      }
    }

    const fetchOpenAICompatModels = Effect.fn("ModelCache.fetchOpenAICompatModels")(function* (
      defaultBaseURL: string,
      options: Options,
      // requireKey=false for endpoints whose /models list is public (LLMAPI);
      // the bearer is still sent when present so per-key visibility can apply.
      requireKey = true,
    ) {
      const baseURL = options.baseURL ?? defaultBaseURL
      if (requireKey && !options.apiKey) {
        log.debug("no API key, skipping model fetch", { baseURL })
        return {}
      }

      const url = `${baseURL.replace(/\/+$/, "")}/models`
      const base = HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson)
      const authed = options.apiKey ? base.pipe(HttpClientRequest.bearerToken(options.apiKey)) : base
      const response = yield* authed.pipe(http.execute, Effect.timeout("10 seconds"))
      if (response.status < 200 || response.status >= 300) {
        log.error("openai-compatible model fetch failed", { url, status: response.status })
        return {}
      }

      const json = yield* HttpClientResponse.schemaBodyJson(OpenAICompatModels)(response)
      return Object.fromEntries((json.data ?? []).map((item) => [item.id, toModel(item)]))
    })

    const authOptions = Effect.fn("ModelCache.authOptions")(function* (providerID: string) {
      if (providerID !== "kilo" && providerID !== "apertis" && providerID !== "llmapi") return {}
      const config = yield* cfg.get()
      const options: Options = {}

      if (providerID === "kilo") {
        const item = config.provider?.[providerID]
        if (item?.options?.apiKey) options.kilocodeToken = item.options.apiKey
        if (item?.options?.kilocodeOrganizationId) options.kilocodeOrganizationId = item.options.kilocodeOrganizationId

        const info = yield* auth.get(providerID)
        if (info?.type === "api") options.kilocodeToken = info.key
        if (info?.type === "oauth") {
          options.kilocodeToken = info.access
          if (info.accountId) options.kilocodeOrganizationId = info.accountId
        }

        if (process.env.KILO_API_KEY) options.kilocodeToken = process.env.KILO_API_KEY
        if (process.env.KILO_ORG_ID) options.kilocodeOrganizationId = process.env.KILO_ORG_ID
        log.debug("auth options resolved", {
          providerID,
          hasToken: !!options.kilocodeToken,
          hasOrganizationId: !!options.kilocodeOrganizationId,
        })
      }

      if (providerID === "apertis" || providerID === "llmapi") {
        const item = config.provider?.[providerID]
        if (item?.options?.apiKey) options.apiKey = item.options.apiKey
        if (item?.options?.baseURL) options.baseURL = item.options.baseURL

        const info = yield* auth.get(providerID)
        if (info?.type === "api") options.apiKey = info.key

        const envKey = providerID === "apertis" ? "APERTIS_API_KEY" : "LLMAPI_API_KEY"
        const envBase = providerID === "apertis" ? "APERTIS_BASE_URL" : "LLMAPI_BASE_URL"
        if (process.env[envKey]) options.apiKey = process.env[envKey]
        if (process.env[envBase]) options.baseURL = process.env[envBase]
        log.debug("openai-compatible auth options resolved", {
          providerID,
          hasKey: !!options.apiKey,
          hasBaseURL: !!options.baseURL,
        })
      }

      return options
    })

    const fetchModels = (providerID: string, options: Options): Effect.Effect<Result, unknown> => {
      if (providerID === "kilo") return kilo.fetch(options)
      if (providerID === "apertis")
        return fetchOpenAICompatModels(APERTIS_BASE_URL, options).pipe(Effect.map((models) => ({ models })))
      if (providerID === "llmapi")
        // LLMAPI's /v1/models is public — fetch the catalog even without a key.
        return fetchOpenAICompatModels(LLMAPI_BASE_URL, options, false).pipe(Effect.map((models) => ({ models })))
      log.debug("provider not implemented", { providerID })
      return Effect.succeed({ models: {} })
    }

    const load = Effect.fn("ModelCache.load")(function* (providerID: string, options: Options) {
      const resolved = yield* authOptions(providerID).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            log.warn("auth options failed", { providerID, cause })
            return {}
          }),
        ),
      )
      return yield* fetchModels(providerID, { ...resolved, ...options })
    })

    const key = (providerID: string, options?: Options) => {
      if (providerID === "kilo") {
        return JSON.stringify([providerID, options?.baseURL, options?.kilocodeOrganizationId, options?.kilocodeToken])
      }
      if (providerID === "apertis" || providerID === "llmapi")
        return JSON.stringify([providerID, options?.baseURL, options?.apiKey])
      return providerID
    }

    const cell = Effect.fn("ModelCache.cell")(function* (providerID: string, options: Options = {}) {
      const id = key(providerID, options)
      const existing = cells.get(id)
      if (existing) return existing
      const view: View = {}
      const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(load(providerID, options), ttl)
      const next = { providerID, view, cached, invalidate }
      cells.set(id, next)
      return next
    })

    // Failed loads are not cached so a temporary outage can recover on the next read.
    const evaluate = (entry: Cell) => entry.cached.pipe(Effect.tapCause(() => entry.invalidate))

    const commit = (providerID: string, version: number, entry: Cell, result: Result) =>
      Effect.sync(() => {
        if ((versions.get(providerID) ?? 0) !== version) return result.models
        if (result.error) {
          failures.set(providerID, result.error)
          log.warn("model fetch error", { providerID, error: result.error })
        } else {
          failures.delete(providerID)
        }
        entry.view.models = result.models
        entry.view.timestamp = Date.now()
        active.set(providerID, entry)
        log.info("models fetched and cached", { providerID, count: Object.keys(result.models).length })
        return result.models
      })

    const get = Effect.fn("ModelCache.get")(function* (providerID: string) {
      const entry = active.get(providerID)
      if (!entry?.view.models || entry.view.timestamp === undefined) {
        log.debug("cache miss", { providerID })
        return
      }

      const age = Date.now() - entry.view.timestamp
      if (age > Duration.toMillis(ttl)) {
        log.debug("cache expired", { providerID, age })
        entry.view.models = undefined
        entry.view.timestamp = undefined
        yield* entry.invalidate
        return
      }

      log.debug("cache hit", { providerID, age })
      return entry.view.models
    })

    const fetch = Effect.fn("ModelCache.fetch")(function* (providerID: string, options?: Options) {
      const cached = yield* get(providerID)
      if (cached) return cached
      const version = (versions.get(providerID) ?? 0) + 1
      versions.set(providerID, version)
      const entry = yield* cell(providerID, options)
      log.info("fetching models", { providerID })
      const result = yield* evaluate(entry)
      return yield* commit(providerID, version, entry, result)
    })

    const refresh = Effect.fn("ModelCache.refresh")(function* (providerID: string, options?: Options) {
      const version = (versions.get(providerID) ?? 0) + 1
      versions.set(providerID, version)
      const entry = yield* cell(providerID, options)
      log.info("refreshing models", { providerID })
      yield* entry.invalidate
      const result = yield* evaluate(entry)
      return yield* commit(providerID, version, entry, result)
    })

    const clear = Effect.fn("ModelCache.clear")(function* (providerID: string) {
      versions.set(providerID, (versions.get(providerID) ?? 0) + 1)
      const entries = [...cells.entries()].filter(([, entry]) => entry.providerID === providerID)
      yield* Effect.all(
        entries.map(([id, entry]) => entry.invalidate.pipe(Effect.tap(() => Effect.sync(() => cells.delete(id))))),
        { discard: true },
      )
      active.delete(providerID)
      failures.delete(providerID)
      if (entries.some(([, entry]) => entry.view.models)) {
        log.info("cache cleared", { providerID })
        return
      }
      log.debug("no cache to clear", { providerID })
    })

    return Service.of({ getFailure, failedProviders, get, fetch, refresh, clear })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(kiloModelsLayer),
)

export * as ModelCache from "./model-cache"
