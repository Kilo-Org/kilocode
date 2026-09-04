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

export const PAST_CHATS_MENTION = "past-chats"

const terminal = {
  result: {
    type: "terminal",
    value: TERMINAL_MENTION,
    label: "Terminal",
    description: "Active terminal output",
  },
  aliases: [],
  gate: null,
} as const

const changes = {
  result: {
    type: "git-changes",
    value: GIT_CHANGES_MENTION,
    label: "Git changes",
    description: "Current session/worktree changes",
  },
  aliases: [],
  gate: "git",
} as const

const chats = {
  result: {
    type: "past-chats",
    value: PAST_CHATS_MENTION,
    label: "Past chats",
    description: "Search previous sessions",
  },
  aliases: ["sessions", "history"],
  gate: null,
} as const

const worktrees = {
  result: { type: "worktrees", value: "worktrees" },
  aliases: ["branches", "search worktrees"],
  gate: "worktrees",
} as const

const picker = {
  result: {
    type: "file-picker",
    value: "file-picker",
    label: "Browse files...",
    description: "Select a file outside the workspace",
  },
  aliases: [],
  gate: null,
} as const

const entries = [terminal, changes, chats, worktrees, picker] as const
type MentionEntry = (typeof entries)[number]["result"]

export type MentionResult =
  | MentionEntry
  | { type: "file"; value: string }
  | { type: "opened-file"; value: string }
  | { type: "folder"; value: string }
  | { type: "session"; value: string; session: SessionSearchItem }

/**
 * Compare mention labels and queries on equal footing: case-insensitive, with
 * hyphens and runs of whitespace treated as a single separator, so the way a
 * user types a label (`git changes`) matches the token it stands for
 * (`git-changes`).
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s-]+/g, " ")
    .trim()
}

export const TERMINAL_RESULT = terminal.result
export const GIT_CHANGES_RESULT = changes.result
export const FILE_PICKER_RESULT = picker.result
export const PAST_CHATS_RESULT = chats.result
export const WORKTREES_RESULT = worktrees.result

/**
 * Whether the query spells out the Browse files entry rather than just leaving
 * it on offer. Naming it is a choice the user is making, so it survives the
 * check that reads an unanswered spaced query as prose.
 *
 * This asks the ranking the same question the list does, rather than testing
 * the aliases separately: typing the label in full, dots and all, scores 1.0
 * but is not a prefix of any alias, and the two answers must not disagree.
 */
export function filePickerNamed(query: string): boolean {
  if (!normalize(query)) return false
  return score(query, FILE_PICKER_RESULT) >= FLOOR
}

export function isMentionEntry(item: MentionResult): boolean {
  return entries.some((entry) => entry.result.type === item.type)
}

/** Score of a query that matched nothing, which sorts below every real match. */
const MISS = -1
/**
 * How well a query must fit a label before the menu offers it. Deliberate
 * matches score well clear of this (`git` on Git changes 0.87, `fix auth` on a
 * chat titled "Fix auth bug" 0.91), while the noise a loose subsequence finds
 * falls below it (`e` on Terminal 0.60, `chevron` on "500 character novel
 * generation" 0.25). Files are exempt: the file search already chose them, and
 * a weak score only decides where they sit.
 */
const FLOOR = 0.7

/** Everything a result answers to, so one query can be scored against them all. */
function labels(item: MentionResult): string[] {
  const entry = entries.find((candidate) => candidate.result.type === item.type)
  if (entry) return [...("label" in item ? [item.label] : []), item.value, ...entry.aliases]
  if (item.type === "session") return [item.session.title, item.session.worktreeName ?? ""].filter(Boolean)
  return [item.value]
}

function score(query: string, item: MentionResult): number {
  const value = normalize(query)
  const best = labels(item).reduce(
    (top, label) => Math.max(top, fuzzysort.single(value, normalize(label))?.score ?? MISS),
    MISS,
  )
  // A Browse files the query ignores is the last resort of the list, below even
  // the files the search returned that the query does not literally spell.
  if (item.type === "file-picker" && best === MISS) return MISS - 1
  return best
}

/**
 * Order every offer by how well it answers the query, so a menu entry, a past
 * chat and a file compete on the same scale — a literal filename match beats a
 * chat title the query only scatters across. Anything the query misses drops
 * out, except Browse files, which stays on as the last resort it is.
 */
export function rankMentionResults(query: string, items: MentionResult[]): MentionResult[] {
  if (!query) return items
  return items
    .map((item) => ({ item, score: score(query, item) }))
    .filter((entry) => {
      // Browse files is the way out when nothing matches, so it is never
      // dropped; it just sinks to the bottom when the query ignores it.
      if (entry.item.type === "file-picker") return true
      if (isMentionEntry(entry.item) || entry.item.type === "session") return entry.score >= FLOOR
      return true
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

/**
 * Where the selection starts. A query puts its best answer first, so the top of
 * the list is already the right place. An empty `@` ranks nothing, so it starts
 * on the first file instead of on the menu entries listed above them.
 */
export function defaultMentionIndex(items: MentionResult[], query: string): number {
  if (query) return 0
  const index = items.findIndex((item) => !isMentionEntry(item))
  return index === -1 ? 0 : index
}

/**
 * Everything the `@` menu can offer for a query, ranked as one list: menu
 * entries, past chats and files all compete on the same score, so what answers
 * the query best comes first whatever kind of thing it is. An empty `@` has
 * nothing to rank and keeps the menu order, entries first. `sessions` is
 * already filtered by the caller, which owns the directory-scoped chat list.
 */
export function buildMentionResults(
  query: string,
  items: Array<FileSearchItem | string>,
  git = true,
  worktrees = false,
  sessions: MentionResult[] = [],
): MentionResult[] {
  const gates = { git, worktrees }
  const references = entries.filter((entry) => entry.gate === null || gates[entry.gate]).map((entry) => entry.result)
  const results: MentionResult[] = items.map((item) => {
    if (typeof item === "string") return { type: "file", value: item }
    if (item.type === "folder") return { type: "folder", value: item.path }
    if (item.type === "opened-file") return { type: "opened-file", value: item.path }
    return { type: "file", value: item.path }
  })
  return rankMentionResults(query, [...references, ...sessions, ...results])
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
    // Entries answer here exactly as they do to the ranking, so a query cannot
    // keep an entry in one place and lose it in the other.
    if (item.type === "file-picker") return true
    if (isMentionEntry(item)) return score(query, item) >= FLOOR
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
