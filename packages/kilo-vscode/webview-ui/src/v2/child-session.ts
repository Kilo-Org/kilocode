import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"

/** The tool parts of a child session, in message order, for a subagent card. */
export function childTools(messages: readonly SessionMessageInfo[]) {
  return messages.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((part): part is SessionMessageAssistantTool => part.type === "tool")
      : [],
  )
}
