// kilocode_change - new file
//
// Morph auto model routing (https://docs.morphllm.com/sdk/components/router).
//
// When the user selects the "morph/auto" pseudo-model, each turn is first sent
// to Morph's multimodel router, which classifies the prompt and returns the
// best model among the providers the user has connected. The turn then runs
// directly against that provider with the user's own credentials — Morph only
// receives the routing prompt, never the full conversation or the reply.
//
// The pseudo-model is injected into the Morph catalog entry by
// Provider.fromModelsDevProvider via catalogModels(), and resolved to a
// concrete model in the session prompt loop (and compaction) via route().

import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "@/session/message-v2"

const log = Log.create({ service: "morph.router" })

export namespace KiloMorphRouter {
  export const PROVIDER_ID = "morph"
  export const MODEL_ID = "auto"
  export const MODEL_NAME = "Auto Router"

  const DEFAULT_BASE_URL = "https://api.morphllm.com/v1"
  const ROUTER_PATH = "/router/multimodel"
  const REQUEST_TIMEOUT_MS = 15_000
  // The router classifies the prompt; it does not need the full message.
  const MAX_INPUT_CHARS = 4_000
  const CACHE_LIMIT = 256

  export const POLICIES = ["balanced", "cost_efficient", "capability_heavy", "domain_skills"] as const
  export type Policy = (typeof POLICIES)[number]

