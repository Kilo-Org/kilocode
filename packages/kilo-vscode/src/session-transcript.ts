import type { SessionMessageInfo, SessionTransferData } from "@opencode/client"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"

type TranscriptMessage = Extract<SessionMessageInfo, { type: "user" | "assistant" }>

export function formatSessionTranscript(transfer: SessionTransferData): string {
  const head = [
    `# ${withTimestampedFallback(transfer.info)}`,
    "",
    `**Session ID:** ${transfer.info.id}`,
    `**Created:** ${new Date(transfer.info.time.created).toLocaleString()}`,
    `**Updated:** ${new Date(transfer.info.time.updated).toLocaleString()}`,
    "",
    "---",
    "",
    "",
  ].join("\n")
  const messages = transfer.messages.filter(
    (message): message is TranscriptMessage => message.type === "user" || message.type === "assistant",
  )
  const body = messages.flatMap(formatMessage)
  return `${head}${body.join("---\n\n")}${body.length > 0 ? "---\n\n" : ""}`
}

// An assistant step that stopped before storing text or a tool call, such as a thinking-only retry, stays out of the
// export so the file does not gain an empty section between two separators.
function formatMessage(message: TranscriptMessage) {
  if (message.type === "user") return [`## User\n\n${message.text}\n\n`]
  const content = message.content.flatMap((item) => {
    if (item.type === "text") return [`${item.text}\n\n`]
    if (item.type === "tool") return [`**Tool: ${item.name}**\n\n`]
    return []
  })
  if (content.length === 0) return []
  return [`## Assistant\n\n${content.join("")}`]
}
