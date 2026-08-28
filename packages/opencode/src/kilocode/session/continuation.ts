import type { ModelMessage } from "ai"
import { MessageV2 } from "@/session/message-v2"
import { KiloSessionMessageOrder } from "./message-order"

export namespace KiloSessionContinuation {
  export function target(messages: MessageV2.WithParts[]) {
    const latest = KiloSessionMessageOrder.latest(messages)
    const user = latest.userMessage
    const assistant = latest.assistantMessage
    if (!user || !assistant || assistant.info.role !== "assistant") return undefined
    if (assistant.info.parentID !== user.info.id || assistant.info.summary) return undefined
    if (KiloSessionMessageOrder.compare(user, assistant, messages.indexOf(user), messages.indexOf(assistant)) >= 0)
      return undefined
    if (user.parts.some((part) => part.type === "subtask" || part.type === "compaction")) return undefined
    if (
      messages
        .slice(messages.indexOf(user) + 1)
        .some((message) =>
          message.parts.some(
            (part) => part.type === "tool" && part.tool === "plan_exit" && part.state.status === "completed",
          ),
        )
    )
      return undefined
    if (MessageV2.AbortedError.isInstance(assistant.info.error)) return assistant.info.id
    if (assistant.info.error) return undefined
    return !assistant.info.finish || assistant.info.finish === "tool-calls" ? assistant.info.id : undefined
  }

  export function context(resume: boolean): ModelMessage[] {
    if (!resume) return []
    return [
      {
        role: "user",
        content:
          "[TASK RESUMPTION] Resume the interrupted task using the existing conversation. Check the current state before retrying interrupted tools. Do not repeat work that already completed.",
      },
    ]
  }
}
