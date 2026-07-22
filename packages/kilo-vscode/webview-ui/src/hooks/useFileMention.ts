import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { FileAttachment, SessionSearchItem, WebviewMessage, ExtensionMessage } from "../types/messages"
import {
  AT_PATTERN,
  syncMentionedPaths as _syncMentionedPaths,
  buildFileAttachments,
  buildMentionResults,
  buildSessionAttachments,
  filterMentionResults,
  isCursorAtMentionEnd,
  getMentionRemovalRange,
  findMentionRange,
  sessionMentionText,
  syncMentionedSessions as _syncMentionedSessions,
  FILE_PICKER_RESULT,
  type MentionResult,
} from "./file-mention-utils"

const FILE_SEARCH_DEBOUNCE_MS = 150

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface FileMention {
  mentionedPaths: Accessor<Set<string>>
  /** Mentioned past chats, keyed by their `@title` token in the text. */
  mentionedSessions: Accessor<Map<string, SessionSearchItem>>
  /** Whether the past-chat session picker (AM-style search) is open. */
  sessionPicker: Accessor<boolean>
  /** Directory-scoped past chats shown in the session picker. */
  sessionCandidates: Accessor<SessionSearchItem[]>
  mentionResults: Accessor<MentionResult[]>
  mentionIndex: Accessor<number>
  showMention: Accessor<boolean>
  onInput: (val: string, cursor: number) => void
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
  setMentionIndex: (index: number) => void
  closeMention: () => void
  parseFileAttachments: (text: string) => FileAttachment[]
  /** Register paths as active mentions (used by drag-and-drop). Pass cwd to ensure buildFileAttachments resolves correctly. */
  addPaths: (paths: string[], cwd: string) => void
  /**
   * Handle backspace for atomic mention removal. Returns true if the
   * event was consumed.
   */
  handleBackspace: (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    adjust?: () => void,
  ) => boolean
  /**
   * Skip the cursor over a mention when pressing ArrowLeft/ArrowRight.
   * Returns true if the event was consumed.
   */
  handleArrowKey: (e: KeyboardEvent, textarea: HTMLTextAreaElement | undefined) => boolean
  /**
   * Snap a partial text selection so it fully covers any mention that is
   * only partially selected. Call from the textarea's onSelect handler.
   */
  snapSelection: (textarea: HTMLTextAreaElement) => void
  /** Seed known paths from existing text (e.g. after undo restores a draft). */
  seedFromText: (text: string) => void
  /** Insert a file-picker result at the stored cursor position. Ignored unless requestId matches the pending request. */
  insertFilePickerResult: (path: string, requestId: string) => void
  /**
   * Seed known paths from a set of already-confirmed exact paths (e.g. a
   * reverted message's file attachments), then prune against `text`. Prefer
   * this over seedFromText when exact paths are available, since seedFromText
   * cannot correctly rediscover paths containing spaces from raw text alone.
   */
  seedFromParts: (paths: string[], text: string) => void
  /**
   * Seed mentioned past chats (e.g. from a reverted message's session
   * attachments), then prune against `text`.
   */
  seedSessions: (sessions: SessionSearchItem[], text: string) => void
  /** Insert a session picked from the past-chat picker as an @-mention. */
  selectSession: (
    session: SessionSearchItem,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => void
}

export function useFileMention(
  vscode: VSCodeContext,
  sessionID?: Accessor<string | undefined>,
  git?: Accessor<boolean>,
): FileMention {
  const [mentionedPaths, setMentionedPaths] = createSignal<Set<string>>(new Set())
  const [mentionedSessions, setMentionedSessions] = createSignal<Map<string, SessionSearchItem>>(new Map())
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null)
  const [mentionResults, setMentionResults] = createSignal<MentionResult[]>([])
  const [mentionIndex, setMentionIndex] = createSignal(0)
  const [sessionPicker, setSessionPicker] = createSignal(false)
  const [sessionCandidates, setSessionCandidates] = createSignal<SessionSearchItem[]>([])
  let workspaceDir = ""
  // Accumulates every path ever mentioned so syncMentionedPaths can
  // rediscover them after a native undo restores the text.
  const knownPaths = new Set<string>()
  // Same accumulation for past-chat mentions, keyed by their title token.
  const knownSessions = new Map<string, SessionSearchItem>()

  let fileSearchTimer: ReturnType<typeof setTimeout> | undefined
  let fileSearchCounter = 0
  let filePickerCounter = 0
  let sessionSearchCounter = 0
  let pickerState: {
    requestId: string
    textarea: HTMLTextAreaElement
    atStart: number
    atEnd: number
    setText: (text: string) => void
    onSelect?: () => void
  } | null = null
  let pendingArrowSnap: { timer: ReturnType<typeof setTimeout>; prevValue: string; prevPosition: number } | undefined

  const showMention = () => mentionQuery() !== null

  createEffect(() => {
    if (!showMention()) setMentionIndex(0)
  })

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "sessionSearchResult") {
      if (message.requestId !== `session-search-${sessionSearchCounter}`) return
      // Most recently updated first; with a query the List re-ranks by fuzzy score.
      setSessionCandidates(
        message.sessions
          .map((session) => ({ ...session, title: sessionMentionText(session.title) }))
          .filter((session) => session.title)
          .sort((a, b) => b.updated - a.updated),
      )
      return
    }
    if (message.type !== "fileSearchResult") return
    if (message.requestId === `file-search-${fileSearchCounter}`) {
      const items = message.items ?? message.paths.map((path) => ({ path, type: "file" as const }))
      workspaceDir = message.dir
      setMentionResults(buildMentionResults(mentionQuery() ?? "", items, git?.() ?? true))
      setMentionIndex(0)
    }
  })

  onCleanup(() => {
    unsubscribe()
    if (fileSearchTimer) clearTimeout(fileSearchTimer)
    if (pendingArrowSnap) clearTimeout(pendingArrowSnap.timer)
  })

  const requestFileSearch = (query: string) => {
    if (fileSearchTimer) clearTimeout(fileSearchTimer)
    fileSearchTimer = setTimeout(() => {
      fileSearchCounter++
      const id = sessionID?.()
      vscode.postMessage({
        type: "requestFileSearch",
        query,
        requestId: `file-search-${fileSearchCounter}`,
        ...(id ? { sessionID: id } : {}),
      })
    }, FILE_SEARCH_DEBOUNCE_MS)
  }

  const closeMention = () => {
    setMentionQuery(null)
    setMentionResults([])
    setSessionPicker(false)
  }

  const closeSessionPicker = () => {
    setSessionPicker(false)
  }

  const syncMentionedPaths = (text: string) => {
    setMentionedPaths(() => _syncMentionedPaths(knownPaths, text))
    setMentionedSessions(() => _syncMentionedSessions(knownSessions, text))
  }

  // The past-chat picker searches a directory-scoped session list client-side
  // (fuzzysort via the kilo-ui List component, same as the Agent Manager
  // session search). Candidates are refetched each time the picker opens.
  const openSessionPicker = () => {
    setSessionPicker(true)
    sessionSearchCounter++
    const id = sessionID?.()
    vscode.postMessage({
      type: "requestSessionSearch",
      requestId: `session-search-${sessionSearchCounter}`,
      ...(id ? { sessionID: id } : {}),
    })
  }

  const selectMention = (
    result: MentionResult,
    textarea: HTMLTextAreaElement,
    _setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const val = textarea.value
    const cursor = textarea.selectionStart ?? val.length
    const before = val.substring(0, cursor)
    const after = val.substring(cursor)

    if (result.type === "file-picker") {
      const match = before.match(AT_PATTERN)!
      const prefix = /^\s/.test(match[0]) ? 1 : 0
      const atPos = match.index! + prefix
      filePickerCounter++
      const requestId = `file-picker-${filePickerCounter}`
      pickerState = { requestId, textarea, atStart: atPos, atEnd: cursor, setText: _setText, onSelect }
      closeMention()
      vscode.postMessage({ type: "requestFilePicker", requestId })
      return
    }

    if (result.type === "past-chats") {
      // Switch the dropdown into the AM-style session search; the actual
      // insertion happens when a session is picked there.
      openSessionPicker()
      return
    }

    // Add to knownPaths BEFORE execCommand so syncMentionedPaths (triggered
    // by the input event) can discover the new path.
    if (result.type === "file" || result.type === "folder" || result.type === "opened-file")
      knownPaths.add(result.value)
    if (result.type === "session") knownSessions.set(result.value, result.session)

    // Replace the @query with the selected @path via execCommand so the
    // change lands on the browser's native undo stack. AT_PATTERN is
    // guaranteed to match here — the dropdown only opens when it matched.
    const match = before.match(AT_PATTERN)!
    const prefix = /^\s/.test(match[0]) ? 1 : 0
    const atPos = match.index! + prefix
    const suffix = /^\s/.test(after) ? "" : " "
    // Restore focus before execCommand: pickers (session search, native file
    // dialog) move focus away from the textarea, which makes execCommand
    // silently no-op.
    textarea.focus()
    suppress = true
    try {
      textarea.setSelectionRange(atPos, cursor)
      document.execCommand("insertText", false, `@${result.value}${suffix}`)
    } finally {
      suppress = false
    }

    textarea.focus()

    if (result.type === "file" || result.type === "folder" || result.type === "opened-file")
      setMentionedPaths((prev) => new Set([...prev, result.value]))
    if (result.type === "session") setMentionedSessions((prev) => new Map(prev).set(result.value, result.session))
    closeMention()
    onSelect?.()
  }

  const selectSession = (
    session: SessionSearchItem,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => selectMention({ type: "session", value: session.title, session }, textarea, setText, onSelect)

  // When true, onInput skips dropdown logic (used during execCommand changes)
  let suppress = false

  const onInput = (val: string, cursor: number) => {
    syncMentionedPaths(val)
    if (suppress) return
    closeSessionPicker()
    const before = val.substring(0, cursor)
    const match = before.match(AT_PATTERN)
    if (match) {
      const query = match[1] ?? ""
      setMentionQuery(query)
      setMentionResults((prev) => {
        const next = filterMentionResults(query, prev)
        if (next.length) return next
        return buildMentionResults(query, [], git?.() ?? true)
      })
      setMentionIndex(0)
      requestFileSearch(query)
    } else {
      closeMention()
    }
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
      setMentionIndex((i) => Math.min(i + 1, Math.max(mentionResults().length - 1, 0)))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setMentionIndex((i) => Math.max(i - 1, 0))
      return true
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const result = mentionResults()[mentionIndex()]
      if (!result) return false
      e.preventDefault()
      if (textarea) selectMention(result, textarea, setText, onSelect)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      closeMention()
      return true
    }

    return false
  }

  const addPaths = (paths: string[], cwd: string) => {
    if (cwd) workspaceDir = cwd
    for (const p of paths) knownPaths.add(p)
    setMentionedPaths((prev) => {
      const next = new Set(prev)
      for (const p of paths) next.add(p)
      return next
    })
  }

  // Mention tokens that count as atomic units for cursor movement, deletion
  // and selection snapping: file paths plus past-chat title tokens.
  const mentionTokens = () => new Set([...mentionedPaths(), ...mentionedSessions().keys()])

  const parseFileAttachments = (text: string): FileAttachment[] => [
    ...buildFileAttachments(text, mentionedPaths(), workspaceDir),
    ...buildSessionAttachments(text, mentionedSessions()),
  ]

  const handleBackspace = (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    _setText: (text: string) => void,
    _adjust?: () => void,
  ): boolean => {
    if (e.key !== "Backspace" || e.isComposing || !textarea) return false

    const val = textarea.value
    const cursor = textarea.selectionStart ?? 0
    if (textarea.selectionStart !== textarea.selectionEnd) return false

    const charBefore = val[cursor - 1]
    if (charBefore !== " " && charBefore !== "\n") return false
    if (!isCursorAtMentionEnd(val, cursor - 1, mentionTokens())) return false

    // Cursor is on the space right after a mention — remove the entire
    // mention + trailing space in one step via execCommand so the change
    // lands on the browser's native undo stack.
    const range = getMentionRemovalRange(val, cursor - 1, mentionTokens())
    if (!range) return false

    e.preventDefault()
    suppress = true
    try {
      textarea.setSelectionRange(range.start, range.end)
      document.execCommand("insertText", false, "")
    } finally {
      suppress = false
    }
    return true
  }

  const resolvePendingArrowSnap = (textarea: HTMLTextAreaElement) => {
    const pending = pendingArrowSnap
    if (!pending) return

    clearTimeout(pending.timer)
    pendingArrowSnap = undefined

    if (textarea.value !== pending.prevValue) return
    const start = textarea.selectionStart ?? 0
    const end = textarea.selectionEnd ?? 0
    if (start !== end) return

    if (start === pending.prevPosition) return

    const range = findMentionRange(pending.prevValue, start, mentionTokens())
    if (!range) return

    const pos = start > pending.prevPosition ? range.end : range.start
    if (pos === start) return

    textarea.setSelectionRange(pos, pos)
  }

  const handleArrowKey = (e: KeyboardEvent, textarea: HTMLTextAreaElement | undefined): boolean => {
    if (!textarea) return false
    resolvePendingArrowSnap(textarea)

    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false
    // Don't interfere with selection (Shift) or word/line navigation (Ctrl/Cmd/Alt)
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false
    // Only when there's no active selection
    if (textarea.selectionStart !== textarea.selectionEnd) return false

    const prevPosition = textarea.selectionStart ?? 0
    const prevValue = textarea.value

    // Let the textarea perform its native bidi-aware caret move,
    // then read the updated selection and snap only if it landed inside a mention.
    const timer = setTimeout(() => {
      resolvePendingArrowSnap(textarea)
    }, 0)
    pendingArrowSnap = { timer, prevValue, prevPosition }
    return false
  }

  let snapping = false
  let last: { start: number; end: number } | undefined
  const snapSelection = (textarea: HTMLTextAreaElement): void => {
    if (snapping) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const dir = textarea.selectionDirection
    if (start === end) {
      last = undefined
      return // cursor, not a selection
    }

    const val = textarea.value
    const paths = mentionTokens()
    let snapped = start
    let snappedEnd = end

    const startRange = findMentionRange(val, start, paths)
    if (startRange) {
      const shrink = dir === "backward" && last?.start === startRange.start && last.end === end
      snapped = shrink ? startRange.end : startRange.start
    }

    const endRange = findMentionRange(val, end, paths)
    if (endRange) {
      const shrink = dir === "forward" && last?.start === start && last.end === endRange.end
      snappedEnd = shrink ? endRange.start : endRange.end
    }

    if (snapped !== start || snappedEnd !== end) {
      snapping = true
      textarea.setSelectionRange(snapped, snappedEnd, dir)
      snapping = false
    }
    last = { start: snapped, end: snappedEnd }
  }

  const seedFromText = (text: string) => {
    // The optional drive-letter prefix is scoped to a single letter directly after
    // @ (e.g. "C:") so a colon elsewhere in the match (as in "@https://example.com")
    // doesn't get mistaken for a Windows path.
    const re = /@((?:[A-Za-z]:)?(?:[\w./-]+\.[\w]+|[\w.-]+\/[\w./-]+))/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      knownPaths.add(m[1])
    }
    syncMentionedPaths(text)
  }

  const insertFilePickerResult = (path: string, requestId: string) => {
    const state = pickerState
    if (!state || state.requestId !== requestId) return
    if (!path) {
      pickerState = null
      return
    }
    const norm = path.replaceAll("\\", "/")
    pickerState = null
    const textarea = state.textarea
    if (!textarea.isConnected) return
    const after = textarea.value.substring(state.atEnd)
    const suffix = /^\s/.test(after) ? "" : " "
    // Insert as a styled @mention so it renders like any other file reference and
    // is clickable to preview (openFile is a plain editor action on the user's own
    // disk, unrelated to the AI permission system). The actual security boundary
    // lives in buildFileAttachments: paths outside the workspace are never turned
    // into an auto-read FileAttachment, regardless of how they were mentioned, so
    // a prior "deny" decision can't be bypassed by picking/attaching this way. If
    // the model wants the file's contents it must call the Read tool, which
    // enforces the normal external-directory permission checks.
    // Restore focus before execCommand: after the native dialog closes the textarea
    // is no longer the active element, so execCommand would otherwise silently no-op.
    textarea.focus()
    suppress = true
    try {
      textarea.setSelectionRange(state.atStart, state.atEnd)
      document.execCommand("insertText", false, `@${norm}${suffix}`)
    } finally {
      suppress = false
    }
    knownPaths.add(norm)
    setMentionedPaths((prev) => new Set([...prev, norm]))
    syncMentionedPaths(textarea.value)
    state.setText(textarea.value)
    state.onSelect?.()
  }

  // Seed known paths from a set of already-confirmed exact paths (e.g. the
  // file attachments of a message being restored after a revert), then prune
  // mentionedPaths against the current text. Unlike seedFromText, this does
  // not re-derive candidate paths from the text via regex: that regex cannot
  // distinguish a complete mention from a truncated prefix when the real
  // path contains a space (e.g. it would discover only "dir/my" from
  // "@dir/my report.txt", which then passes syncMentionedPaths' boundary
  // check too, since a real space genuinely follows "my" in the full name).
  const seedFromParts = (paths: string[], text: string) => {
    for (const p of paths) knownPaths.add(p)
    syncMentionedPaths(text)
  }

  const seedSessions = (sessions: SessionSearchItem[], text: string) => {
    for (const session of sessions) {
      const token = sessionMentionText(session.title)
      if (token) knownSessions.set(token, { ...session, title: token })
    }
    syncMentionedPaths(text)
  }

  return {
    mentionedPaths,
    mentionedSessions,
    sessionPicker,
    sessionCandidates,
    mentionResults,
    mentionIndex,
    showMention,
    onInput,
    onKeyDown,
    selectMention,
    setMentionIndex,
    closeMention,
    parseFileAttachments,
    addPaths,
    handleBackspace,
    handleArrowKey,
    snapSelection,
    seedFromText,
    insertFilePickerResult,
    seedFromParts,
    seedSessions,
    selectSession,
  }
}
