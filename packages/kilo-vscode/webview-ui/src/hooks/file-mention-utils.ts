import type { FileAttachment, FileSearchItem } from "../types/messages"
import { GIT_CHANGES_MENTION } from "./git-changes-context-utils"
import { TERMINAL_MENTION } from "./terminal-context-utils"

export const AT_PATTERN = /(?:^|\s)@(\S*)$/

export type MentionResult =
  | { type: "terminal"; value: typeof TERMINAL_MENTION; label: string; description: string }
  | { type: "git-changes"; value: typeof GIT_CHANGES_MENTION; label: string; description: string }
  | { type: "file"; value: string }
  | { type: "opened-file"; value: string }
  | { type: "folder"; value: string }

export const TERMINAL_RESULT: MentionResult = {
  type: "terminal",
  value: TERMINAL_MENTION,
  label: "Terminal",
  description: "Active terminal output",
}

export const GIT_CHANGES_RESULT: MentionResult = {
  type: "git-changes",
  value: GIT_CHANGES_MENTION,
  label: "Git changes",
  description: "Current session/worktree changes",
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

export function getGitChangesMentionResult(query: string): MentionResult[] {
  const normalized = query.toLowerCase()
  if (normalized && !GIT_CHANGES_MENTION.startsWith(normalized) && !"git".startsWith(normalized)) return []
  return [GIT_CHANGES_RESULT]
}

export function buildMentionResults(query: string, items: Array<FileSearchItem | string>, git = true): MentionResult[] {
  const results: MentionResult[] = items.map((item) => {
    if (typeof item === "string") return { type: "file", value: item }
    if (item.type === "folder") return { type: "folder", value: item.path }
    if (item.type === "opened-file") return { type: "opened-file", value: item.path }
    return { type: "file", value: item.path }
  })
  return [...getTerminalMentionResult(query), ...(git ? getGitChangesMentionResult(query) : []), ...results]
}

export function filterMentionResults(query: string, items: MentionResult[]): MentionResult[] {
  const value = query.toLowerCase()
  if (!value) return items
  return items.filter((item) => {
    if (item.type === "terminal") return TERMINAL_MENTION.startsWith(value)
    if (item.type === "git-changes") return GIT_CHANGES_MENTION.startsWith(value) || "git".startsWith(value)
    return item.value.toLowerCase().includes(value)
  })
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
 * Appends a trailing space after the inserted @mention unless the text
 * immediately after the cursor already starts with whitespace, so the user
 * can keep typing without breaking the attachment parsing.
 * Returns the new text string.
 */
export function buildTextAfterMentionSelect(before: string, after: string, path: string): string {
  const replaced = before.replace(AT_PATTERN, (match) => {
    const prefix = match.startsWith(" ") ? " " : ""
    return `${prefix}@${path}`
  })
  const suffix = /^\s/.test(after) ? "" : " "
  return replaced + suffix + after
}

/**
 * Return the character range [start, end) of a mention ending at `position`,
 * including one trailing whitespace character if present. Used by execCommand
 * deletion so the change is added to the browser's undo stack.
 */
export function getMentionRemovalRange(
  text: string,
  position: number,
  paths: Set<string>,
): { start: number; end: number } | null {
  const before = text.slice(0, position)
  const all = [...[...paths].sort((a, b) => b.length - a.length), TERMINAL_MENTION, GIT_CHANGES_MENTION]
  for (const path of all) {
    const token = `@${path}`
    if (before.endsWith(token)) {
      const start = position - token.length
      const trailing = /^\s/.test(text.slice(position)) ? 1 : 0
      return { start, end: position + trailing }
    }
  }
  return null
}

/**
 * Check whether the cursor sits immediately after a known mention.
 */
export function isCursorAtMentionEnd(text: string, position: number, paths: Set<string>): boolean {
  const before = text.slice(0, position)
  const sorted = [...paths].sort((a, b) => b.length - a.length)
  for (const path of sorted) {
    if (before.endsWith(`@${path}`)) return true
  }
  for (const builtin of [TERMINAL_MENTION, GIT_CHANGES_MENTION]) {
    if (before.endsWith(`@${builtin}`)) return true
  }
  return false
}

/**
 * If the cursor is inside (or at a boundary of) a known @mention token,
 * return the token's start and end offsets. Returns null otherwise.
 * "Inside" means start < position < end (exclusive boundaries are not
 * considered inside, so the cursor can sit right before or right after
 * a mention without triggering a skip).
 */
export function findMentionRange(
  text: string,
  position: number,
  paths: Set<string>,
): { start: number; end: number } | null {
  const all = [...paths, TERMINAL_MENTION, GIT_CHANGES_MENTION]
  // Check longest first to avoid partial matches
  all.sort((a, b) => b.length - a.length)
  for (const path of all) {
    const token = `@${path}`
    let idx = text.indexOf(token)
    while (idx !== -1) {
      const end = idx + token.length
      // Cursor is strictly inside the token (not at the edges)
      if (position > idx && position < end) {
        return { start: idx, end }
      }
      idx = text.indexOf(token, idx + token.length)
    }
  }
  return null
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
