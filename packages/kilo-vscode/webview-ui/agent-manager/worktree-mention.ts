/**
 * The mentions the New Worktree dialog offers.
 *
 * The worktree does not exist while the dialog runs, so no file paths can be resolved against it. The dialog offers
 * an inline model reference, a past chat of the loaded stores, and an existing Agent Manager worktree. A past chat is
 * resolved from the panel stores instead of a host search request: the panel already holds the sessions of its
 * directories, so the dialog needs no extra message.
 */
import fuzzysort from "fuzzysort"
import { createSignal, onCleanup, type Accessor } from "solid-js"
import type { SessionSearchItem, WorktreeReference } from "../src/utils/prompt-mention-drop"

/** Past chats offered inline, bounded so sessions cannot flood the menu. */
const SESSION_RESULT_LIMIT = 3

export const AT_PATTERN = /(?:^|\s)@(?![^\n]*\s@)([^\n]*)$/

export interface MentionFile {
  mime: string
  url: string
  filename: string
  source: { type: "file"; path: string; text: { value: string; start: number; end: number } }
}

export type MentionResult =
  | { type: "past-chats"; value: string; label: string; description: string }
  | { type: "worktrees"; value: string }
  | { type: "session"; value: string; session: SessionSearchItem }

export const PAST_CHATS_RESULT: MentionResult = {
  type: "past-chats",
  value: "past-chats",
  label: "Past chats",
  description: "Search previous sessions",
}
export const WORKTREES_RESULT: MentionResult = { type: "worktrees", value: "worktrees" }

/** The entries the dialog offers for a bare `@`, in order. */
export const WORKTREE_MENTION_ENTRIES: MentionResult[] = [PAST_CHATS_RESULT, WORKTREES_RESULT]

const ALIASES: Record<string, string[]> = {
  "past-chats": ["sessions", "history"],
  worktrees: ["branches", "search worktrees"],
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s-]+/g, " ")
    .trim()
}

function labels(item: MentionResult): string[] {
  if (item.type === "session") return [item.session.title, item.session.worktreeName ?? ""].filter(Boolean)
  if (item.type === "past-chats") return [item.label, item.value, ...ALIASES[item.type]]
  return [item.value, ...(ALIASES[item.type] ?? [])]
}

const MISS = -1
const FLOOR = 0.7

function score(query: string, item: MentionResult): number {
  const value = normalize(query)
  return labels(item).reduce((top, label) => Math.max(top, fuzzysort.single(value, normalize(label))?.score ?? MISS), MISS)
}

/** Rank the dialog's mentions for a query. A bare `@` lists the three entries in order. */
export function buildWorktreeMentionResults(query: string, sessions: MentionResult[] = []): MentionResult[] {
  if (!query) return [...WORKTREE_MENTION_ENTRIES]
  return [...WORKTREE_MENTION_ENTRIES, ...sessions]
    .map((item) => ({ item, score: score(query, item) }))
    .filter((entry) => entry.item.type !== "session" || entry.score >= FLOOR)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}

function syncMentionedPaths(prev: Set<string>, text: string): Set<string> {
  const next = new Set<string>()
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

function sessionMentionFilename(title: string, id: string) {
  const slug = title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50)
  return `${slug || id}.md`
}

export function sessionMentionText(title: string) {
  return title.replace(/\s+/g, " ").trim()
}

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

export function mentionSettled(query: string, tokens: Set<string>): boolean {
  for (const token of tokens) {
    if (token.length > query.length && token.startsWith(query)) return false
  }
  for (const token of tokens) {
    if (!token || query.length <= token.length) continue
    if (!query.startsWith(token)) continue
    if (/\s/.test(query[token.length] ?? "")) return true
  }
  return false
}

export function buildWorktreeMentionFiles(
  text: string,
  sessions: Map<string, SessionSearchItem>,
  worktrees: WorktreeReference[],
): MentionFile[] {
  return [...buildSessionAttachments(text, sessions), ...buildWorktreeAttachments(text, worktrees)]
}

