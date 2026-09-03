import fuzzysort from "fuzzysort"
import type { FileAttachment, FileSearchItem, SessionSearchItem } from "../types/messages"
import { GIT_CHANGES_MENTION } from "./git-changes-context-utils"
import { TERMINAL_MENTION } from "./terminal-context-utils"

/**
 * The in-progress `@mention` query ending at the cursor.
 *
 * The query may contain spaces so paths like `@my report.txt` stay searchable,
 * but it never spans a newline or a later ` @`, so a second mention starts its
 * own query instead of swallowing the previous one. A `@` that is not preceded
 * by whitespace stays inside the query, keeping scoped paths such as
 * `@node_modules/@types/node` searchable.
 */
export const AT_PATTERN = /(?:^|\s)@(?![^\n]*\s@)([^\n]*)$/

export type WorktreeReference = {
  id: string
  name: string
  branch: string
  path: string
  base: string
  sessions: { id: string; title?: string }[]
  disabled: boolean
}

export type MentionResult =
  | { type: "terminal"; value: typeof TERMINAL_MENTION; label: string; description: string }
  | { type: "git-changes"; value: typeof GIT_CHANGES_MENTION; label: string; description: string }
  | { type: "past-chats"; value: typeof PAST_CHATS_MENTION; label: string; description: string }
  | { type: "file"; value: string }
  | { type: "opened-file"; value: string }
  | { type: "folder"; value: string }
  | { type: "file-picker"; value: "file-picker"; label: string; description: string }
  | { type: "session"; value: string; session: SessionSearchItem }
  | { type: "worktrees"; value: "worktrees" }

export const PAST_CHATS_MENTION = "past-chats"
const PAST_CHATS_ALIASES = ["past chats", "past", "chats", "sessions", "session", "history"]
const WORKTREE_ALIASES = ["worktrees", "branches", "search worktrees"]
const TERMINAL_ALIASES = [TERMINAL_MENTION]
const GIT_CHANGES_ALIASES = [GIT_CHANGES_MENTION, "git"]
const FILE_PICKER_ALIASES = ["browse files", "browse", "file picker"]

/**
 * Compare mention labels and queries on equal footing: case-insensitive, with
 * hyphens and runs of whitespace treated as a single separator. A query may now
 * contain spaces, so the way a user types a label (`git changes`) must match the
 * token it stands for (`git-changes`).
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s-]+/g, " ")
    .trim()
}

/** Whether an in-progress query is still typing out one of these labels. */
function aliased(query: string, aliases: string[]): boolean {
  const value = normalize(query)
  if (!value) return true
  return aliases.some((alias) => normalize(alias).startsWith(value))
}

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

export const PAST_CHATS_RESULT: MentionResult = {
  type: "past-chats",
  value: PAST_CHATS_MENTION,
  label: "Past chats",
  description: "Search previous sessions",
}

export const WORKTREES_RESULT: MentionResult = { type: "worktrees", value: "worktrees" }

/**
 * Whether the query spells out the Browse files entry instead of merely leaving
 * it as the fallback every list ends with. A named picker is a choice the user
 * is making, so it must survive the checks that exist to get an unmatched
 * fallback out of the way.
 */
export function filePickerNamed(query: string): boolean {
  if (!normalize(query)) return false
  return aliased(query, FILE_PICKER_ALIASES)
}

export function getTerminalMentionResult(query: string): MentionResult[] {
  if (!aliased(query, TERMINAL_ALIASES)) return []
  return [TERMINAL_RESULT]
}

export function getGitChangesMentionResult(query: string): MentionResult[] {
  if (!aliased(query, GIT_CHANGES_ALIASES)) return []
  return [GIT_CHANGES_RESULT]
}

export function getPastChatsMentionResult(query: string): MentionResult[] {
  if (!aliased(query, PAST_CHATS_ALIASES)) return []
  return [PAST_CHATS_RESULT]
}

/**
 * Everything the `@` menu can offer for a query: the special entries, worktree
 * references, matching past chats, then files. `sessions` is already filtered
 * and ranked by the caller, which owns the directory-scoped session list.
 */
export function buildMentionResults(
  query: string,
  items: Array<FileSearchItem | string>,
  git = true,
  worktrees = false,
  sessions: MentionResult[] = [],
): MentionResult[] {
  const references: MentionResult[] = worktrees && aliased(query, WORKTREE_ALIASES) ? [WORKTREES_RESULT] : []
  const results: MentionResult[] = items.map((item) => {
    if (typeof item === "string") return { type: "file", value: item }
    if (item.type === "folder") return { type: "folder", value: item.path }
    if (item.type === "opened-file") return { type: "opened-file", value: item.path }
    return { type: "file", value: item.path }
  })
  return [
    ...getTerminalMentionResult(query),
    ...(git ? getGitChangesMentionResult(query) : []),
    ...getPastChatsMentionResult(query),
    ...references,
    ...sessions,
    ...results,
    FILE_PICKER_RESULT,
  ]
}

