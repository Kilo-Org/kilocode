import { createSignal, onCleanup, type Accessor } from "solid-js"
import type { ExtensionMessage, FileAttachment, SessionSearchItem, WebviewMessage } from "../src/types/messages"
import {
  AT_PATTERN,
  MODEL_RESULT,
  PAST_CHATS_RESULT,
  WORKTREES_RESULT,
  buildSessionAttachments,
  buildWorktreeAttachments,
  filterSessions,
  mentionSettled,
  rankMentionResults,
  sessionMentionText,
  sessionMentionToken,
  type MentionResult,
  type WorktreeReference,
} from "../src/hooks/file-mention-utils"

/** Past chats offered inline, bounded so sessions cannot flood the menu. */
const SESSION_RESULT_LIMIT = 3

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

/**
 * The three entries the New Worktree dialog can mention. @file and friends are
 * deliberately absent: the worktree does not exist yet when the dialog runs, so
 * resolving file paths against it would be unsafe.
 */
export const WORKTREE_MENTION_ENTRIES: MentionResult[] = [MODEL_RESULT, PAST_CHATS_RESULT, WORKTREES_RESULT]

/**
 * Rank the dialog's mentions for a query. A bare `@` lists the three entries in
 * order; a query ranks those entries together with any matching past chats, so
 * the best answer comes first whatever kind of reference it is.
 */
export function buildWorktreeMentionResults(query: string, sessions: MentionResult[] = []): MentionResult[] {
  if (!query) return [...WORKTREE_MENTION_ENTRIES]
  return rankMentionResults(query, [...WORKTREE_MENTION_ENTRIES, ...sessions])
}

/**
 * Build the mention attachments for a prompt. Sessions travel as `session:`
 * URLs the backend resolves into transcript context; worktrees travel as
 * metadata-only data URLs. Model references are inline text and never produce
 * an attachment, so they stay out of this list.
 */
export function buildWorktreeMentionFiles(
  text: string,
  sessions: Map<string, SessionSearchItem>,
  worktrees: WorktreeReference[],
): FileAttachment[] {
  return [...buildSessionAttachments(text, sessions), ...buildWorktreeAttachments(text, worktrees)]
}

export interface WorktreeMention {
  /** Mentioned past chats, keyed by their `@title` token in the text. */
  mentionedSessions: Accessor<Map<string, SessionSearchItem>>
  sessionPicker: Accessor<boolean>
  sessionCandidates: Accessor<SessionSearchItem[]>
  modelPicker: Accessor<boolean>
  worktreePicker: Accessor<boolean>
  worktreeCandidates: Accessor<WorktreeReference[]>
  mentionResults: Accessor<MentionResult[]>
  mentionIndex: Accessor<number>
  showMention: Accessor<boolean>
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
  selectModelReference: (providerID: string, modelID: string) => void
  setMentionIndex: (index: number) => void
  closeMention: () => void
  /** Attachments for the prompt text the user is about to send. */
  parseAttachments: (text: string) => FileAttachment[]
}

/**
 * `@`-mention state for the New Worktree dialog. Worktree-independent by
 * design: it offers inline model references, past chats and Agent Manager
 * worktrees, and builds only attachments that are safe before the new worktree
 * exists. The shared file/terminal/git entries are intentionally not offered.
 */
