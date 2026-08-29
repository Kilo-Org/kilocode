import type { ModelMessage } from "ai"

const CONTINUE = "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."

function visibleText(text: unknown) {
  return typeof text === "string" && text.trim().length > 0
}

function hasContent(message: ModelMessage) {
  if (typeof message.content === "string") return message.content.trim().length > 0
  if (!Array.isArray(message.content)) return false
  return message.content.some((part) => {
    if (part.type === "text") return visibleText(part.text)
    if (part.type === "reasoning") {
      return (
        visibleText(part.text) ||
        part.providerOptions?.anthropic?.signature != null ||
        part.providerOptions?.anthropic?.redactedData != null ||
        part.providerOptions?.bedrock?.signature != null ||
        part.providerOptions?.bedrock?.redactedData != null
      )
    }
    // step-start is turn scaffolding (the AI SDK converter strips it and splits
    // the turn on it), not content the model reads back; the provider types do
    // not model it, so it is matched by string
    if ((part.type as string) === "step-start") return false
    return true
  })
}

export namespace KiloPrefill {
  /**
   * Anthropic (Claude 4.6+, Opus 5) rejects requests whose `messages` array ends
   * with an assistant message ("assistant message prefill" 400), losing the turn
   * with no retry. Any history tail that projects to an assistant-terminated
   * array — a filtered-out user message, a crashed mid-reasoning turn, a
   * dangling scaffold — trips it.
   *
   * Guarantee the outbound array ends with a user or tool message:
   *  - trailing assistant messages that carry no visible content are dropped
   *    (turn scaffolding providers refuse or ignore);
   *  - a trailing assistant that does carry content is preserved and followed
   *    by a synthetic user continuation so the request is well-formed. The
   *    continuation is request-only and never persisted to the session.
   */
  export function ensureUserTail(messages: ModelMessage[]): ModelMessage[] {
    const last = messages.at(-1)
    if (last && (last.role === "user" || last.role === "tool")) return messages
    let end = messages.length
    while (end > 0 && messages[end - 1]?.role === "assistant" && !hasContent(messages[end - 1])) end--
    if (end === messages.length) return [...messages, { role: "user", content: CONTINUE }]
    const kept = messages.slice(0, end)
    const tail = kept.at(-1)
    if (tail && (tail.role === "user" || tail.role === "tool")) return kept
    return [...kept, { role: "user", content: CONTINUE }]
  }
}