export function filterSessions(sessions: SessionSearchItem[], query: string) {
  if (!query) return sessions.slice(0, 50)
  return fuzzysort
    .go(query.toLowerCase(), sessions, { keys: ["title", "worktreeName"], limit: 50 })
    .map((item) => item.obj)
}

/** Single-line, safe display/filename forms for a session mention. */
export function sessionMentionText(title: string) {
  return title.replace(/\s+/g, " ").trim()
}

/** Return a stable visible token, adding a suffix only when titles collide. */
export function sessionMentionToken(session: SessionSearchItem, known: Map<string, SessionSearchItem>) {
  const existing = [...known].find(([, item]) => item.id === session.id)
  if (existing) return existing[0]

  const title = sessionMentionText(session.title)
  if (!known.has(title)) return title

  for (let index = 2; ; index++) {
    const token = `${title} (${index})`
    if (!known.has(token)) return token
  }
}

export function sessionMentionFilename(title: string, id: string) {
  const slug = sessionMentionText(title)
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50)
  return `${slug || id}.md`
}

/**
 * Whether an in-progress query continues past a mention that was inserted at
 * this same `@`, meaning the user moved on to writing prose rather than typing
 * a longer filename. Because a query may contain spaces, `@notes.md and then`
 * still matches the mention trigger; this is what tells the two apart.
 *
 * `token` must be the mention actually inserted at this `@`, not merely a known
 * path: paths stay in the mention hook's sticky known set for the whole
 * session, so testing every known token would let a short earlier mention such
 * as `my` close the search for a genuinely new `@my report.txt`.
 *
 * `tokens` guards the remaining ambiguity: while the query is still growing
 * toward a longer known path, the user is completing a filename rather than
 * writing prose, so the search stays open.
 */
export function mentionSettled(query: string, token: string | undefined, tokens: Set<string>): boolean {
  if (!token || query.length <= token.length) return false
  if (!query.startsWith(token)) return false
  if (!/\s/.test(query[token.length] ?? "")) return false
  for (const known of tokens) {
    if (known.length > query.length && known.startsWith(query)) return false
  }
  return true
}

export function filterMentionResults(query: string, items: MentionResult[]): MentionResult[] {
  const value = query.toLowerCase()
  if (!value) return items
  return items.filter((item) => {
    if (item.type === "terminal") return aliased(query, TERMINAL_ALIASES)
    if (item.type === "git-changes") return aliased(query, GIT_CHANGES_ALIASES)
    if (item.type === "past-chats") return aliased(query, PAST_CHATS_ALIASES)
    if (item.type === "file-picker") return true
    if (item.type === "worktrees") return aliased(query, WORKTREE_ALIASES)
    if (item.type === "session") return normalize(item.value).includes(normalize(query))
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

export function buildWorktreeAttachments(text: string, worktrees: WorktreeReference[]): FileAttachment[] {
  const paths = syncMentionedPaths(new Set(worktrees.map((worktree) => worktree.path)), text)
  return worktrees
    .filter((worktree) => paths.has(worktree.path))
    .map((worktree) => {
      const value = `@${worktree.path}`
      const start = text.indexOf(value)
      const content = [
        "Agent Manager worktree reference (metadata only, not file contents or conversation history).",
        "Use the directory to inspect files or git changes. Use the session IDs with Agent Manager or recall if needed.",
        JSON.stringify(
          {
            worktreeID: worktree.id,
            name: worktree.name,
            directory: worktree.path,
            branch: worktree.branch,
            baseBranch: worktree.base,
            sessions: worktree.sessions,
          },
          null,
          2,
        ),
      ].join("\n\n")
      return {
        mime: "text/plain",
        url: `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`,
        filename: `worktree-${worktree.id}.txt`,
        source: { type: "file", path: worktree.path, text: { value, start, end: start + value.length } },
      }
    })
}

/**
 * Sync mentioned sessions against the current text: drop entries whose
 * `@title` token is no longer present. Uses the same boundary-aware matching
 * as path mentions (titles may contain spaces).
 */
export function syncMentionedSessions(
  prev: Map<string, SessionSearchItem>,
  text: string,
): Map<string, SessionSearchItem> {
  const kept = syncMentionedPaths(new Set(prev.keys()), text)
  return new Map([...prev].filter(([token]) => kept.has(token)))
}

/**
 * Build FileAttachment objects for mentioned past chats. The `session:` URL
 * is resolved server-side at prompt time into the session's transcript, so
 * the attached content is always current. The source carries the mention span
 * for transcript highlighting, and the title-keyed filename gives the model a
 * readable attachment name.
 */
export function buildSessionAttachments(text: string, mentioned: Map<string, SessionSearchItem>): FileAttachment[] {
  const result: FileAttachment[] = []
  for (const [token, session] of mentioned) {
    const mention = `@${token}`
    const idx = text.indexOf(mention)
    if (idx === -1) continue
    const url = `session:${session.id}`
    result.push({
      mime: "text/plain",
      url,
      filename: sessionMentionFilename(token, session.id),
      source: {
        type: "file",
        path: url,
        text: { value: mention, start: idx, end: idx + mention.length },
      },
    })
  }
  return result
}
