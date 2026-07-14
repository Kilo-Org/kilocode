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
  | { type: "file-picker"; value: "file-picker"; label: string; description: string }

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

export const FILE_PICKER_RESULT: MentionResult = {
  type: "file-picker",
  value: "file-picker",
  label: "Browse files...",
  description: "Select a file outside the workspace",
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
  return [
    ...getTerminalMentionResult(query),
    ...(git ? getGitChangesMentionResult(query) : []),
    FILE_PICKER_RESULT,
    ...results,
  ]
}

export function filterMentionResults(query: string, items: MentionResult[]): MentionResult[] {
  const value = query.toLowerCase()
  if (!value) return items
  return items.filter((item) => {
    if (item.type === "terminal") return TERMINAL_MENTION.startsWith(value)
    if (item.type === "git-changes") return GIT_CHANGES_MENTION.startsWith(value) || "git".startsWith(value)
    if (item.type === "file-picker") return true
    return item.value.toLowerCase().includes(value)
  })
}

/**
 * Sync the set of mentioned paths against the current text.
 * Removes any paths that are no longer present in the text as @path mentions.
 *
 * Uses boundary-aware matching (whitespace or start/end of string) and processes
 * paths longest-first to prevent `@src/a.ts` from false-matching `@src/a.tsx`.
 *
 * A trailing space can no longer be assumed to end a mention now that paths
 * may contain spaces: `@a.txt` is a literal, whitespace-bounded prefix of the
 * space-containing `@a.txt backup.txt`. Checking each candidate occurrence
 * against every longer path already accepted at the same position (rather
 * than relying on whitespace alone) prevents a stale, unrelated `a.txt` from
 * a prior mention surviving just because it happens to collide with the
 * start of a longer path mentioned in the current text.
 */
export function syncMentionedPaths(prev: Set<string>, text: string): Set<string> {
  const next = new Set<string>()
  // Sort longest-first so e.g. "src/a.tsx" is checked before "src/a.ts"
  const sorted = [...prev].sort((a, b) => b.length - a.length)
  const accepted: string[] = []
  for (const path of sorted) {
    const token = `@${path}`
    let search = 0
    const valid = (() => {
      while (true) {
        const idx = text.indexOf(token, search)
        if (idx === -1) return false
        const before = idx === 0 || /\s/.test(text[idx - 1] ?? "")
        const end = idx + token.length
        const after = end >= text.length || /\s/.test(text[end] ?? "")
        const collides = accepted.some((other) => other !== path && text.startsWith(`@${other}`, idx))
        if (before && after && !collides) return true
        search = idx + 1
      }
    })()
    if (!valid) continue
    accepted.push(path)
    next.add(path)
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

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\\/]/.test(path) || path.startsWith("\\\\")
}

/**
 * Collapse "." and ".." segments in a forward-slash path so a traversal like
 * "/workspace/../../etc/passwd" resolves to its real location ("/etc/passwd")
 * before any workspace-containment check runs. Preserves a leading drive
 * letter (`C:`) and distinguishes a UNC root ("//server") from a plain root
 * ("/"). ".." segments that would go above the root are dropped rather than
 * kept, matching filesystem semantics for an absolute path.
 */
function normalizeAbsolutePath(input: string): string {
  const drive = input.match(/^[A-Za-z]:/)?.[0] ?? ""
  const rest = drive ? input.slice(drive.length) : input
  const root = rest.startsWith("//") ? "//" : rest.startsWith("/") ? "/" : ""
  const segments = rest
    .slice(root.length)
    .split("/")
    .filter((s) => s.length > 0 && s !== ".")
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === "..") {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(seg)
  }
  return `${drive}${root}${stack.join("/")}`
}

/** Whether `abs` is the workspace root or lives under it (both already normalized). */
function isInsideWorkspace(abs: string, dir: string): boolean {
  return abs === dir || abs.startsWith(`${dir}/`)
}

/**
 * Build FileAttachment objects from currently mentioned paths in the text.
 *
 * Paths outside the workspace (e.g. picked via the file picker, or seeded from
 * raw draft text via a "../.." traversal) are deliberately excluded: attaching a
 * file reads its content on the backend through a path that bypasses the
 * permission system, including any prior "deny" decision for that file. Such
 * paths remain visible and clickable as a styled mention in the UI, but are not
 * auto-attached — if the model needs their contents it must call the Read tool,
 * which enforces the normal external-directory permission checks. Every
 * resolved path (relative or absolute) is normalized before the containment
 * check so a "../" sequence can't slip past a literal string-prefix match.
 *
 * Includes source.text position data so the message renderer can highlight
 * the full mention span (including paths with spaces or non-ASCII characters)
 * without falling back to the regex-based detection that stops at spaces.
 */
export function buildFileAttachments(
  text: string,
  mentionedPaths: Set<string>,
  workspaceDir: string,
): FileAttachment[] {
  const result: FileAttachment[] = []
  const dir = normalizeAbsolutePath(workspaceDir.replaceAll("\\", "/")).replace(/\/+$/, "")
  for (const path of mentionedPaths) {
    const token = `@${path}`
    const idx = text.indexOf(token)
    if (idx !== -1) {
      const raw = isAbsolutePath(path) ? path.replaceAll("\\", "/") : `${dir}/${path}`
      const abs = normalizeAbsolutePath(raw)
      if (!isInsideWorkspace(abs, dir)) continue
      const url = new URL("file://")
      // Pre-encode spaces and literal percent signs before assigning to
      // pathname: VS Code's webview (Chromium) does not percent-encode spaces
      // in file:// URL pathnames, which causes Bun's fileURLToPath on the
      // server to truncate the path at the first space. A literal "%" in the
      // filename must also be escaped first (to "%25"), otherwise a name like
      // "100%20real.txt" would be indistinguishable from an already-encoded
      // space and get decoded back to "100 real.txt" server-side. Other
      // non-ASCII characters are encoded correctly by the URL class, so only
      // "%" and " " need this explicit treatment.
      url.pathname = (abs.startsWith("/") ? abs : `/${abs}`).replace(/%/g, "%25").replace(/ /g, "%20")
      result.push({
        mime: "text/plain",
        url: url.href,
        source: {
          type: "file",
          path,
          text: { value: token, start: idx, end: idx + token.length },
        },
      })
    }
  }
  return result
}
