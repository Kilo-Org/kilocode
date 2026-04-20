import type { FileAttachment, FileSearchItem } from "../types/messages"
import { TERMINAL_MENTION } from "./terminal-context-utils"

export const AT_PATTERN = /(?:^|\s)@(\S*)$/

export type MentionResult =
  | { type: "terminal"; value: typeof TERMINAL_MENTION; label: string; description: string }
  | { type: "file"; value: string }
  | { type: "folder"; value: string }

export const TERMINAL_RESULT: MentionResult = {
  type: "terminal",
  value: TERMINAL_MENTION,
  label: "Terminal",
  description: "Active terminal output",
}

/**
 * Escape special regex characters in a string so it can be used in a RegExp.
 */
function escape(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function getTerminalMentionResult(query: string): MentionResult[] {
  const normalized = query.toLowerCase()
  if (!TERMINAL_MENTION.startsWith(normalized)) return []
  return [TERMINAL_RESULT]
}

export function buildMentionResults(query: string, items: Array<FileSearchItem | string>): MentionResult[] {
  const results: MentionResult[] = items.map((item) => {
    if (typeof item === "string") return { type: "file", value: item }
    if (item.type === "folder") return { type: "folder", value: item.path }
    return { type: "file", value: item.path }
  })
  return [...getTerminalMentionResult(query), ...results]
}

/**
 * Sync the set of mentioned paths against the current text.
 * Removes any paths that are no longer present in the text as @path mentions.
 *
 * Uses boundary-aware matching (whitespace or start/end of string) and processes
 * paths longest-first to prevent `@src/a.ts` from false-matching `@src/a.tsx`.
 */
export function syncMentionedPaths(prev: Set<string>, text: string): Set<string> {
  const next = new Set<string>()
  // Sort longest-first so e.g. "src/a.tsx" is checked before "src/a.ts"
  const sorted = [...prev].sort((a, b) => b.length - a.length)
  for (const path of sorted) {
    const pattern = new RegExp(`(?:^|\\s)@${escape(path)}(?:\\s|$)`)
    if (pattern.test(text)) next.add(path)
  }
  return next
}

/**
 * Replace the @mention pattern before the cursor with the selected path.
 * Returns the new text string.
 */
export function buildTextAfterMentionSelect(before: string, after: string, path: string): string {
  const replaced = before.replace(AT_PATTERN, (match) => {
    const prefix = match.startsWith(" ") ? " " : ""
    return `${prefix}@${path}`
  })
  return replaced + after
}

/**
 * Build FileAttachment objects from currently mentioned paths in the text.
 */
export function buildFileAttachments(
  text: string,
  mentionedPaths: Set<string>,
  workspaceDir: string,
): FileAttachment[] {
  const result: FileAttachment[] = []
  const dir = workspaceDir.replaceAll("\\", "/")
  for (const path of mentionedPaths) {
    if (text.includes(`@${path}`)) {
      const abs = path.startsWith("/") ? path : `${dir}/${path}`
      const url = new URL("file://")
      url.pathname = abs.startsWith("/") ? abs : `/${abs}`
      result.push({ mime: "text/plain", url: url.href })
    }
  }
  return result
}
