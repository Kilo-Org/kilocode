// Read the current todo list of a session from its messages. This module stays free of UI imports so tests can use it.
import type { SessionMessageInfo } from "@opencode/client"
import type { TodoItem } from "../components/chat/todo/todo-dock"

const STATUS = new Set<TodoItem["status"]>(["pending", "in_progress", "completed", "cancelled"])

function items(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: TodoItem[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined
    const content = "content" in item ? item.content : undefined
    const status = "status" in item ? item.status : undefined
    if (typeof content !== "string" || typeof status !== "string" || !STATUS.has(status as TodoItem["status"]))
      return undefined
    result.push({ content, status: status as TodoItem["status"] })
  }
  return result
}

/**
 * The current list of one session: the todos of its latest completed todowrite
 * call, the message of that call, and the latest real user message. A synthetic
 * message is not a new run, so it is not a boundary. A staged revert hides the
 * messages and parts it would remove. `last` is the write that produced
 * `items`, so a running or reverted write cannot revive a finished list.
 */
export function todoState(
  messages: ReadonlyArray<SessionMessageInfo>,
  revert?: { messageID: string; partID?: string },
) {
  const cut = boundary(messages, revert)
  const user = messages.findLast(
    (message, index) => message.type === "user" && side(message.id, index, cut, revert) === "before",
  )?.id
  // Walk from the newest message so a long transcript stops at the latest write
  // instead of rescanning the whole history on every streaming update.
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type !== "assistant") continue
    const parts = active(message, side(message.id, index, cut, revert), revert)
    for (let part = parts.length - 1; part >= 0; part--) {
      const item = parts[part]
      if (item.type !== "tool" || item.name !== "todowrite" || item.state.status !== "completed") continue
      const next = items(item.state.metadata?.todos)
      if (!next) continue
      return { items: next, last: message.id, user }
    }
  }
  return { items: [], last: undefined, user }
}

/** Whether the visible messages already hold a write, so paging older history cannot change the list. */
export function hasTodoWrite(
  messages: ReadonlyArray<SessionMessageInfo>,
  revert?: { messageID: string; partID?: string },
) {
  const cut = boundary(messages, revert)
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type !== "assistant") continue
    const parts = active(message, side(message.id, index, cut, revert), revert)
    if (parts.some((part) => part.type === "tool" && part.name === "todowrite")) return true
  }
  return false
}

// Message IDs are minted at admission, so a queued prompt delivered after later steps sorts before them. Transcript
// position decides when the boundary is loaded; the ID order is only a fallback for a boundary outside the window.
function boundary(messages: ReadonlyArray<SessionMessageInfo>, revert: { messageID: string } | undefined) {
  if (!revert) return -1
  return messages.findIndex((message) => message.id === revert.messageID)
}

function side(messageID: string, index: number, cut: number, revert: { messageID: string } | undefined) {
  if (!revert) return "before"
  if (cut >= 0) return index < cut ? "before" : index === cut ? "boundary" : "after"
  if (messageID < revert.messageID) return "before"
  return messageID === revert.messageID ? "boundary" : "after"
}

function active(
  message: Extract<SessionMessageInfo, { type: "assistant" }>,
  position: "before" | "boundary" | "after",
  revert: { messageID: string; partID?: string } | undefined,
) {
  if (position === "before") return message.content
  if (position === "after") return []
  if (!revert?.partID) return []
  // Keep the parts before the reverted one. The content order is the real
  // order; part IDs are not guaranteed to sort by time.
  const index = message.content.findIndex((part) => part.type === "tool" && part.id === revert.partID)
  return index < 0 ? message.content : message.content.slice(0, index)
}