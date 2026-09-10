import type { Message, Part, SessionInfo, TodoItem, ToolPart } from "../types/messages"

type Revert = NonNullable<SessionInfo["revert"]>
type Source = Record<string, Part[]> | ((messageID: string) => Part[] | undefined)
type TodoPart = ToolPart & { state: { status: "completed"; metadata?: Record<string, unknown> } }

interface Input {
  messages: Message[]
  parts: Source
  revert?: Revert
}

interface Write {
  part: TodoPart
  todos: TodoItem[]
}

function list(source: Source, messageID: string) {
  if (typeof source === "function") return source(messageID) ?? []
  return source[messageID] ?? []
}

export function isTodo(part: Part): part is TodoPart {
  if (part.type !== "tool") return false
  if (part.tool !== "todowrite") return false
  if (part.state.status !== "completed") return false
  return true
}

export function items(part: Part): TodoItem[] | undefined {
  if (!isTodo(part)) return undefined
  const todos = part.state.metadata?.todos
  if (!Array.isArray(todos)) return undefined
  return todos as TodoItem[]
}

function active(input: Input, msg: Message) {
  const parts = list(input.parts, msg.id)
  const revert = input.revert
  if (!revert) return parts
  if (msg.id < revert.messageID) return parts
  if (msg.id > revert.messageID) return []
  if (!revert.partID) return []
  const partID = revert.partID
  return parts.filter((part) => part.id < partID)
}

export function writes(input: Input): Write[] {
  return input.messages.flatMap((msg) =>
    active(input, msg).flatMap((part) => {
      const todos = items(part)
      return todos ? [{ part: part as TodoPart, todos }] : []
    }),
  )
}

export function state(input: Input): TodoItem[] {
  return writes(input).at(-1)?.todos ?? []
}

export function target(input: Omit<Input, "revert">, index: number): Part | undefined {
  const all = writes(input)
  const done = (item: Write) => item.todos[index]?.status === "completed"
  const fallback = [...all].reverse().find(done)
  const entry = all
    .map((item, idx) => ({ item, idx }))
    .reverse()
    .find(({ item, idx }) => {
      if (!done(item)) return false
      return all[idx - 1]?.todos[index]?.status !== "completed"
    })

  return entry?.item.part ?? fallback?.part
}
