import type { ModelMessage } from "ai"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import type { Provider } from "@/provider/provider"
import type { Event } from "@/session/llm"
import { Token } from "@/util/token"

// Token.estimate consistently under-counts by ~15-30% vs. actual provider tokenizers.
// Multiply all estimates by this factor and add a fixed safety margin to compensate.
const ESTIMATE_FACTOR = 1.3
const SAFETY = 2048
const MIN_OUTPUT = 1024

export namespace KiloLLM {
  // Preserve error and abort events while collecting text so Kilo callers can detect failed generations.
  export function text(stream: Stream.Stream<Event, unknown>) {
    return stream.pipe(
      Stream.mapEffect((event) => {
        if (event.type === "error") return Effect.fail(event.error)
        if (event.type === "abort") return Effect.fail(new DOMException("Aborted", "AbortError"))
        if (event.type !== "text-delta") return Effect.succeed("")
        return Effect.succeed(event.text)
      }),
      Stream.mkString,
    )
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
  }): number | undefined {
    if (input.configured == null) return input.configured
    if (input.configured <= 0) return undefined
    const { context } = input.model.limit
    if (!context) return input.configured

    const msgTokens = Math.ceil(Token.estimate(JSON.stringify(input.messages)) * ESTIMATE_FACTOR)
    const toolTokens = Math.ceil(
      Token.estimate(
        JSON.stringify(
          Object.entries(input.tools).map(([name, t]) => ({
            name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        ),
      ) * ESTIMATE_FACTOR,
    )

    const available = context - msgTokens - toolTokens - SAFETY
    // If available is ≤0 the input alone exceeds context — return the original
    // value so the provider returns a natural overflow error which triggers
    // compaction (compactionAttempts guard stops the loop eventually).
    if (available <= 0) return input.configured
    if (available >= input.configured) return input.configured
    return Math.max(MIN_OUTPUT, available)
  }
}
