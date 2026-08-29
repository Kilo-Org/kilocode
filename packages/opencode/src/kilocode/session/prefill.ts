import type { ModelMessage } from "ai"

const CONTINUE =
  "Continue if you have next steps, otherwise stop here. If the previous turn ended mid-task, resume from where it stopped."

function hasContent(message: ModelMessage) {
  if (typeof message.content === "string") return message.content.trim().length > 0
  if (!Array.isArray(message.content)) return false
  return message.content.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0
    if (part.type === "reasoning") return part.text.trim().length > 0
    // step-start is turn scaffolding (persisted by the message converter), not
    // content the model reads back; the provider types do not model it
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
   *    by a synthetic user continuation so the request is well-formed.
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
