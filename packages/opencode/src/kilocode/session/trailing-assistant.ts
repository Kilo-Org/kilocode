/**
 * Anthropic rejects any /v1/messages request whose `messages` array ends with
 * an assistant turn:
 *
 *   - "The final block in an assistant message cannot be `thinking`."
 *   - "This model does not support assistant message prefill.
 *      The conversation must end with a user message."  (Claude 4.6+ / Opus 5)
 *
 * Both share one precondition: a trailing assistant message we never intended
 * to send. They are produced here rather than by any single caller, because
 * `convertToModelMessages` splits an assistant UI message at every `step-start`
 * boundary. A turn persisted as
 *
 *   text, tool, step-finish, step-start, reasoning
 *
 * splits into assistant[text, tool-call] / tool[tool-result] /
 * assistant[reasoning] - a trailing thinking-only turn. Upstream filters run on
 * whole UI messages *before* that split, so they cannot see it.
 *
 * This guard runs after conversion, on the exact array that goes over the wire.
 */

import type { ModelMessage } from "ai"

type Part = { type: string; text?: string }

/**
 * A part that represents real, committed model output. Reasoning is excluded:
 * a thinking block alone is not a turn, and Anthropic's adaptive thinking emits
 * signed blocks whose `text` is empty, so length is not a usable signal.
 */
function isCommitted(part: Part): boolean {
  switch (part.type) {
    case "tool-call":
    case "tool-result":
    case "file":
      return true
    case "text":
      return typeof part.text === "string" && part.text.trim().length > 0
    default:
      return false
  }
}

export namespace KiloTrailingAssistant {
  export type Options = {
    /** False for models that removed last-turn prefill (Claude 4.6+, Opus 5). */
    allowPrefill?: boolean
  }

  export function sanitize(messages: ModelMessage[], options?: Options): ModelMessage[] {
    const allowPrefill = options?.allowPrefill ?? false
    const out = messages.slice()

    while (out.length > 0) {
      const last = out[out.length - 1]
      if (last.role !== "assistant") break

      const content: unknown = (last as { content?: unknown }).content

      // String content: keep only if non-empty and prefill is permitted.
      if (typeof content === "string") {
        if (allowPrefill && content.trim().length > 0) break
        out.pop()
        continue
      }

      if (!Array.isArray(content)) break
      const parts = content as Part[]

      // (1) No committed output - a dangling step. Drop it entirely. This is
      //     lossless: there is nothing here but an unterminated thinking block.
      if (!parts.some(isCommitted)) {
        out.pop()
        continue
      }

      // (2) Real content, but prefill is unsupported - the turn must not be last.
      if (!allowPrefill) {
        out.pop()
        continue
      }

      // (3) Intentional, supported prefill: the final block still may not be
      //     `thinking`. Strip trailing reasoning only.
      let end = parts.length
      while (end > 0 && parts[end - 1].type === "reasoning") end--
      if (end !== parts.length) {
        out[out.length - 1] = { ...last, content: parts.slice(0, end) } as ModelMessage
      }
      break
    }

    return out
  }
}