export function useWorktreeMention(vscode: VSCodeContext, worktrees: Accessor<WorktreeReference[]>): WorktreeMention {
  const [query, setQuery] = createSignal<string | null>(null)
  const [results, setResults] = createSignal<MentionResult[]>([])
  const [index, setIndex] = createSignal(0)
  const [candidates, setCandidates] = createSignal<SessionSearchItem[]>([])
  const [sessionPicker, setSessionPicker] = createSignal(false)
  const [worktreePicker, setWorktreePicker] = createSignal(false)
  const [modelPicker, setModelPicker] = createSignal(false)
  const [mentioned, setMentioned] = createSignal<Map<string, SessionSearchItem>>(new Map())
  // Model references are inline text, not files, so they are tracked apart and
  // never become attachments. They still count as completed mentions, so prose
  // typed after one closes the dropdown instead of reopening it.
  const models = new Set<string>()
  // The `@` offset the open query belongs to, and the dead query at that offset
  // that a dismissal or a completed mention closed on.
  let at = 0
  let dead: { at: number; query: string } | undefined
  // Set by onInput so replaceRange can tell whether execCommand produced the
  // input event that syncs the prompt signal.
  let sawInput = false
  let requested = false
  let ready = false
  let counter = 0
  let modelState: {
    textarea: HTMLTextAreaElement
    start: number
    end: number
    setText: (text: string) => void
    onSelect?: () => void
  } | null = null

  // Stale and busy worktrees stay out of the picker, like chat. The dialog
  // receives a reference list built without a selection, so the worktree the
  // user is currently in is still offered (see AgentManagerApp's dialog list).
  const worktreeCandidates = () => worktrees().filter((worktree) => !worktree.disabled)
  const showMention = () => query() !== null

  /** Every token the query could stand for, for prose detection. */
  const tokens = () =>
    new Set<string>([...mentioned().keys(), ...models, ...worktreeCandidates().map((worktree) => worktree.path)])

  const sessionResults = (value: string): MentionResult[] => {
    if (!value) return []
    return filterSessions(candidates(), value)
      .slice(0, SESSION_RESULT_LIMIT)
      .map((session) => ({ type: "session", value: sessionMentionToken(session, mentioned()), session }))
  }

  const close = () => {
    setQuery(null)
    setResults([])
    setIndex(0)
    setSessionPicker(false)
    setWorktreePicker(false)
    setModelPicker(false)
  }

  // The past-chat list is directory-scoped server-side; one fetch per dialog is
  // enough, since a session title is what a spaced query is matched against.
  const loadSessions = () => {
    if (requested) return
    requested = true
    vscode.postMessage({ type: "requestSessionSearch", requestId: `worktree-mention-session-${++counter}` })
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "sessionSearchResult") return
    if (message.requestId !== `worktree-mention-session-${counter}`) return
    ready = true
    setCandidates(
      message.sessions
        .map((session) => ({ ...session, title: sessionMentionText(session.title) }))
        .filter((session) => session.title)
        .sort((a, b) => b.updated - a.updated),
    )
    const open = query()
    if (open === null) return
    const next = buildWorktreeMentionResults(open, sessionResults(open))
    if (next.length === 0) {
      close()
      return
    }
    setResults(next)
  })
  onCleanup(unsubscribe)

  const onInput = (text: string, cursor: number) => {
    sawInput = true
    setSessionPicker(false)
    setWorktreePicker(false)
    setModelPicker(false)
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
    // Prose past a completed mention is not a longer query: close on it and
    // remember the dead query so the next keystroke does not reopen the menu.
    if (mentionSettled(value, tokens())) {
      dead = { at, query: value }
      close()
      return
    }
    dead = undefined
    loadSessions()
    const next = buildWorktreeMentionResults(value, sessionResults(value))
    if (next.length === 0) {
      // Past chats are the only non-entry match a query can have. Until their
      // list has arrived, a query that matches nothing yet may still match a
      // chat title, so the menu waits instead of closing.
      if (!ready) {
        setQuery(value)
        setResults([])
        setIndex(0)
        return
      }
      close()
      return
    }
    setQuery(value)
    setResults(next)
    setIndex(0)
  }

  /**
   * Replace a text range with mention text. The dialog's undo uses the native
   * undo stack, so insert through execCommand when a live textarea is present
   * (same as the chat composer) and fall back to a direct assignment where no
   * DOM is available.
   */
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
      // execCommand can silently no-op (for example when focus did not land)
      // and some edges skip the input event. Verify the insert and fall back to
      // a direct write so a picked mention is never dropped.
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

  /** Replace the open `@query` with `@token`, keeping a trailing space. */
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
    if (result.type === "model") {
      const cursor = textarea.selectionStart ?? textarea.value.length
      const match = textarea.value.substring(0, cursor).match(AT_PATTERN)
      if (!match) return
      const start = (match.index ?? 0) + (/^\s/.test(match[0]) ? 1 : 0)
      modelState = { textarea, start, end: cursor, setText, onSelect }
      close()
      setModelPicker(true)
      return
    }
    const token = result.type === "session" ? sessionMentionToken(result.session, mentioned()) : result.value
    if (result.type === "session") setMentioned((prev) => new Map(prev).set(token, result.session))
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

  const selectModelReference = (providerID: string, modelID: string) => {
    const state = modelState
    modelState = null
    setModelPicker(false)
    if (!state) return
    const textarea = state.textarea
    if (!textarea.isConnected) return
    const token = `${providerID}/${modelID}`
    const suffix = /^\s/.test(textarea.value.substring(state.end)) ? "" : " "
    models.add(token)
    replaceRange(textarea, state.start, state.end, `@${token}${suffix}`, state.setText)
    state.onSelect?.()
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

  return {
    mentionedSessions: mentioned,
    sessionPicker,
    sessionCandidates: candidates,
    modelPicker,
    worktreePicker,
    worktreeCandidates,
    mentionResults: results,
    mentionIndex: index,
    showMention,
    onInput,
    onKeyDown,
    selectMention,
    selectSession,
    selectWorktree,
    selectModelReference,
    setMentionIndex: setIndex,
    closeMention: close,
    parseAttachments: (text) => buildWorktreeMentionFiles(text, mentioned(), worktreeCandidates()),
  }
}
