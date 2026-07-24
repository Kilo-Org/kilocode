import type { ModelMessage } from "ai"
import * as Stream from "effect/Stream"
import type { LLMEvent } from "@opencode-ai/llm"
import type { Logger } from "@opencode-ai/core/util/log"
import type { Provider } from "@/provider/provider"
import { KiloSessionOverflow } from "./overflow"

const SAFETY = 2048
const MIN_OUTPUT = 1024

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
   * client cannot see. The client-side media-normalized estimate (encoded bytes
   * excluded) is used as a floor so newly added text or tool schemas still cap
   * output, and as the sole basis on the first turn before any usage is reported.
   * The larger of the two is used so the cap never under-counts.
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
