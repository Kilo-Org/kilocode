import type { FileAttachment } from "../types/messages"

export const TERMINAL_MENTION = "terminal"
export const TERMINAL_FILENAME = "terminal-output.txt"
export const TERMINAL_PATTERN = /(^|\s)@terminal(?=\s|$)/g

export type TerminalMention = {
  value: string
  start: number
  end: number
}

export function findTerminalMention(text: string): TerminalMention | undefined {
  TERMINAL_PATTERN.lastIndex = 0
  const match = TERMINAL_PATTERN.exec(text)
  if (!match) return undefined

  const prefix = match[1] ?? ""
  const start = match.index + prefix.length
  const value = `@${TERMINAL_MENTION}`
  return { value, start, end: start + value.length }
}

export function hasTerminalMention(text: string): boolean {
  return findTerminalMention(text) !== undefined
}

export function buildTerminalAttachment(text: string, content: string): FileAttachment | undefined {
  const mention = findTerminalMention(text)
  if (!mention) return undefined

  return {
    mime: "text/plain",
    url: `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`,
    filename: TERMINAL_FILENAME,
    source: {
      type: "file",
      path: TERMINAL_FILENAME,
      text: mention,
    },
  }
}
