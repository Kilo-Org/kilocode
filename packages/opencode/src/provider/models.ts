import { Global } from "../global"
import { Log } from "../util"
import path from "path"
import { Schema } from "effect"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util"
import { Flock } from "@opencode-ai/shared/util/flock"
import { Hash } from "@opencode-ai/shared/util/hash"
// kilocode_change start
import { Config } from "../config"
import { ModelCache } from "./model-cache"
import { Auth } from "../auth"
import { AI_SDK_PROVIDERS, KILO_OPENROUTER_BASE, PROMPTS } from "@kilocode/kilo-gateway"
// kilocode_change end

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

// kilocode_change start
const normalizeKiloBaseURL = (baseURL: string | undefined, orgId: string | undefined): string | undefined => {
  if (!baseURL) return undefined
  const trimmed = baseURL.replace(/\/+$/, "")
  if (orgId) {
    if (trimmed.includes("/api/organizations/")) return trimmed
    if (trimmed.endsWith("/api")) return `${trimmed}/organizations/${orgId}`
    return `${trimmed}/api/organizations/${orgId}`
  }
  if (trimmed.includes("/openrouter")) return trimmed
  if (trimmed.endsWith("/api")) return `${trimmed}/openrouter`
  return `${trimmed}/api/openrouter`
}
// kilocode_change end

const log = Log.create({ service: "models.dev" })
const source = url()
const filepath = path.join(
  Global.Path.cache,
  source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
)
const ttl = 5 * 60 * 1000

const Cost = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cache_read: Schema.optional(Schema.Number),
  cache_write: Schema.optional(Schema.Number),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Number,
      output: Schema.Number,
      cache_read: Schema.optional(Schema.Number),
      cache_write: Schema.optional(Schema.Number),
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
    context: Schema.Number,
    input: Schema.optional(Schema.Number),
    output: Schema.Number,
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

function url() {
  return Flag.KILO_MODELS_URL || "https://models.dev"
}

function fresh() {
  return Date.now() - Number(Filesystem.stat(filepath)?.mtimeMs ?? 0) < ttl
}

function skip(force: boolean) {
  return !force && fresh()
}

const fetchApi = async () => {
  const result = await fetch(`${url()}/api.json`, {
    headers: { "User-Agent": Installation.USER_AGENT },
    signal: AbortSignal.timeout(10000),
  })
  return { ok: result.ok, text: await result.text() }
}

export const Data = lazy(async () => {
  const result = await Filesystem.readJson(Flag.KILO_MODELS_PATH ?? filepath).catch(() => {})
  if (result) return result
  // @ts-ignore
  const snapshot = await import("./models-snapshot.js")
    .then((m) => m.snapshot as Record<string, unknown>)
    .catch(() => undefined)
  if (snapshot) return snapshot
  if (Flag.KILO_DISABLE_MODELS_FETCH) return {}
  return Flock.withLock(`models-dev:${filepath}`, async () => {
    const result = await Filesystem.readJson(Flag.KILO_MODELS_PATH ?? filepath).catch(() => {})
    if (result) return result
    const result2 = await fetchApi()
    if (result2.ok) {
      await Filesystem.write(filepath, result2.text).catch((e) => {
        log.error("Failed to write models cache", { error: e })
      })
    }
    return JSON.parse(result2.text)
  })
})

