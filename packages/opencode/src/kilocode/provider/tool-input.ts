import type { ModelMessage } from "ai"

export namespace KiloToolInput {
  export function normalize(input: unknown) {
    return input ?? {}
  }

  export function normalizeMessages(messages: ModelMessage[]): ModelMessage[] {
    return messages.map((message) => {
      if (message.role !== "assistant" || !Array.isArray(message.content)) return message
      if (!message.content.some((part) => part.type === "tool-call" && part.input == null)) return message

      return {
        ...message,
        content: message.content.map((part) => {
          if (part.type !== "tool-call" || part.input != null) return part
          return { ...part, input: normalize(part.input) }
        }),
      }
    })
  }
}