function buildSessionAttachments(text: string, mentioned: Map<string, SessionSearchItem>): MentionFile[] {
  const result: MentionFile[] = []
  for (const [token, session] of mentioned) {
    const mention = `@${token}`
    const idx = text.indexOf(mention)
    if (idx === -1) continue
    const url = `session:${session.id}`
    result.push({
      mime: "text/plain",
      url,
      filename: sessionMentionFilename(token, session.id),
      source: { type: "file", path: url, text: { value: mention, start: idx, end: idx + mention.length } },
    })
  }
  return result
}

function buildWorktreeAttachments(text: string, worktrees: WorktreeReference[]): MentionFile[] {
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

export interface MentionSegment {
  text: string
  mention: boolean
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function segmentMentionText(text: string, tokens: Set<string>): MentionSegment[] {
  const list = [...tokens].filter((token) => token.length > 0).sort((a, b) => b.length - a.length)
  if (list.length === 0 || !text) return text ? [{ text, mention: false }] : []
  const escaped = list.map((token) => escapeRegExp(token))
  const pattern = new RegExp(`@(?:${escaped.join("|")})`, "g")
  const segments: MentionSegment[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    const plain = text.slice(last, index)
    if (plain) segments.push({ text: plain, mention: false })
    segments.push({ text: match[0], mention: true })
    last = index + match[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), mention: false })
  return segments
}

export interface WorktreeMention {
  mentionedSessions: Accessor<Map<string, SessionSearchItem>>
  sessionPicker: Accessor<boolean>
  sessionCandidates: Accessor<SessionSearchItem[]>
  worktreePicker: Accessor<boolean>
  worktreeCandidates: Accessor<WorktreeReference[]>
  mentionResults: Accessor<MentionResult[]>
  mentionIndex: Accessor<number>
  showMention: Accessor<boolean>
  highlightTokens: Accessor<Set<string>>
  onInput: (text: string, cursor: number) => void
  onKeyDown: (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => boolean
  selectMention: (
    result: MentionResult,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => void
  selectSession: (
    session: SessionSearchItem,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => void
  selectWorktree: (
    worktree: WorktreeReference,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => void
  setMentionIndex: (index: number) => void
  closeMention: () => void
  parseAttachments: (text: string) => MentionFile[]
}

/**
 * `@`-mention state for the New Worktree dialog. Worktree-independent by design: it offers inline model references,
 * past chats of the loaded stores and existing Agent Manager worktrees, and builds only attachments that are safe
 * before the new worktree exists.
 */
export function useWorktreeMention(
  worktrees: Accessor<WorktreeReference[]>,
  sessions: Accessor<SessionSearchItem[]> = () => [],
): WorktreeMention {
  const [query, setQuery] = createSignal<string | null>(null)
  const [results, setResults] = createSignal<MentionResult[]>([])
  const [index, setIndex] = createSignal(0)
  const [sessionPicker, setSessionPicker] = createSignal(false)
  const [worktreePicker, setWorktreePicker] = createSignal(false)
  const [mentioned, setMentioned] = createSignal<Map<string, SessionSearchItem>>(new Map())
  let at = 0
  let dead: { at: number; query: string } | undefined
  let sawInput = false

  const worktreeCandidates = () => worktrees().filter((worktree) => !worktree.disabled)
  const showMention = () => query() !== null
  const tokens = () =>
    new Set<string>([...mentioned().keys(), ...worktreeCandidates().map((worktree) => worktree.path)])

  const sessionCandidates = () =>
    sessions()
      .map((session) => ({ ...session, title: sessionMentionText(session.title) }))
      .filter((session) => session.title)
      .sort((a, b) => b.updated - a.updated)

  const sessionResults = (value: string): MentionResult[] => {
    if (!value) return []
    return fuzzysort
      .go(normalize(value), sessionCandidates(), { keys: ["title", "worktreeName"], limit: SESSION_RESULT_LIMIT })
      .map((item) => item.obj)
      .map((session) => ({ type: "session" as const, value: sessionMentionToken(session, mentioned()), session }))
  }

  const close = () => {
    setQuery(null)
    setResults([])
    setIndex(0)
    setSessionPicker(false)
    setWorktreePicker(false)
  }

  const onInput = (text: string, cursor: number) => {
    sawInput = true
    setSessionPicker(false)
    setWorktreePicker(false)
    const before = text.substring(0, cursor)
    const match = before.match(AT_PATTERN)
    if (!match) {
      dead = undefined
      close()
      return
    }
    at = (match.index ?? 0) + (/^\s/.test(match[0]) ? 1 : 0)
    const value = match[1] ?? ""
    if (dead && dead.at === at && value.startsWith(dead.query)) {
      close()
      return
    }
    if (mentionSettled(value, tokens())) {
      dead = { at, query: value }
      close()
      return
    }
    dead = undefined
    const next = buildWorktreeMentionResults(value, sessionResults(value))
    if (next.length === 0) {
      close()
      return
    }
    setQuery(value)
    setResults(next)
    setIndex(0)
  }

  const replaceRange = (
    textarea: HTMLTextAreaElement,
    start: number,
    end: number,
    inserted: string,
    setText: (text: string) => void,
  ) => {
    const pos = start + inserted.length
    const canExec =
      typeof document !== "undefined" && typeof document.execCommand === "function" && textarea.isConnected
    if (canExec) {
      const snapshot = textarea.value
      textarea.focus()
      textarea.setSelectionRange(start, end)
      sawInput = false
      document.execCommand("insertText", false, inserted)
      if (sawInput && textarea.value !== snapshot) {
        textarea.setSelectionRange(pos, pos)
        return
      }
      textarea.value = `${snapshot.substring(0, start)}${inserted}${snapshot.substring(end)}`
    } else {
      textarea.value = `${textarea.value.substring(0, start)}${inserted}${textarea.value.substring(end)}`
    }
    textarea.setSelectionRange(pos, pos)
    textarea.focus()
    setText(textarea.value)
  }

  const insertToken = (
    token: string,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const cursor = textarea.selectionStart ?? textarea.value.length
    const before = textarea.value.substring(0, cursor)
    const match = before.match(AT_PATTERN)
    if (!match) return
    const start = (match.index ?? 0) + (/^\s/.test(match[0]) ? 1 : 0)
    const suffix = /^\s/.test(textarea.value.substring(cursor)) ? "" : " "
    replaceRange(textarea, start, cursor, `@${token}${suffix}`, setText)
    close()
    onSelect?.()
  }

  const selectMention = (
    result: MentionResult,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    if (result.type === "worktrees") {
      setWorktreePicker(true)
      return
    }
    if (result.type === "past-chats") {
      setSessionPicker(true)
      return
    }
    const token = sessionMentionToken(result.session, mentioned())
    setMentioned((prev) => new Map(prev).set(token, result.session))
    insertToken(token, textarea, setText, onSelect)
  }

  const selectSession = (
    session: SessionSearchItem,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const token = sessionMentionToken(session, mentioned())
    setMentioned((prev) => new Map(prev).set(token, session))
    insertToken(token, textarea, setText, onSelect)
  }

  const selectWorktree = (
    worktree: WorktreeReference,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    if (worktree.disabled) return
    insertToken(worktree.path, textarea, setText, onSelect)
  }

  const onKeyDown = (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ): boolean => {
    if (!showMention()) return false
    if (e.isComposing) return false
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, Math.max(results().length - 1, 0)))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
      return true
    }
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      const result = results()[index()]
      if (!result) return false
      e.preventDefault()
      if (textarea) selectMention(result, textarea, setText, onSelect)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      dead = { at, query: query() ?? "" }
      close()
      return true
    }
    return false
  }

  onCleanup(() => close())

  return {
    mentionedSessions: mentioned,
    sessionPicker,
    sessionCandidates,
    worktreePicker,
    worktreeCandidates,
    mentionResults: results,
    mentionIndex: index,
    showMention,
    highlightTokens: tokens,
    onInput,
    onKeyDown,
    selectMention,
    selectSession,
    selectWorktree,
    setMentionIndex: setIndex,
    closeMention: close,
    parseAttachments: (text) => buildWorktreeMentionFiles(text, mentioned(), worktreeCandidates()),
  }
}