import { DateTime } from "effect"
import type { Attachment } from "@opencode/schema/prompt"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"

const DEFAULT_MAX_CHARS = 100_000

export namespace SessionTranscript {
  /**
   * Render a session as a Markdown transcript. Synthetic messages (reminders, injected instructions) are kept by
   * default for the recall tool; an `@` mention leaves them out so the transcript reads like the conversation.
   */
  export function format(
    session: Session.Info,
    messages: ReadonlyArray<SessionMessage.MediaInfo>,
    opts: { max?: number; synthetic?: boolean } = {},
  ) {
    const lines = [
      `# Session: ${session.title ?? session.id}`,
      `Directory: ${session.location.directory}`,
      `Created: ${new Date(DateTime.toEpochMillis(session.time.created)).toISOString()}`,
      "",
    ]
    for (const message of messages) {
      if (message.type === "user") {
        lines.push("## User", message.text)
        for (const file of message.files ?? []) lines.push(fileLine(file))
        lines.push("")
        continue
      }
      if (message.type === "assistant") {
        lines.push("## Assistant")
        for (const part of message.content) {
          if (part.type === "text") lines.push(part.text)
          if (part.type === "tool" && part.state.status === "completed") lines.push(`[Tool: ${part.name}]`)
        }
        lines.push("")
        continue
      }
      if (message.type === "synthetic" && opts.synthetic !== false) {
        lines.push("## Synthetic", message.text, "")
      }
    }
    const text = lines.join("\n")
    const max = opts.max ?? DEFAULT_MAX_CHARS
    if (text.length <= max) return text
    // Keep the original request and the most recent discussion; the middle is usually tool churn.
    const head = Math.floor(max / 3)
    const tail = max - head
    return `${text.slice(0, head)}\n\n[... ${text.length - max} characters omitted from the middle of this transcript ...]\n\n${text.slice(text.length - tail)}`
  }

  function fileLine(file: Attachment) {
    const name = file.name ?? (file.source.type === "uri" ? file.source.uri : "inline attachment")
    return `[Attached ${file.mime}: ${name}]`
  }
}
