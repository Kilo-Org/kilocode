// kilocode_change - new file
//
// Kilo-specific provider logic extracted from packages/opencode/src/provider/provider.ts
// to minimize merge conflicts with upstream opencode.
//
// This module exports patch functions and data that the upstream provider.ts
// calls at well-defined injection points (each marked with kilocode_change).

import { createKilo, type KiloProvider } from "@kilocode/kilo-gateway"
import { DEFAULT_HEADERS } from "@/kilocode/const"
import { AiSdkProvider, Prompt } from "@/provider/models"
import { Env } from "@/env"
import { ProviderID, ModelID } from "@/provider/schema"
import z from "zod"
import { Effect } from "effect"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { mapValues, omit, pickBy } from "remeda"

// Re-export for consumers that previously imported from provider.ts
export { Prompt, AiSdkProvider }

/** Default timeout (ms) for provider HTTP requests (connection phase). */
export const REQUEST_TIMEOUT_MS = 120_000 // 2 minutes

// ---------------------------------------------------------------------------
// Bundled providers
// ---------------------------------------------------------------------------

type BundledSDK = { languageModel(modelId: string): LanguageModelV3 }

export const KILO_BUNDLED_PROVIDERS: Record<string, (options: any) => BundledSDK> = {
  "@kilocode/kilo-gateway": createKilo as unknown as (options: any) => BundledSDK,
}

// ---------------------------------------------------------------------------
// Model schema extensions  (spread into Provider.Model via .extend())
// ---------------------------------------------------------------------------

export const KILO_MODEL_SCHEMA_EXTENSIONS = {
  recommendedIndex: z.number().optional(),
  prompt: Prompt.optional().catch(undefined),
  isFree: z.boolean().optional(),
  ai_sdk_provider: AiSdkProvider.optional(),
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
    ai_sdk_provider: source.ai_sdk_provider,
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
    ai_sdk_provider: cfg.ai_sdk_provider ?? existing?.ai_sdk_provider,
    variants: cfg.variants
      ? mapValues(
          pickBy(cfg.variants, (v) => !!v && !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
      : {},
  }
}

// ---------------------------------------------------------------------------
// Custom loaders (new or fully-replaced loaders)
// ---------------------------------------------------------------------------

type CustomDep = {
  auth: (id: string) => Effect.Effect<any | undefined>
  config: () => Effect.Effect<any>
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
      const env = Env.all()
      const hasKey = yield* Effect.gen(function* () {
        if (input.env.some((item: string) => env[item])) return true
        if (yield* dep.auth(input.id)) return true
        if ((yield* dep.config()).provider?.["kilo"]?.options?.apiKey) return true
        return false
      })

      if (!hasKey) {
        for (const [key, value] of Object.entries(input.models)) {
          if ((value as any).cost.input === 0) continue
          delete input.models[key]
        }
      }

      const options: Record<string, string> = {}
      if (env.KILO_ORG_ID) {
        options.kilocodeOrganizationId = env.KILO_ORG_ID
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

export function patchCustomLoaderResult(providerID: string, result: { options?: Record<string, any> }) {
  if (!result.options) return

  switch (providerID) {
    case "anthropic": {
      // Prepend claude-code beta flag to the anthropic-beta header
      // TODO: Add adaptive thinking headers when @ai-sdk/anthropic supports it:
      // adaptive-thinking-2026-01-28,effort-2025-11-24,max-effort-2026-01-24
      const existing = result.options.headers?.["anthropic-beta"] ?? ""
      const prefix = "claude-code-20250219"
      if (!existing.includes(prefix)) {
        result.options.headers = {
          ...result.options.headers,
          "anthropic-beta": existing ? `${prefix},${existing}` : prefix,
        }
      }
      break
    }
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
      const url = result.options.baseURL ?? Env.get("AZURE_OPENAI_ENDPOINT")
      const resource = (() => {
        const name = result.options.resourceName
        if (typeof name === "string" && name.trim() !== "") return name
        return Env.get("AZURE_RESOURCE_NAME") ?? Env.get("AZURE_OPENAI_RESOURCE_NAME")
      })()
      if (url) {
        result.options.baseURL = url
      } else if (resource) {
        result.options.resourceName = resource
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
// Fetch timeout wrapper
// Replaces AbortSignal.timeout() with a cancellable setTimeout+AbortController
// so the timer is cleared once response headers arrive. This prevents healthy
// streaming responses from being aborted mid-stream.
// ---------------------------------------------------------------------------

export function buildTimeoutSignal(options: Record<string, any>): {
  signal: AbortSignal | undefined
  clear: () => void
} {
  const ms = options["timeout"] ?? REQUEST_TIMEOUT_MS
  if (ms === false || ms === undefined || ms === null) return { signal: undefined, clear() {} }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    ms as number,
  )
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer)
    },
  }
}
