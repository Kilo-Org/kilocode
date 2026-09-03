// kilocode_change - new file
//
// Kilo-specific provider logic extracted from packages/opencode/src/provider/provider.ts
// to minimize merge conflicts with upstream opencode.
//
// This module exports patch functions and data that the upstream provider.ts
// calls at well-defined injection points (each marked with kilocode_change).

import { createKilo, type KiloProvider, AI_SDK_PROVIDERS, PROMPTS } from "@kilocode/kilo-gateway"
import { DEFAULT_HEADERS } from "@/kilocode/const"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { optionalOmitUndefined } from "@opencode-ai/core/schema"
import { ProviderError } from "@/provider/error"
import { Effect, Schema } from "effect"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { mapValues, omit, pickBy } from "remeda"
import { reasoningSummary } from "./reasoning-summary"
import type { Provider } from "@/provider/provider"
import type { Auth } from "@/auth"
import type { Config } from "@/config/config"
import { organization, token } from "./catalog"

/** Default timeout (ms) for provider HTTP requests (connection phase). */
export const REQUEST_TIMEOUT_MS = 300_000 // 5 minutes

// ---------------------------------------------------------------------------
// Bundled providers
// ---------------------------------------------------------------------------

type BundledSDK = { languageModel(modelId: string): LanguageModelV3 }

export const KILO_BUNDLED_PROVIDERS: Record<string, () => Promise<(options: any) => BundledSDK>> = {
  "@kilocode/kilo-gateway": async () => createKilo as unknown as (options: any) => BundledSDK,
}

// ---------------------------------------------------------------------------
// Model schema extensions  (spread into Provider.Model Schema.Struct)
// ---------------------------------------------------------------------------

export const KILO_MODEL_SCHEMA_EXTENSIONS = {
  recommendedIndex: optionalOmitUndefined(Schema.Finite),
  prompt: Schema.optional(Schema.Literals(PROMPTS)),
  isFree: Schema.optional(Schema.Boolean),
  mayTrainOnYourPrompts: Schema.optional(Schema.Boolean),
  hasUserByokAvailable: Schema.optional(Schema.Boolean),
  terminalBench: optionalOmitUndefined(
    Schema.Struct({
      overallScore: Schema.Finite,
      avgAttemptCostUsd: Schema.Finite,
    }),
  ),
  autoRouting: optionalOmitUndefined(
    Schema.Struct({
      models: Schema.Array(Schema.String),
    }),
  ),
  ai_sdk_provider: Schema.optional(Schema.Literals(AI_SDK_PROVIDERS)),
}

// ---------------------------------------------------------------------------
// fromModelsDevModel patch — returns kilo-specific fields
// ---------------------------------------------------------------------------

export function patchModelsDevModel(providerID: string, source: any) {
  return {
    variants: providerID === "kilo" ? (source.variants ?? {}) : {},
    recommendedIndex: source.recommendedIndex,
    prompt: source.prompt,
    isFree: source.isFree,
    mayTrainOnYourPrompts: source.mayTrainOnYourPrompts,
    hasUserByokAvailable: source.hasUserByokAvailable,
    terminalBench: source.terminalBench,
    autoRouting: source.autoRouting,
    ai_sdk_provider: source.ai_sdk_provider,
    options: source.options ?? {},
  }
}

// ---------------------------------------------------------------------------
// Config model patch — merges kilo-specific fields from config + existing
// ---------------------------------------------------------------------------

