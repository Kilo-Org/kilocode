// kilocode_change - adapt Kilo model assembly to the upstream core models service
import { Config } from "@/config/config"
import { Auth } from "@/auth"
import { ModelCache } from "./model-cache"
import * as Core from "@opencode-ai/core/models"
import { Context, Effect, Layer } from "effect"
import { AI_SDK_PROVIDERS, KILO_OPENROUTER_BASE, PROMPTS } from "@kilocode/kilo-gateway"

export const Model = Core.Model
export type Model = Core.Model
export const Provider = Core.Provider
export type Provider = Core.Provider
export const CatalogModelStatus = Core.CatalogModelStatus
export type CatalogModelStatus = Core.CatalogModelStatus

export interface Interface extends Core.Interface {}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

function baseURL(url: string | undefined, org: string | undefined) {
  if (!url) return
  const base = url.replace(/\/+$/, "")
  if (org) {
    if (base.includes("/api/organizations/")) return base
    if (base.endsWith("/api")) return `${base}/organizations/${org}`
    return `${base}/api/organizations/${org}`
  }
  if (base.includes("/openrouter")) return base
  if (base.endsWith("/api")) return `${base}/openrouter`
  return `${base}/api/openrouter`
}

export const layer: Layer.Layer<
  Service,
  never,
  Core.Service | Config.Service | Auth.Service | ModelCache.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const core = yield* Core.Service
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const cache = yield* ModelCache.Service

    const get = Effect.fn("ModelsDev.get")(function* () {
      const providers = { ...(yield* core.get()) }
      delete providers.kilo

      const cfg = yield* config.get()
      const disabled = new Set(cfg.disabled_providers ?? [])
      const enabled = cfg.enabled_providers ? new Set(cfg.enabled_providers) : undefined
      const allowed = (!enabled || enabled.has("kilo")) && !disabled.has("kilo")
      const apt = cfg.provider?.apertis?.options
      const aptURL = apt?.baseURL ?? "https://api.apertis.ai/v1"
      const aptOpts = apt?.baseURL ? { baseURL: apt.baseURL } : {}

      const addApertis = Effect.fnUntraced(function* () {
        if (providers.apertis) return
        const models = yield* cache.fetch("apertis", aptOpts).pipe(Effect.catch(() => Effect.succeed({})))
        providers.apertis = {
          id: "apertis",
          name: "Apertis",
          env: ["APERTIS_API_KEY"],
          api: aptURL,
          npm: "@ai-sdk/openai-compatible",
          models,
        }
        if (Object.keys(models).length === 0) yield* cache.refresh("apertis", aptOpts).pipe(Effect.ignore, Effect.forkDetach)
      })

      if (!allowed) {
        yield* addApertis()
        return providers
      }

      const opts = cfg.provider?.kilo?.options
      const info = yield* auth.get("kilo").pipe(Effect.catch(() => Effect.succeed(undefined)))
      const org = opts?.kilocodeOrganizationId ?? (info?.type === "oauth" ? info.accountId : undefined)
      const url = baseURL(opts?.baseURL, org)
      const fetch = {
        ...(url ? { baseURL: url } : {}),
        ...(org ? { kilocodeOrganizationId: org } : {}),
      }
      const models = yield* cache.fetch("kilo", fetch).pipe(Effect.catch(() => Effect.succeed({})))
      providers.kilo = {
        id: "kilo",
        name: "Kilo Gateway",
        env: ["KILO_API_KEY"],
        api: KILO_OPENROUTER_BASE.endsWith("/") ? KILO_OPENROUTER_BASE : `${KILO_OPENROUTER_BASE}/`,
        npm: "@kilocode/kilo-gateway",
        models,
      }
      if (Object.keys(models).length === 0) yield* cache.refresh("kilo", fetch).pipe(Effect.ignore, Effect.forkDetach)
      yield* addApertis()
      return providers
    })

    return Service.of({ get, refresh: core.refresh })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Core.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(ModelCache.defaultLayer),
)

export { AI_SDK_PROVIDERS, PROMPTS }
export * as ModelsDev from "./models"
