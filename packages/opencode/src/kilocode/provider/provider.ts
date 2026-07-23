// kilocode_change - new file
//
// Kilo-specific provider logic extracted from packages/opencode/src/provider/provider.ts
// to minimize merge conflicts with upstream opencode.
//
// This module exports patch functions and data that the upstream provider.ts
// calls at well-defined injection points (each marked with kilocode_change).

import { ProviderError } from "@/provider/error"
import { createKilo, type KiloProvider, AI_SDK_PROVIDERS, PROMPTS } from "@kilocode/kilo-gateway"
import { DEFAULT_HEADERS } from "@/kilocode/const"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { optionalOmitUndefined } from "@opencode-ai/core/schema"
import { Effect, Schema } from "effect"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { mapValues, omit, pickBy } from "remeda"

/** Default timeout (ms) for provider HTTP requests (connection phase). */
export const REQUEST_TIMEOUT_MS = 300_000 // 5 minutes

/**
 * Pre-content (time-to-first-content) budget for raw SSE streams. Mirrors the
 * value of `KiloLLM.DEFAULT_FIRST_TOKEN_MS` in `src/kilocode/session/llm.ts` —
 * keep these two constants in sync if either ever changes.
 */
export const SSE_FIRST_TOKEN_MS = 300_000 // 5 minutes

/**
 * Resolves the pre-content timeout budget for `wrapSSEFirstContent`, mirroring
 * `KiloLLM.resolveFirstTokenMs` semantics: a positive finite `options.timeout`
 * wins; otherwise falls back to a positive finite provider `timeout`; otherwise
 * `SSE_FIRST_TOKEN_MS`. `false` / `0` / unset / invalid / non-finite all map to
 * the default, because a never-first-content hang must remain bounded.
 */
export function resolveSseFirstTokenMs(options: Record<string, any>, fallback: Record<string, any> = {}): number {
  const val = options["timeout"]
  if (typeof val === "number" && Number.isFinite(val) && val > 0) return val
  const fb = fallback["timeout"]
  if (typeof fb === "number" && Number.isFinite(fb) && fb > 0) return fb
  return SSE_FIRST_TOKEN_MS
}

// ---------------------------------------------------------------------------
// SSE first-content detection
// ---------------------------------------------------------------------------

type ContentEventResult = { found: boolean; carry: string }

/**
 * Returns `found: true` iff any COMPLETE SSE event in `text` has a `data:` line
 * whose JSON `choices[0].delta` carries `content`, `reasoning_content`, or
 * `tool_calls`. The last (incomplete) event is skipped — it will be re-checked
 * as the head of the next read's buffer.
 *
 * To bound memory usage, callers should replace `decoderBuf` with `carry`
 * after each call. `carry` is the trailing incomplete event fragment (the text
 * after the last `\n\n` boundary), so completed events are never retained or
 * re-scanned.
 */
export function looksLikeContentEvent(text: string): ContentEventResult {
  const events = text.split(/\r?\n\r?\n/)
  if (events.length <= 1) return { found: false, carry: text }

  const complete = events.slice(0, -1)
  for (const evt of complete) {
    const dataLines: string[] = []
    for (const line of evt.split(/\r?\n/)) {
      if (line.startsWith(":")) continue
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""))
      }
    }
    if (dataLines.length === 0) continue
    const payload = dataLines.join("\n")
    if (payload === "[DONE]") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== "object") continue
    const choices = (parsed as { choices?: unknown }).choices
    if (!Array.isArray(choices) || choices.length === 0) continue
    const delta = (choices[0] as { delta?: unknown })?.delta
    if (!delta || typeof delta !== "object") continue
    const d = delta as { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown }
    if (typeof d.content === "string" && d.content.length > 0) return { found: true, carry: "" }
    if (typeof d.reasoning_content === "string" && d.reasoning_content.length > 0) return { found: true, carry: "" }
    if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) return { found: true, carry: "" }
  }

  return { found: false, carry: events[events.length - 1] }
}

/**
 * Wraps an SSE `Response` body so that reads before the first content-bearing
 * `data:` event are bounded by `firstTokenMs`, while reads after content are
 * bounded by the per-chunk `chunkTimeout`. Original bytes are enqueued
 * untouched — the text decoder is observational only.
 *
 * This is the Kilo-specific first-content-aware layer; the upstream provider
 * calls it at the single `wrapSSE` injection point.
 *
 * Scope note: this is installed for every provider SDK built by `resolveSDK`,
 * but `looksLikeContentEvent` only recognizes the OpenAI chat-completions SSE
 * shape (`choices[0].delta` with `content` / `reasoning_content` /
 * `tool_calls`). For other provider-native shapes (Anthropic
 * `content_block_delta`, OpenAI Responses `response.output_text.delta`, Google
 * `candidates`, etc.) `seenContent` never flips, so pre-content reads remain
 * bounded by `firstTokenMs` (the request `timeout` budget) rather than by
 * `chunkTimeout` once content starts. This is intentional:
 *   (a) the stream is still bounded (no hang);
 *   (b) the provider-agnostic session-layer `KiloLLM.watchIterator` guards the
 *       main session path for all providers using normalized AI SDK parts;
 *   (c) treating the first arbitrary `data:` event as content would arm on
 *       OpenAI's immediate role-delta and reintroduce the #12467 false-positive;
 *   (d) this only arms when a positive provider-level `chunkTimeout` is
 *       configured (no built-in default).
 */
export function wrapSSEFirstContent(
  res: Response,
  chunkTimeout: number,
  ctl: AbortController,
  firstTokenMs: number,
): Response {
  if (typeof chunkTimeout !== "number" || chunkTimeout <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let decoderBuf = ""
  let seenContent = false

  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const budget = seenContent ? chunkTimeout : firstTokenMs
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new ProviderError.ResponseStreamError("SSE read timed out")
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, budget)

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

      if (part.done) {
        ctrl.close()
        return
      }

      if (!seenContent && part.value) {
        decoderBuf += decoder.decode(part.value, { stream: true })
        const result = looksLikeContentEvent(decoderBuf)
        if (result.found) {
          seenContent = true
        }
        decoderBuf = result.carry
      }

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
          if (provider === "alibaba") return sdk.alibaba(modelID)
          if (provider === "anthropic") return sdk.anthropic(modelID)
          if (provider === "mistral") return sdk.mistral(modelID)
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
