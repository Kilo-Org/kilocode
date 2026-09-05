import type { FileAttachment } from "../types/messages"
import { attachment, find, type Mention } from "./context-mention-utils"

export const TERMINAL_MENTION = "terminal"
export const TERMINAL_FILENAME = "terminal-output.txt"
export const TERMINAL_PATTERN = /(^|\s)@terminal(?=\s|$)/g

export type TerminalMention = Mention

export function findTerminalMention(text: string): TerminalMention | undefined {
  return find(text, TERMINAL_PATTERN, TERMINAL_MENTION)
}

export function hasTerminalMention(text: string): boolean {
  return findTerminalMention(text) !== undefined
}

export function buildTerminalAttachment(text: string, content: string): FileAttachment | undefined {
  return attachment(findTerminalMention(text), content, TERMINAL_FILENAME)
}
