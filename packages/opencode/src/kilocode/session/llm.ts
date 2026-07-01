import type { ModelMessage } from "ai"
import * as Stream from "effect/Stream"
import type { LLMEvent } from "@opencode-ai/llm"
import type { Logger } from "@opencode-ai/core/util/log"
import type { Provider } from "@/provider/provider"
import { KiloSessionOverflow } from "./overflow"

const SAFETY = 2048
const MEDIA_OUTPUT_RESERVE = 2048
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
   * accounting for the actual estimated input tokens (messages + tool schemas).
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
    contextTokens?: number
    contextMedia?: number
  }): number | undefined {
    if (input.configured == null) return input.configured
    if (input.configured <= 0) return undefined
    const { context } = input.model.limit
    if (!context) return input.configured

    const usage =
      input.contextTokens === undefined || input.contextMedia === undefined
        ? KiloSessionOverflow.measure({ messages: input.messages, tools: input.tools })
        : undefined
    const tokens = input.contextTokens ?? usage?.normalized ?? 0
    const media = input.contextMedia ?? usage?.media ?? 0
    const available = context - tokens - media * MEDIA_OUTPUT_RESERVE - SAFETY
    // If available is ≤0 the input alone exceeds context — return the original
    // value so the provider returns a natural overflow error which triggers
    // compaction (compactionAttempts guard stops the loop eventually).
    if (available <= 0) return input.configured
    if (available >= input.configured) return input.configured
    return Math.max(MIN_OUTPUT, available)
  }
}
