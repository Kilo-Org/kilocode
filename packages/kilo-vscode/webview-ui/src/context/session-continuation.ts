import type { Message, Part } from "../types/messages"

export function continuation(input: {
  id?: string
  status: string
  messages: Message[]
  parts: (id: string) => Part[]
  submitting: boolean
  blocked: boolean
  loading: boolean
  reverted: boolean
}) {
  if (!input.id || input.id.startsWith("cloud:") || input.status !== "idle") return
  if (input.submitting || input.blocked || input.loading || input.reverted) return
  const answered = new Set(
    input.messages.flatMap((message) => (message.role === "assistant" ? [message.parentID] : [])),
  )
  const messages = input.messages.filter(
    (message) =>
      message.role !== "user" ||
      answered.has(message.id) ||
      !input
        .parts(message.id)
        .some((part) => part.type === "text" && part.synthetic && part.metadata?.background === true),
  )
  const user = messages.findLast((message) => message.role === "user")
  const assistant = messages.at(-1)
  if (!user || !assistant || assistant.role !== "assistant" || assistant.summary === true) return
  if (assistant.parentID !== user.id) return
  if (input.parts(user.id).some((part) => part.type === "compaction")) return
  if (
    messages
      .slice(messages.indexOf(user) + 1)
      .some((message) =>
        input
          .parts(message.id)
          .some((part) => part.type === "tool" && part.tool === "plan_exit" && part.state.status === "completed"),
      )
  )
    return
  if (assistant.error?.name === "MessageAbortedError") return assistant.id
  if (assistant.error) return
  if (!assistant.finish || assistant.finish === "tool-calls") return assistant.id
}
