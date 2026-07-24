import type { Message, SessionCloseReason, TodoItem } from "../types/messages"

type TerminalKind = "incomplete" | "limit" | "unknown" | "filtered" | "unexpected" | "interrupted" | "error"
type TerminalTone = "warning" | "critical"

export interface TerminalState {
  kind: TerminalKind
  tone: TerminalTone
  finish?: string
  vercelID?: string
  remaining: number
}

interface Input {
  reason?: SessionCloseReason
  messages: Message[]
  todos: TodoItem[]
  hidden?: (id: string) => boolean
}

function vercelID(message: Message | undefined) {
  const headers = message?.error?.data?.responseHeaders
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return
  return Object.entries(headers).find(
    ([name, value]) => name.toLowerCase() === "x-vercel-id" && typeof value === "string",
  )?.[1]
}

export function terminal(input: Input): TerminalState | undefined {
  if (!input.reason) return undefined
  const last = input.messages[input.messages.length - 1]
  const finish = last?.role === "assistant" ? last.finish : undefined
  const remaining = input.todos.filter((item) => item.status !== "completed" && item.status !== "cancelled").length

  if (input.reason === "interrupted") return { kind: "interrupted", tone: "warning", finish, remaining }
  if (input.reason === "error") {
    if (last?.role === "assistant" && last.error && !input.hidden?.(last.id)) return undefined
    return { kind: "error", tone: "critical", finish, remaining }
  }
  if (finish === "length") return { kind: "limit", tone: "warning", finish, remaining }
  if (finish === "unknown") return { kind: "unknown", tone: "warning", finish, remaining, vercelID: vercelID(last) }
  if (finish === "content-filter") return { kind: "filtered", tone: "warning", finish, remaining }
  if (finish === "other") return { kind: "unexpected", tone: "warning", finish, remaining }
  return undefined
}
