// kilocode_change - new file
import { Config } from "@/config/config"
import { Auth } from "@/auth"
import { ModelCache } from "./model-cache"
import * as Core from "@opencode-ai/core/models-dev"
import { Context, Effect, Layer } from "effect"
import { AI_SDK_PROVIDERS, KILO_OPENROUTER_BASE, PROMPTS } from "@kilocode/kilo-gateway"
import { overlay } from "@/kilocode/anaconda-desktop/provider"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // kilocode_change

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

export const layer: Layer.Layer<Service, never, Core.Service | Config.Service | Auth.Service | ModelCache.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const core = yield* Core.Service
      const config = yield* Config.Service
      const auth = yield* Auth.Service
      const cache = yield* ModelCache.Service

      const get = Effect.fn("ModelsDev.get")(function* () {
        const providers = overlay(yield* core.get())
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
          if (Object.keys(models).length === 0)
            yield* cache.refresh("apertis", aptOpts).pipe(Effect.ignore, Effect.forkDetach)
        })

        const pxlOpts = cfg.provider?.["perplexity-agent"]?.options
        const perplexityOpts = pxlOpts?.baseURL ? { baseURL: pxlOpts.baseURL } : {}

        // Perplexity Agent ships as an OpenAI-compatible endpoint whose model list
        // is stale in the models.dev snapshot. When a key is configured, fetch the
        // live list and merge it into the snapshot so already-known models keep
        // their bundled metadata (cost, context limits, modalities) while newly
        // published models become visible. Without a key the fetch resolves to {} and
        // the bundled snapshot is used unchanged; no network request is made.
        const addPerplexity = Effect.fnUntraced(function* () {
          const item = providers["perplexity-agent"]
          if (!item) return
          const models = yield* cache
            .fetch("perplexity-agent", perplexityOpts)
            .pipe(Effect.catch(() => Effect.succeed({})))
          if (Object.keys(models).length > 0) {
            providers["perplexity-agent"] = { ...item, models: { ...models, ...item.models } }
          }
        })

        if (!allowed) {
          yield* addApertis()
          yield* addPerplexity()
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
        yield* addPerplexity()
        return providers
      })

      return Service.of({ get, refresh: core.refresh })
    }),
  )

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() => AppNodeBuilder.build(node)) // kilocode_change - build from the LayerNode graph

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Core.node, Config.node, Auth.node, ModelCache.node],
})

export { AI_SDK_PROVIDERS, PROMPTS }
export * as ModelsDev from "./models"
