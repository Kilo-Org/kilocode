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
  const body = messages.map(formatMessage).join("---\n\n")
  return `${head}${body}${messages.length > 0 ? "---\n\n" : ""}`
}

function formatMessage(message: TranscriptMessage): string {
  if (message.type === "user") return `## User\n\n${message.text}\n\n`
  const content = message.content
    .map((item) => {
      if (item.type === "text") return `${item.text}\n\n`
      if (item.type === "tool") return `**Tool: ${item.name}**\n\n`
      return ""
    })
    .join("")
  return `## Assistant\n\n${content}`
}
