import { partFeedback } from "../../../src/shared/browser-feedback"
import type { ResponseLensContext } from "../../../src/shared/response-lens"
import type { Message, Part } from "../types/messages"

// Unknown or damaged envelopes are omitted, not guessed apart. Mentions remain inert text.
function plain(message: Message, parts: Part[]): string {
  if (message.summary) return ""
  return parts
    .flatMap((part) => {
      if (
        part.type !== "text" ||
        part.synthetic ||
        (part.sessionID && part.sessionID !== message.sessionID) ||
        (part.messageID && part.messageID !== message.id)
      )
        return []
      const body = partFeedback(part.metadata, part.text)?.body ?? part.text
      if (/(?:^|\n)## (?:Review Comments|Browser Feedback|Annotations on previous responses)\b/i.test(body)) return []
      if (
        /<(?:environment_details|system-reminder|file|terminal[_-](?:output|context)|git[_-]changes|browser[_-]feedback|review[_-]comments)\b/i.test(
          body,
        )
      )
        return []
      return body.trim() ? [body.trim()] : []
    })
    .join("\n\n")
}

export function responseLensContext(
  capture: { sessionID: string; messageID: string; text: string; paragraph?: string },
  messages: Message[],
  parts: (id: string) => Part[],
): { context: ResponseLensContext[]; insufficient: boolean } {
  const index = messages.findIndex(
    (message) =>
      message.id === capture.messageID && message.sessionID === capture.sessionID && message.role === "assistant",
  )
  if (index < 0) return { context: [], insufficient: true }
  const source = messages.at(index)!
  const context: ResponseLensContext[] = []
  const request = messages
    .slice(0, index)
    .findLast((message) => message.sessionID === capture.sessionID && message.role === "user")
  const user = request ? plain(request, parts(request.id)).slice(0, 1600).trim() : ""
  if (user) context.push({ role: "user", text: user })
  const body = plain(source, parts(source.id))
  const normalize = (value: string) => value.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim()
  const paragraphs = body.split(/\n\s*\n/)
  const needle = normalize(capture.text)
  const hint = capture.paragraph ? normalize(capture.paragraph) : ""
  const paragraph =
    (hint && paragraphs.find((value) => normalize(value).includes(hint))) ||
    paragraphs.find((value) => normalize(value).includes(needle))
  if (paragraph) {
    const offset = Math.max(0, paragraph.indexOf(capture.text) - 240)
    context.push({ role: "assistant", text: paragraph.slice(offset, offset + 2400) })
  }
  return { context, insufficient: !user || !paragraph }
}
