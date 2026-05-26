// kilocode_change - new file
import { fetchKiloModels, type KiloModelsResult } from "@kilocode/kilo-gateway"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Config } from "../config/config"
import { Auth } from "../auth"
import type { Provider } from "./models"
import * as Log from "@opencode-ai/core/util/log"

type Models = Provider["models"]
type KiloOptions = NonNullable<Parameters<typeof fetchKiloModels>[0]>
type Options = { -readonly [K in keyof KiloOptions]?: KiloOptions[K] } & { apiKey?: string }
type Failure = NonNullable<KiloModelsResult["error"]>
type Result = { readonly models: Models; readonly error?: Failure }
type View = { options?: Options; models?: Models; timestamp?: number }
type Cell = {
  readonly view: View
  readonly cached: Effect.Effect<Models, unknown>
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

export const layer: Layer.Layer<Service, never, Auth.Service | Config.Service | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const cfg = yield* Config.Service
    const http = yield* HttpClient.HttpClient
    const cells = new Map<string, Cell>()
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
      if (providerID === "kilo") return Effect.tryPromise(() => fetchKiloModels(options))
      if (providerID === "apertis") return fetchApertisModels(options).pipe(Effect.map((models) => ({ models })))
      log.debug("provider not implemented", { providerID })
      return Effect.succeed({ models: {} })
    }

    const load = Effect.fn("ModelCache.load")(function* (providerID: string, view: View) {
      const input = view.options
      const resolved = yield* authOptions(providerID).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            log.warn("auth options failed", { providerID, cause })
            return {}
          }),
        ),
      )
      const result = yield* fetchModels(providerID, { ...resolved, ...input })
      if (result.error) {
        failures.set(providerID, result.error)
        log.warn("model fetch error", { providerID, error: result.error })
      } else {
        failures.delete(providerID)
      }
      view.models = result.models
      view.timestamp = Date.now()
      log.info("models fetched and cached", { providerID, count: Object.keys(result.models).length })
      return result.models
    })

    const cell = Effect.fn("ModelCache.cell")(function* (providerID: string) {
      const existing = cells.get(providerID)
      if (existing) return existing
      const view: View = {}
      const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(load(providerID, view), ttl)
      const next = { view, cached, invalidate }
      cells.set(providerID, next)
      return next
    })

    const evaluate = (entry: Cell) => entry.cached.pipe(Effect.tapCause(() => entry.invalidate))

    const get = Effect.fn("ModelCache.get")(function* (providerID: string) {
      const entry = cells.get(providerID)
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
      const entry = yield* cell(providerID)
      entry.view.options = options
      log.info("fetching models", { providerID })
      return yield* evaluate(entry)
    })

    const refresh = Effect.fn("ModelCache.refresh")(function* (providerID: string, options?: Options) {
      const entry = yield* cell(providerID)
      entry.view.options = options
      log.info("refreshing models", { providerID })
      yield* entry.invalidate
      return yield* evaluate(entry)
    })

    const clear = Effect.fn("ModelCache.clear")(function* (providerID: string) {
      const entry = cells.get(providerID)
      if (entry) yield* entry.invalidate
      cells.delete(providerID)
      failures.delete(providerID)
      if (entry?.view.models) {
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
)

export * as ModelCache from "./model-cache"
