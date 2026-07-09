// kilocode_change - new file
import { fetchKiloModels, type KiloModelsResult } from "@kilocode/kilo-gateway"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Config } from "../config/config"
import { Auth } from "../auth"
import type { Provider } from "@opencode-ai/core/models-dev"
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
const ApertisItem = Schema.Struct({ id: Schema.String, owned_by: Schema.optional(Schema.String) })
const ApertisResponse = Schema.Struct({ data: Schema.optional(Schema.Array(ApertisItem)) })
type ApertisItem = Schema.Schema.Type<typeof ApertisItem>

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

    const aperture = (item: ApertisItem): Models[string] => ({
      id: item.id,
      name: item.id,
      family: item.owned_by ?? "",
      release_date: "",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 4096 },
      modalities: { input: ["text", "image"], output: ["text"] },
    })

    const fetchApertisModels = Effect.fn("ModelCache.fetchApertisModels")(function* (options: Options) {
      const baseURL = options.baseURL ?? APERTIS_BASE_URL
      if (!options.apiKey) {
        log.debug("no API key for apertis, skipping model fetch")
        return {}
      }

      const url = `${baseURL.replace(/\/+$/, "")}/models`
      const response = yield* HttpClientRequest.get(url).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(options.apiKey),
        http.execute,
        Effect.timeout("10 seconds"),
      )
      if (response.status < 200 || response.status >= 300) {
        log.error("apertis model fetch failed", { status: response.status })
        return {}
      }

      const json = yield* HttpClientResponse.schemaBodyJson(ApertisResponse)(response)
      return Object.fromEntries((json.data ?? []).map((item) => [item.id, aperture(item)]))
    })

    const authOptions = Effect.fn("ModelCache.authOptions")(function* (providerID: string) {
      if (providerID !== "kilo" && providerID !== "apertis") return {}
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

      if (providerID === "apertis") {
        const item = config.provider?.[providerID]
        if (item?.options?.apiKey) options.apiKey = item.options.apiKey
        if (item?.options?.baseURL) options.baseURL = item.options.baseURL

        const info = yield* auth.get(providerID)
        if (info?.type === "api") options.apiKey = info.key
        if (process.env.APERTIS_API_KEY) options.apiKey = process.env.APERTIS_API_KEY
        if (process.env.APERTIS_BASE_URL) options.baseURL = process.env.APERTIS_BASE_URL
        log.debug("apertis auth options resolved", {
          providerID,
          hasKey: !!options.apiKey,
          hasBaseURL: !!options.baseURL,
        })
      }

      return options
    })

    const fetchModels = (providerID: string, options: Options): Effect.Effect<Result, unknown> => {
      if (providerID === "kilo") return kilo.fetch(options)
      if (providerID === "apertis") return fetchApertisModels(options).pipe(Effect.map((models) => ({ models })))
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
      if (providerID === "apertis") return JSON.stringify([providerID, options?.baseURL, options?.apiKey])
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
