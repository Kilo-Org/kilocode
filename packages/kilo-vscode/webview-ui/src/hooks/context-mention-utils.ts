import type { FileAttachment } from "../types/messages"

export type Mention = {
  value: string
  start: number
  end: number
}

export function find(text: string, pattern: RegExp, token: string): Mention | undefined {
  pattern.lastIndex = 0
  const match = pattern.exec(text)
  if (!match) return undefined

  const prefix = match[1] ?? ""
  const start = match.index + prefix.length
  const value = `@${token}`
  return { value, start, end: start + value.length }
}

export function attachment(
  mention: Mention | undefined,
  content: string,
  filename: string,
): FileAttachment | undefined {
  if (!mention) return undefined

  return {
    mime: "text/plain",
    url: `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`,
    filename,
    source: {
      type: "file",
      path: filename,
      text: mention,
    },
  }
}