export async function get() {
  const result = await Data()
  // kilocode_change start
  const providers = result as Record<string, Provider>

  if (providers["kilo"]) {
    delete providers["kilo"]
  }

  // Inject kilo provider with dynamic model fetching
  // Skip injection entirely when enabled_providers is set and doesn't include "kilo",
  // or when "kilo" is in disabled_providers. This prevents unnecessary network calls
  // to the Kilo API for teams using only their own providers (e.g. LiteLLM).
  const config = await Config.get()
  const disabled = new Set(config.disabled_providers ?? [])
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null
  const kiloAllowed = (!enabled || enabled.has("kilo")) && !disabled.has("kilo")

  if (kiloAllowed && !providers["kilo"]) {
    const kiloOptions = config.provider?.kilo?.options
    // resolve org ID from auth (OAuth accountId) not just config
    const kiloAuth = await Auth.get("kilo")
    const kiloOrgId =
      kiloOptions?.kilocodeOrganizationId ?? (kiloAuth?.type === "oauth" ? kiloAuth.accountId : undefined)
    const normalizedBaseURL = normalizeKiloBaseURL(kiloOptions?.baseURL, kiloOrgId)
    const kiloFetchOptions = {
      ...(normalizedBaseURL ? { baseURL: normalizedBaseURL } : {}),
      ...(kiloOrgId ? { kilocodeOrganizationId: kiloOrgId } : {}),
    }
    const defaultBaseURL = kiloOrgId
      ? `https://api.kilo.ai/api/organizations/${kiloOrgId}`
      : "https://api.kilo.ai/api/openrouter"
    const providerBaseURL = normalizedBaseURL ?? defaultBaseURL
    const ensureTrailingSlash = (value: string): string => (value.endsWith("/") ? value : `${value}/`)
    const apertisConfig = config.provider?.apertis?.options
    const apertisBaseURL = apertisConfig?.baseURL ?? "https://api.apertis.ai/v1"
    const apertisFetchOptions = {
      ...(apertisConfig?.baseURL ? { baseURL: apertisConfig.baseURL } : {}),
    }

    const [kiloModels, apertisModels] = await Promise.all([
      ModelCache.fetch("kilo", kiloFetchOptions).catch(() => ({})),
      !providers["apertis"]
        ? ModelCache.fetch("apertis", apertisFetchOptions).catch(() => ({}))
        : Promise.resolve(null),
    ])

    providers["kilo"] = {
      id: "kilo",
      name: "Kilo Gateway",
      env: ["KILO_API_KEY"],
      api: ensureTrailingSlash(KILO_OPENROUTER_BASE),
      npm: "@kilocode/kilo-gateway",
      models: kiloModels,
    }
    if (Object.keys(kiloModels).length === 0) {
      ModelCache.refresh("kilo", kiloFetchOptions).catch(() => {})
    }

    if (!providers["apertis"] && apertisModels !== null) {
      providers["apertis"] = {
        id: "apertis",
        name: "Apertis",
        env: ["APERTIS_API_KEY"],
        api: apertisBaseURL,
        npm: "@ai-sdk/openai-compatible",
        models: apertisModels,
      }
      if (Object.keys(apertisModels).length === 0) {
        ModelCache.refresh("apertis", apertisFetchOptions).catch(() => {})
      }
    }
  } else if (!providers["apertis"]) {
    const apertisConfig = config.provider?.apertis?.options
    const apertisBaseURL = apertisConfig?.baseURL ?? "https://api.apertis.ai/v1"
    const apertisFetchOptions = {
      ...(apertisConfig?.baseURL ? { baseURL: apertisConfig.baseURL } : {}),
    }
    const apertisModels = await ModelCache.fetch("apertis", apertisFetchOptions).catch(() => ({}))
    providers["apertis"] = {
      id: "apertis",
      name: "Apertis",
      env: ["APERTIS_API_KEY"],
      api: apertisBaseURL,
      npm: "@ai-sdk/openai-compatible",
      models: apertisModels,
    }
    if (Object.keys(apertisModels).length === 0) {
      ModelCache.refresh("apertis", apertisFetchOptions).catch(() => {})
    }
  }

  return providers
  // kilocode_change end
}

export async function refresh(force = false) {
  if (skip(force)) return Data.reset()
  await Flock.withLock(`models-dev:${filepath}`, async () => {
    if (skip(force)) return Data.reset()
    const result = await fetchApi()
    if (!result.ok) return
    await Filesystem.write(filepath, result.text)
    Data.reset()
  }).catch((e) => {
    log.error("Failed to fetch models.dev", {
      error: e,
    })
  })
}

if (!Flag.KILO_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
  void refresh()
  setInterval(
    async () => {
      await refresh()
    },
    60 * 1000 * 60,
  ).unref()
}