  // Morph router provider name -> local provider id.
  const ROUTER_PROVIDERS: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    gemini: "google",
    deepseek: "deepseek",
  }

  // Preferred model per router provider, in order of preference. Used as the
  // router's `default_model` and as the local fallback when the router is
  // unreachable or returns a model the user cannot run.
  const FALLBACKS: [router: string, modelID: string][] = [
    ["anthropic", "claude-sonnet-4-6"],
    ["openai", "gpt-5.5"],
    ["gemini", "gemini-3.5-flash"],
    ["deepseek", "deepseek-v4-pro"],
  ]

  export type RouteOk = { type: "ok"; providerID: ProviderID; modelID: ModelID }
  export type RouteResult = RouteOk | { type: "error"; message: string }

  type RouterResponse = {
    model?: string
    provider?: string
    difficulty?: string
    confidence?: number
    domain?: string
  }

  export function isRouterModel(model: { providerID: string; modelID: string } | undefined): boolean {
    return model?.providerID === PROVIDER_ID && model?.modelID === MODEL_ID
  }

  /** Pseudo-models injected into a provider's catalog entry. */
  export function catalogModels(provider: { id: string; api?: string; npm?: string }): Record<string, Provider.Model> {
    if (provider.id !== PROVIDER_ID) return {}
    const auto: Provider.Model = {
      id: ModelID.make(MODEL_ID),
      providerID: ProviderID.make(PROVIDER_ID),
      name: MODEL_NAME,
      family: "morph-router",
      api: {
        id: MODEL_ID,
        url: provider.api ?? DEFAULT_BASE_URL,
        npm: provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: "active",
      headers: {},
      options: {},
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      // Conservative bound across routable models; the resolved model's real
      // limits apply once the turn is routed.
      limit: { context: 128_000, output: 16_384 },
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      release_date: "2026-06-11",
      variants: {},
    }
    return { [MODEL_ID]: auto }
  }

  /** Router provider names the user can route to (connected, with models). */
  export function candidates(providers: Record<string, Provider.Info>): string[] {
    return Object.entries(ROUTER_PROVIDERS)
      .filter(([, local]) => {
        const info = providers[local]
        return !!info && Object.keys(info.models).length > 0
      })
      .map(([router]) => router)
  }

  /** Resolve a router-returned model id against a local provider's models. */
  export function resolveLocalModel(info: Provider.Info | undefined, modelID: string): string | undefined {
    if (!info) return undefined
    if (info.models[modelID]) return modelID
    // Tolerate version-suffix drift, e.g. "claude-haiku-4-5" vs "claude-haiku-4-5-20251001".
    const keys = Object.keys(info.models).sort((a, b) => a.length - b.length)
    return keys.find((k) => k.startsWith(modelID)) ?? keys.find((k) => modelID.startsWith(k))
  }

  export function mapResponse(
    providers: Record<string, Provider.Info>,
    response: RouterResponse,
    allowed: string[],
  ): RouteOk | undefined {
    const model = typeof response.model === "string" ? response.model : undefined
    if (!model) return undefined
    const routerProvider = typeof response.provider === "string" ? response.provider : undefined
    const order = routerProvider && ROUTER_PROVIDERS[routerProvider] ? [routerProvider] : allowed
    for (const router of order) {
      const local = ROUTER_PROVIDERS[router]
      const resolved = resolveLocalModel(providers[local], model)
      if (resolved) return { type: "ok", providerID: ProviderID.make(local), modelID: ModelID.make(resolved) }
    }
    return undefined
  }

  export function defaultSelection(
    providers: Record<string, Provider.Info>,
    allowed: string[],
  ): RouteOk | undefined {
    for (const [router, modelID] of FALLBACKS) {
      if (!allowed.includes(router)) continue
      const resolved = resolveLocalModel(providers[ROUTER_PROVIDERS[router]], modelID)
      if (resolved)
        return { type: "ok", providerID: ProviderID.make(ROUTER_PROVIDERS[router]), modelID: ModelID.make(resolved) }
    }
    for (const router of allowed) {
      const local = ROUTER_PROVIDERS[router]
      const first = Object.keys(providers[local]?.models ?? {})[0]
      if (first) return { type: "ok", providerID: ProviderID.make(local), modelID: ModelID.make(first) }
    }
    return undefined
  }

  /** The router's `default_model` must be a Morph-catalog id within the allowed filter. */
  export function defaultModel(allowed: string[]): string | undefined {
    return FALLBACKS.find(([router]) => allowed.includes(router))?.[1]
  }

  /** Latest real user prompt text, truncated for classification. */
  export function promptText(messages: MessageV2.WithParts[]): string {
    const lastUser = messages.findLast(
      (m) =>
        m.info.role === "user" && m.parts.some((p) => p.type === "text" && !p.synthetic && p.text.trim().length > 0),
    )
    if (!lastUser) return ""
    return lastUser.parts
      .flatMap((p) => (p.type === "text" && !p.synthetic && p.text.trim().length > 0 ? [p.text] : []))
      .join("\n")
      .slice(0, MAX_INPUT_CHARS)
  }

  export function apiKey(info: Provider.Info | undefined): string | undefined {
    if (!info) return undefined
    const fromOptions = info.options?.["apiKey"]
    if (typeof fromOptions === "string" && fromOptions.length > 0) return fromOptions
    return info.key || undefined
  }

  export function policy(info: Provider.Info | undefined): Policy {
    const raw = info?.options?.["routerPolicy"]
    return POLICIES.includes(raw) ? raw : "balanced"
  }

  function baseURL(info: Provider.Info | undefined): string {
    const raw = info?.options?.["baseURL"]
    if (typeof raw === "string" && raw.length > 0) return raw
    return DEFAULT_BASE_URL
  }

  const cache = new Map<string, RouteOk>()

  function remember(messageID: string, value: RouteOk) {
    cache.set(messageID, value)
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }

  const request = Effect.fn("KiloMorphRouter.request")(function* (input: {
    baseURL: string
    apiKey: string
    body: Record<string, unknown>
  }) {
    return yield* Effect.tryPromise({
      try: async (): Promise<RouterResponse> => {
        const res = await fetch(input.baseURL.replace(/\/+$/, "") + ROUTER_PATH, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input.body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`Morph router responded with status ${res.status}`)
        const json = await res.json()
        if (!json || typeof json !== "object") throw new Error("Morph router returned an invalid response")
        return json as RouterResponse
      },
      catch: (cause) => new Error(String(cause)),
    })
  })

  /**
   * Resolve the "morph/auto" pseudo-model to a concrete provider/model.
   * Results are cached per user-message id, so a multi-step turn (and its
   * compaction) issues a single router request. Never throws: router/network
   * failures degrade to a fallback model; only a missing key or the absence
   * of any routable provider yields an error result.
   */
  export const route = Effect.fn("KiloMorphRouter.route")(function* (input: {
    providers: Record<string, Provider.Info>
    messages: MessageV2.WithParts[]
    messageID: string
  }) {
    const cached = cache.get(input.messageID)
    if (cached) return cached as RouteResult

    const morph = input.providers[PROVIDER_ID]
    const key = apiKey(morph)
    if (!key)
      return {
        type: "error",
        message: "Morph Auto Router: no Morph API key found. Connect the Morph provider with an API key.",
      } as RouteResult

    const allowed = candidates(input.providers)
    if (allowed.length === 0)
      return {
        type: "error",
        message: `Morph Auto Router: no routable provider is connected. Connect at least one of: ${Object.values(ROUTER_PROVIDERS).join(", ")}.`,
      } as RouteResult

    const fallback = defaultSelection(input.providers, allowed)
    if (!fallback)
      return {
        type: "error",
        message: "Morph Auto Router: connected providers expose no usable models.",
      } as RouteResult

    let selection = fallback
    const text = promptText(input.messages)
    if (text) {
      const response = yield* request({
        baseURL: baseURL(morph),
        apiKey: key,
        body: {
          input: text,
          allowed_providers: allowed,
          policy: policy(morph),
          default_model: defaultModel(allowed),
        },
      }).pipe(
        Effect.catch((error) => {
          log.warn("router request failed, using fallback model", { error: String(error) })
          return Effect.succeed(undefined)
        }),
      )
      if (response) {
        const mapped = mapResponse(input.providers, response, allowed)
        if (mapped) {
          selection = mapped
          log.info("routed", {
            model: response.model,
            provider: response.provider,
            difficulty: response.difficulty,
            domain: response.domain,
          })
        } else {
          log.warn("router picked an unavailable model, using fallback", {
            model: response.model,
            provider: response.provider,
          })
        }
      }
    }

    remember(input.messageID, selection)
    return selection as RouteResult
  })

  /** Test hook: clear the per-message route cache. */
  export function resetCache() {
    cache.clear()
  }
}
