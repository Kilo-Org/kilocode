/**
 * Collects the renderable assistant content items of a v2 session.
 *
 * Keys match the `data-part-id` attribute in `v2/assistant.tsx`, so the
 * transcript can highlight and scroll to the part behind a timeline bar.
 */

import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import type { TimelinePart } from "./types"

const SUPPRESSED_TOOLS = new Set(["todowrite", "todoread"])

function toolOutputLength(state: SessionMessageAssistantTool["state"]): number {
  if (state.status !== "completed") return 0
  const texts = state.content.flatMap((item) => (item.type === "text" ? [item.text] : []))
  return texts.reduce((sum, text) => sum + text.length, 0) + Math.max(0, texts.length - 1)
}

/** One renderable content item, or undefined when the item is suppressed. */
export function timelinePart(
  message: SessionMessageAssistant,
  item: SessionMessageAssistant["content"][number],
  index: number,
): TimelinePart | undefined {
  if (!renderable(item)) return undefined
  if (item.type === "text") {
    return { type: "text", key: partKey(message.id, item, index), messageID: message.id, text: item.text }
  }
  if (item.type === "reasoning") {
    return { type: "reasoning", key: partKey(message.id, item, index), messageID: message.id, text: item.text }
  }
  return {
    type: "tool",
    key: partKey(message.id, item, index),
    messageID: message.id,
    name: item.name,
    status: item.state.status,
    input: item.state.input,
    outputLength: toolOutputLength(item.state),
  }
}

/** The `data-part-id` of a content item. Tools have their own id; other parts use the message id and index. */
export function partKey(messageID: string, item: SessionMessageAssistant["content"][number], index: number): string {
  return item.type === "tool" ? item.id : `${messageID}:${index}`
}

/** Whether an assistant content item produces a timeline bar. */
export function renderable(item: SessionMessageAssistant["content"][number]): boolean {
  if (item.type === "text") return item.text.trim().length > 0
  if (item.type === "reasoning") return item.text.replace("[REDACTED]", "").trim().length > 0
  return !SUPPRESSED_TOOLS.has(item.name) || item.state.status === "completed"
}

export function timelineParts(messages: readonly SessionMessageInfo[]): TimelinePart[] {
  return messages.flatMap((message) =>
    message.type === "assistant"
      ? message.content.flatMap((item, index) => {
          const part = timelinePart(message, item, index)
          return part ? [part] : []
        })
      : [],
  )
}
