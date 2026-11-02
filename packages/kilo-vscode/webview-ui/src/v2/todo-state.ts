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
 * messages and parts it would remove.
 */
export function todoState(
  messages: ReadonlyArray<SessionMessageInfo>,
  revert?: { messageID: string; partID?: string },
) {
  let last: string | undefined
  let todos: TodoItem[] = []
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const part of message.content) if (part.type === "tool" && part.name === "todowrite") last = message.id
    for (const part of active(message, revert)) {
      if (part.type !== "tool" || part.name !== "todowrite" || part.state.status !== "completed") continue
      const next = items(part.state.metadata?.todos)
      if (!next) continue
      todos = next
    }
  }
  const user = messages.findLast((message) => message.type === "user")?.id
  return { items: todos, last, user }
}

function active(
  message: Extract<SessionMessageInfo, { type: "assistant" }>,
  revert: { messageID: string; partID?: string } | undefined,
) {
  if (!revert) return message.content
  if (message.id < revert.messageID) return message.content
  if (message.id > revert.messageID) return []
  if (!revert.partID) return []
  // Keep the parts before the reverted one. The content order is the real
  // order; part IDs are not guaranteed to sort by time.
  const index = message.content.findIndex((part) => part.type === "tool" && part.id === revert.partID)
  return index < 0 ? message.content : message.content.slice(0, index)
}