export function patchConfigModel(cfg: any, existing: any) {
  return {
    recommendedIndex: cfg.recommendedIndex ?? existing?.recommendedIndex,
    prompt: cfg.prompt ?? existing?.prompt,
    isFree: cfg.isFree ?? existing?.isFree,
    mayTrainOnYourPrompts: cfg.mayTrainOnYourPrompts ?? existing?.mayTrainOnYourPrompts,
    hasUserByokAvailable: cfg.hasUserByokAvailable ?? existing?.hasUserByokAvailable,
    terminalBench: existing?.terminalBench,
    autoRouting: existing?.autoRouting,
    ai_sdk_provider: cfg.ai_sdk_provider ?? existing?.ai_sdk_provider,
    variants: cfg.variants
      ? mapValues(
          pickBy(cfg.variants, (v) => !!v && !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
      : {},
  }
}

const CUSTOM_PROVIDER_PACKAGES = new Set(["@ai-sdk/openai-compatible", "@ai-sdk/openai", "@ai-sdk/anthropic"])
const FALLBACK_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"]
type Variants = NonNullable<Provider.Model["variants"]>
type Generate = (model: Provider.Model) => Variants

export function customProviderVariants(model: Provider.Model, npm: unknown, generate: Generate): Variants {
  if (model.variants && Object.keys(model.variants).length > 0) return model.variants

  const supported = typeof npm === "string" && CUSTOM_PROVIDER_PACKAGES.has(npm) && model.api.npm === npm
  const variants = generate(model)
  if (Object.keys(variants).length > 0) return variants
  if (!model.capabilities.reasoning || !supported) return variants

  return Object.fromEntries(
    FALLBACK_EFFORTS.map((effort) => {
      if (npm === "@ai-sdk/anthropic") {
        return [effort, effort === "none" ? { thinking: { type: "disabled" } } : { effort }]
      }
      if (npm === "@ai-sdk/openai") {
        return [
          effort,
          {
            reasoningEffort: effort,
            reasoningSummary: reasoningSummary(model),
            include: ["reasoning.encrypted_content"],
          },
        ]
      }
      return [effort, { reasoningEffort: effort }]
    }),
  )
}

// ---------------------------------------------------------------------------
// Custom loaders (new or fully-replaced loaders)
// ---------------------------------------------------------------------------

type CustomDep = {
  auth: (id: string) => Effect.Effect<any | undefined>
  config: () => Effect.Effect<any>
  env: () => Effect.Effect<Record<string, string | undefined>>
  get: (key: string) => Effect.Effect<string | undefined>
}

// Mirrors upstream's CustomLoader return type so Object.entries preserves proper typing
type CustomLoaderResult = {
  autoload: boolean
  getModel?: (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
  vars?: (options: Record<string, any>) => Record<string, string>
  options?: Record<string, any>
  discoverModels?: () => Promise<Record<string, any>>
}

type CustomLoader = (provider: any) => Effect.Effect<CustomLoaderResult>

function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

function useLanguageModel(sdk: any) {
  return sdk.responses === undefined && sdk.chat === undefined
}

export function patchKiloProviderPrivacy(provider: { options?: Record<string, any> } | undefined, config: any) {
  if (!provider || config.hide_prompt_training_models !== true) return
  provider.options = { ...provider.options, dataCollection: "deny" }
}

export function patchKiloProviderAuth(
  provider: Provider.Info | undefined,
  config: Config.Info,
  info: Auth.Info | undefined,
) {
  if (!provider) return
  const options = config.provider?.kilo?.options
  const key = token(options, info)
  const org = organization(options, info)
  if (key !== undefined) provider.options.kilocodeToken = key
  if (org !== undefined) provider.options.kilocodeOrganizationId = org
}

export function publicKiloProvider(provider: Provider.Info): Provider.Info {
  if (provider.id !== "kilo") return provider
  return { ...provider, key: undefined, options: omit(provider.options, ["apiKey", "kilocodeToken"]) }
}

export function kiloCustomLoaders(dep: CustomDep): Record<string, CustomLoader> {
  return {
    "github-copilot-enterprise": () =>
      Effect.succeed({
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
          if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
          return shouldUseCopilotResponsesApi(modelID) ? sdk.responses(modelID) : sdk.chat(modelID)
        },
        options: {},
      }),

    kilo: Effect.fnUntraced(function* (input: any) {
      const env = yield* dep.env()
      const config = yield* dep.config()
      const hasKey = yield* Effect.gen(function* () {
        if (input.env.some((item: string) => env[item])) return true
        if (yield* dep.auth(input.id)) return true
        if (config.provider?.["kilo"]?.options?.apiKey) return true
        return false
      })

      const options: Record<string, string> = {}
      if (env.KILO_ORG_ID) {
        options.kilocodeOrganizationId = env.KILO_ORG_ID
      }
      if (config.hide_prompt_training_models === true) {
        options.dataCollection = "deny"
      }
      if (!hasKey) {
        options.apiKey = "anonymous"
      }

      return {
        autoload: Object.keys(input.models).length > 0,
        options,
        async getModel(sdk: KiloProvider, modelID: string) {
          const provider = input.models[modelID]?.ai_sdk_provider
          if (provider === "anthropic") return sdk.anthropic(modelID)
          if (provider === "openai") return sdk.openai(modelID)
          if (provider === "openai-compatible") return sdk.openaiCompatible(modelID)
          return sdk.languageModel(modelID)
        },
      }
    }),

    // Override opencode to prevent auto-connecting without credentials
    opencode: () =>
      Effect.succeed({
        autoload: false,
        options: { headers: DEFAULT_HEADERS },
      }),
  }
}

// ---------------------------------------------------------------------------
// Post-processing for custom loader results
// Patches options/headers for providers whose upstream loaders we don't fully
// replace but where specific values differ (headers, branding, env vars).
// ---------------------------------------------------------------------------

export function patchCustomLoaderResult(
  providerID: string,
  result: { options?: Record<string, any> },
  env: Record<string, string | undefined>,
) {
  if (!result.options) return

  switch (providerID) {
    case "openrouter":
    case "vercel":
    case "zenmux":
      result.options.headers = { ...result.options.headers, ...DEFAULT_HEADERS }
      break
    case "cerebras":
      result.options.headers = {
        ...result.options.headers,
        "X-Cerebras-3rd-Party-Integration": "kilo",
      }
      break
    case "azure": {
      // Extend env var lookup for Azure baseURL / resource name
      const url = result.options.baseURL ?? env["AZURE_OPENAI_ENDPOINT"]
      const resource = (() => {
        const name = result.options.resourceName
        if (typeof name === "string" && name.trim() !== "") return name
        return env["AZURE_RESOURCE_NAME"] ?? env["AZURE_OPENAI_RESOURCE_NAME"]
      })()
      if (url) {
        result.options.baseURL = url
        delete result.options.resourceName
      } else if (resource) {
        result.options.resourceName = resource
        delete result.options.baseURL
      }
      break
    }
    // gitlab User-Agent and cloudflare error message are patched inline
    // in provider.ts with single-line kilocode_change markers
  }
}

// ---------------------------------------------------------------------------
// getSmallModel helpers
// ---------------------------------------------------------------------------

export function kiloSmallModelPriority(providerID: string): string[] | undefined {
  if (providerID.startsWith("kilo")) return ["kilo-auto/small"]
  return undefined
}

// ---------------------------------------------------------------------------
// Fetch timeout wrappers
// Replaces AbortSignal.timeout() with a cancellable setTimeout+AbortController
// so the timer is cleared once response headers arrive, then hands the remaining
// deadline to wrapFirstByte until the body produces data. One configured
// `timeout` value bounds both phases together, so providers that accept a
// request and go silent cannot hang the agent loop, while healthy streaming
// responses are never aborted mid-stream.
// ---------------------------------------------------------------------------

/**
 * Resolves the configured request timeout in milliseconds. `timeout: false`
 * explicitly disables it (returns `undefined`); any other invalid, unset or
 * non-positive value falls back to {@link REQUEST_TIMEOUT_MS} so the wait for a
 * provider response is always bounded rather than left open-ended.
 */
export function requestTimeout(options: Record<string, any>): number | undefined {
  const ms = options["timeout"] ?? REQUEST_TIMEOUT_MS
  if (ms === false) return undefined
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) return ms
  return REQUEST_TIMEOUT_MS
}

export function buildTimeoutSignal(options: Record<string, any>): {
  signal: AbortSignal | undefined
  clear: () => void
} {
  const ms = requestTimeout(options)
  if (ms === undefined) return { signal: undefined, clear() {} }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), ms)
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer)
    },
  }
}

/**
 * Bounds the wait for the response body's first byte by `ms`.
 *
 * Response headers do not prove a live stream: a provider can answer 200 with
 * SSE headers and then never send data. The connection-phase timeout is cleared
 * as soon as headers arrive, so that state used to hang the agent loop forever
 * (the turn sits between step-finish and the next step-start with no error).
 *
 * Only the first byte is guarded. Once any data arrives the wrapper becomes a
 * passthrough, so idle gaps inside a streaming response (reasoning, buffering,
 * slow token generation) are never touched here and remain opt-in through
 * `chunkTimeout`.
 */
export function wrapFirstByte(res: Response, ms: number, ctl: AbortController) {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res

  const reader = res.body.getReader()
  let seen = false
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (seen) {
        const part = await reader.read()
        if (part.done) return ctrl.close()
        return ctrl.enqueue(part.value)
      }

      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new ProviderError.ResponseStreamError(`Provider sent no response data within ${ms}ms`)
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      seen = true
      if (part.done) return ctrl.close()
      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}
