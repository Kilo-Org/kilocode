/**
 * Repairs two assistant-message shapes that Anthropic's /v1/messages endpoint
 * rejects. Both are produced here rather than by any single caller, because
 * `convertToModelMessages` splits an assistant UI message at every `step-start`
 * boundary, so no upstream filter operating on whole UI messages can see them.
 * This guard runs after conversion, on the exact array that goes over the wire.
 *
 * Shape 1 - a trailing assistant turn containing nothing but a thinking block:
 *
 *   "The final block in an assistant message cannot be `thinking`."
 *
 * A turn persisted as
 *
 *   text, tool, step-finish, step-start, reasoning
 *
 * splits into assistant[text, tool-call] / tool[tool-result] /
 * assistant[reasoning]. That last fragment is a dangling step: it carries no
 * committed output, so dropping it is lossless.
 *
 * Shape 2 - inverted block order inside a single assistant message:
 *
 *   step-start, reasoning, tool, step-finish, text
 *
 * Here the text part carries a PartID minted long after the tool part (observed
 * lag 76-113s), so it sorts last, yet its own `time.end` precedes the tool
 * part's creation - the text really streamed first. Because no `step-start`
 * separates it, the split never happens and the text stays in the same
 * assistant message as the tool-call, emitting assistant[tool_use, text].
 * `reorderAssistantContent` repairs it by restoring the original chronology.
 *
 * Position matters, and the evidence is unusually clean. In the captured
 * failing request (243 messages, 121 assistant turns) two messages carried the
 * defect: index 99 and index 241. Index 99 was already present in the very
 * first captured request of that session and rode along in all 101 subsequent
 * requests - every one of which returned 200. Only index 241, the *final*
 * assistant message, drew the 400. A malformed turn buried in history is
 * therefore harmless; the API rejects it only in the last assistant position.
 *
 * We nevertheless repair every assistant message, not just the last, because
 * compaction and context truncation can promote a historical message into the
 * final position, converting a latent defect into a hard failure at an
 * arbitrary later turn. The transform is deterministic, so the rewritten
 * prefix is stable across requests: it costs at most one prompt-cache
 * invalidation the first time a given session is sent, then re-stabilizes.
 *
 * Deliberately NOT handled: a trailing assistant turn carrying real committed
 * output. An earlier revision of this file also dropped those, on the theory
 * that Claude 4.6+ refuses all last-turn prefill ("This model does not support
 * assistant message prefill. The conversation must end with a user message.").
 * That was over-reach, and it was wrong twice over. It is unsupported - the
 * captured 400 ended with a user/tool_result message, so that error was caused
 * by Shape 2, not by a trailing turn - and it is destructive: `toModelMessages`
 * is a general-purpose conversion used by compaction, title generation and
 * plan follow-up, all of which legitimately convert histories that end with an
 * assistant turn. Discarding that content silently truncated their input and
 * broke eight upstream `session.message-v2` tests that assert the conversion
 * contract. Real output is now always preserved; only genuinely empty turns
 * are dropped.
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

function isNonEmptyText(part: Part): boolean {
  return part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0
}

/**
 * Move any `text` block that follows the first `tool-call` back in front of it,
 * preserving the relative order of the moved blocks. Reasoning and every other
 * block keep their positions, so a leading signed thinking block stays leading.
 * Empty/whitespace-only text after a tool-call is dropped rather than moved:
 * Anthropic rejects empty text blocks, and such a block carries no output.
 *
 * Returns undefined when nothing needs to change, so callers can avoid
 * rebuilding messages that are already well-formed.
 */
function reorderAssistantContent(content: Part[]): Part[] | undefined {
  const firstTool = content.findIndex((part) => part.type === "tool-call")
  if (firstTool === -1) return undefined

  const tail = content.slice(firstTool + 1)
  if (!tail.some((part) => part.type === "text")) return undefined

  const head = content.slice(0, firstTool)
  const moved = tail.filter(isNonEmptyText)
  const kept = tail.filter((part) => part.type !== "text")

  return [...head, ...moved, content[firstTool], ...kept]
}

export namespace KiloTrailingAssistant {
  export function sanitize(messages: ModelMessage[]): ModelMessage[] {
    const out = messages.slice()

    // Pass 1 - repair intra-message block order for every assistant message.
    // This must run before the trailing-turn pass: dropping a trailing turn
    // does not help when the malformed message sits mid-array.
    for (let i = 0; i < out.length; i++) {
      const msg = out[i]
      if (msg.role !== "assistant") continue
      const content: unknown = (msg as { content?: unknown }).content
      if (!Array.isArray(content)) continue
      const reordered = reorderAssistantContent(content as Part[])
      if (reordered) out[i] = { ...msg, content: reordered } as ModelMessage
    }

    // Pass 2 - drop empty trailing assistant turns, and make sure a surviving
    // one does not end on a thinking block. Never discards real output.
    while (out.length > 0) {
      const last = out[out.length - 1]
      if (last.role !== "assistant") break

      const content: unknown = (last as { content?: unknown }).content

      // String content is real output unless it is blank.
      if (typeof content === "string") {
        if (content.trim().length > 0) break
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

      // (2) Real output is kept, but the final block still may not be
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
