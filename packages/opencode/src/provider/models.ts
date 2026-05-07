import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Installation } from "../installation"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Flock } from "@opencode-ai/core/util/flock"
import { Hash } from "@opencode-ai/core/util/hash"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { withTransientReadRetry } from "@/util/effect-http-client"
// kilocode_change start
import { Config } from "../config/config"
import { ModelCache } from "./model-cache"
import { Auth } from "../auth"
import { AI_SDK_PROVIDERS, KILO_OPENROUTER_BASE, PROMPTS } from "@kilocode/kilo-gateway"
// kilocode_change end

// kilocode_change start
const normalizeKiloBaseURL = (baseURL: string | undefined, org: string | undefined): string | undefined => {
  if (!baseURL) return undefined
  const trimmed = baseURL.replace(/\/+$/, "")
  if (org) {
    if (trimmed.includes("/api/organizations/")) return trimmed
    if (trimmed.endsWith("/api")) return `${trimmed}/organizations/${org}`
    return `${trimmed}/api/organizations/${org}`
  }
  if (trimmed.includes("/openrouter")) return trimmed
  if (trimmed.endsWith("/api")) return `${trimmed}/openrouter`
  return `${trimmed}/api/openrouter`
}
// kilocode_change end

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,
  tool_call: Schema.Boolean,
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  // kilocode_change start
  recommendedIndex: Schema.optional(Schema.Number),
  prompt: Schema.optional(Schema.Literals(PROMPTS)),
  isFree: Schema.optional(Schema.Boolean),
  ai_sdk_provider: Schema.optional(Schema.Literals(AI_SDK_PROVIDERS)),
  // kilocode_change end
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(Schema.Literals(["alpha", "beta", "deprecated"])),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))

    const source = Flag.KILO_MODELS_URL || "https://models.dev"
    const filepath = path.join(
      Global.Path.cache,
      source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
    )
    const ttl = Duration.minutes(5)
    const lockKey = `models-dev:${filepath}`

    const fresh = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return false
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
      return Date.now() - mtime < Duration.toMillis(ttl)
    })

    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader("User-Agent", Installation.USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("10 seconds"),
      )
    })

    const loadFromDisk = fs.readJson(Flag.KILO_MODELS_PATH ?? filepath).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
      Effect.map((v) => v as Record<string, Provider> | undefined),
    )

    // Bundled at build time; absent in dev — `tryPromise` covers both.
    const loadSnapshot = Effect.tryPromise({
      // @ts-ignore — generated at build time, may not exist in dev
      try: () => import("./models-snapshot.js").then((m) => m.snapshot as Record<string, Provider> | undefined),
      catch: () => undefined,
    }).pipe(Effect.catch(() => Effect.succeed(undefined)))

    const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
      const text = yield* fetchApi()
      yield* fs.writeWithDirs(filepath, text)
      return text
    })

    const populate = Effect.gen(function* () {
      const fromDisk = yield* loadFromDisk
      if (fromDisk) return fromDisk
      const snapshot = yield* loadSnapshot
      if (snapshot) return snapshot
      if (Flag.KILO_DISABLE_MODELS_FETCH) return {}
      // Flock is cross-process: concurrent opencode CLIs can race on this cache file.
      const text = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          return yield* fetchAndWrite()
        }),
      )
      return JSON.parse(text) as Record<string, Provider>
    }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

    // kilocode_change start
    const get = Effect.fn("ModelsDev.get")(function* () {
      const providers = { ...(yield* cachedGet) }
      delete providers["kilo"]

      const config = yield* Effect.promise(() => Config.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const kiloAllowed = (!enabled || enabled.has("kilo")) && !disabled.has("kilo")
      const apt = config.provider?.apertis?.options
      const aptBase = apt?.baseURL ?? "https://api.apertis.ai/v1"
      const aptFetch = {
        ...(apt?.baseURL ? { baseURL: apt.baseURL } : {}),
      }

      if (kiloAllowed) {
        const opts = config.provider?.kilo?.options
        const auth = yield* Effect.promise(() => Auth.get("kilo"))
        const org = opts?.kilocodeOrganizationId ?? (auth?.type === "oauth" ? auth.accountId : undefined)
        const base = normalizeKiloBaseURL(opts?.baseURL, org)
        const fetch = {
          ...(base ? { baseURL: base } : {}),
          ...(org ? { kilocodeOrganizationId: org } : {}),
        }
        const [kilo, apertis] = yield* Effect.all(
          [
            Effect.promise(() => ModelCache.fetch("kilo", fetch).catch(() => ({}))),
            providers["apertis"]
              ? Effect.succeed(null)
              : Effect.promise(() => ModelCache.fetch("apertis", aptFetch).catch(() => ({}))),
          ],
          { concurrency: 2 },
        )

        providers["kilo"] = {
          id: "kilo",
          name: "Kilo Gateway",
          env: ["KILO_API_KEY"],
          api: KILO_OPENROUTER_BASE.endsWith("/") ? KILO_OPENROUTER_BASE : `${KILO_OPENROUTER_BASE}/`,
          npm: "@kilocode/kilo-gateway",
          models: kilo,
        }
        if (Object.keys(kilo).length === 0) {
          yield* Effect.sync(() => void ModelCache.refresh("kilo", fetch).catch(() => {}))
        }
        if (!providers["apertis"] && apertis !== null) {
          providers["apertis"] = {
            id: "apertis",
            name: "Apertis",
            env: ["APERTIS_API_KEY"],
            api: aptBase,
            npm: "@ai-sdk/openai-compatible",
            models: apertis,
          }
          if (Object.keys(apertis).length === 0) {
            yield* Effect.sync(() => void ModelCache.refresh("apertis", aptFetch).catch(() => {}))
          }
        }
        return providers
      }

      if (!providers["apertis"]) {
        const apertis = yield* Effect.promise(() => ModelCache.fetch("apertis", aptFetch).catch(() => ({})))
        providers["apertis"] = {
          id: "apertis",
          name: "Apertis",
          env: ["APERTIS_API_KEY"],
          api: aptBase,
          npm: "@ai-sdk/openai-compatible",
          models: apertis,
        }
        if (Object.keys(apertis).length === 0) {
          yield* Effect.sync(() => void ModelCache.refresh("apertis", aptFetch).catch(() => {}))
        }
      }
      return providers
    })
    // kilocode_change end

    const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
      if (!force && (yield* fresh())) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          // Re-check under the lock: another process may have refreshed between
          // our outer check and lock acquisition.
          if (!force && (yield* fresh())) return
          yield* fetchAndWrite()
          yield* invalidate
        }),
      ).pipe(
        Effect.tapCause((cause) => Effect.logError("Failed to fetch models.dev", { cause })),
        Effect.ignore,
      )
    })

    if (!Flag.KILO_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      // Schedule.spaced runs the effect once, then waits between completions.
      yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced("60 minutes")), Effect.ignore))
    }

    return Service.of({ get, refresh })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as ModelsDev from "./models"
