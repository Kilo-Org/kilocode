import type { ModelMessage } from "ai"
import * as Stream from "effect/Stream"
import type { LLMEvent } from "@opencode-ai/llm"
import type { Logger } from "@opencode-ai/core/util/log"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { KiloSessionOverflow } from "./overflow"

const SAFETY = 2048
const MIN_OUTPUT = 1024
const CLAUDE = new Set([
  "@kilocode/kilo-gateway",
  "@ai-sdk/anthropic",
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/google-vertex/anthropic",
])

export namespace KiloLLM {
  // Stream failures and interruptions propagate while text deltas are collected.
  export function text(stream: Stream.Stream<LLMEvent, unknown>) {
    return stream.pipe(
      Stream.map((event) => (event.type === "text-delta" ? event.text : "")),
      Stream.mkString,
    )
  }

  export function timeout(input: {
    options: Record<string, unknown>
    fallback?: Record<string, unknown>
    log?: Pick<Logger, "debug">
  }): { timeout?: { chunkMs: number } } {
    const value =
      typeof input.options["chunkTimeout"] === "number"
        ? input.options["chunkTimeout"]
        : typeof input.fallback?.["chunkTimeout"] === "number"
          ? input.fallback["chunkTimeout"]
          : undefined
    if (!value) return {}
    input.log?.debug("chunk idle timeout configured", { chunkTimeout: value })
    return { timeout: { chunkMs: value } }
  }

  /**
   * Requested output tokens for one step.
   *
   * Claude counts thinking tokens inside `max_tokens`. With adaptive thinking
   * there is no separate budget that the AI SDK adds on top, so the shared
   * 32k default can be used up by thinking before any text or tool call is
   * written. For Claude on first-party routes, request the model's output
   * limit instead. `max_tokens` is a ceiling, not a cache key, so this does
   * not change cost or prompt caching.
   *
   * The shared default stays in place when the user sets
   * KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX, for small requests, for other
   * providers, and when an explicit thinking budget is set (the SDK adds
   * that budget to `max_tokens` itself).
   */
  export function outputTokens(input: {
    model: Provider.Model
    options: Record<string, any>
    max: number | undefined
    small?: boolean
  }) {
    const base = ProviderTransform.maxOutputTokens(input.model, input.max)
    if (input.max !== undefined || input.small) return base
    if (!CLAUDE.has(input.model.api.npm)) return base
    if (!input.model.api.id.toLowerCase().includes("claude")) return base
    if (typeof input.options.thinking?.budgetTokens === "number") return base
    if (typeof input.options.reasoningConfig?.budgetTokens === "number") return base
    return Math.max(base, input.model.limit.output)
  }

  export function needsEstimate(input: { model: Provider.Model; configured: number | undefined }) {
    return input.configured !== undefined && input.configured > 0 && input.model.limit.context > 0
  }

  /**
   * Caps `maxOutputTokens` to fit within the model's context window after
   * accounting for the context the outgoing request will consume.
   *
   * Like opencode, the provider is the source of truth: when the last finished
   * turn reported usage, `reported` carries that provider-tokenized context size
   * (input + output + cache), which already accounts for image/vision input the
   * client cannot see. The client-side normalized estimate (encoded media and
   * opaque reasoning-state bytes excluded) is used as a floor so newly added
   * text or tool schemas still cap output, and as the sole basis on the first
   * turn before any usage is reported. The larger of the two is used so the cap
   * never under-counts.
   *
   * Many small models (e.g. qwen 7B, 32K context) ship with a default
   * max_output of 32K, leaving no room for input once tools are included.
   * This prevents the provider from rejecting the request with a context
   * overflow error.
   */
  export function capOutputTokens(input: {
    model: Provider.Model
    messages: ModelMessage[]
    tools: Record<string, { description?: string; inputSchema?: unknown }>
    configured: number | undefined
    usage?: ReturnType<typeof KiloSessionOverflow.measure>
    reported?: number
  }): number | undefined {
    if (input.configured == null) return input.configured
    if (input.configured <= 0) return undefined
    const { context } = input.model.limit
    if (!context) return input.configured

    const estimated =
      input.usage?.normalized ??
      KiloSessionOverflow.measure({ messages: input.messages, tools: input.tools }).normalized
    const tokens = Math.max(input.reported ?? 0, estimated)
    const available = context - tokens - SAFETY
    // If available is ≤0 the input alone exceeds context — return the original
    // value so the provider returns a natural overflow error which triggers
    // compaction (compactionAttempts guard stops the loop eventually).
    if (available <= 0) return input.configured
    if (available >= input.configured) return input.configured
    return Math.max(MIN_OUTPUT, available)
  }
}
