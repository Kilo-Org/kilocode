import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { FileAttachment, WebviewMessage, ExtensionMessage } from "../types/messages"
import {
  AT_PATTERN,
  syncMentionedPaths as _syncMentionedPaths,
  buildFileAttachments,
  buildMentionResults,
  filterMentionResults,
  isCursorAtMentionEnd,
  getMentionRemovalRange,
  findMentionRange,
  type MentionResult,
} from "./file-mention-utils"

const FILE_SEARCH_DEBOUNCE_MS = 150

const rtl = (textarea: HTMLTextAreaElement): boolean => {
  if (textarea.matches(":dir(rtl)")) return true
  if (textarea.matches(":dir(ltr)")) return false
  return getComputedStyle(textarea).direction === "rtl"
}

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface FileMention {
  mentionedPaths: Accessor<Set<string>>
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
}

export function useFileMention(
  vscode: VSCodeContext,
  sessionID?: Accessor<string | undefined>,
  git?: Accessor<boolean>,
): FileMention {
  const [mentionedPaths, setMentionedPaths] = createSignal<Set<string>>(new Set())
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null)
  const [mentionResults, setMentionResults] = createSignal<MentionResult[]>([])
  const [mentionIndex, setMentionIndex] = createSignal(0)
  let workspaceDir = ""
  // Accumulates every path ever mentioned so syncMentionedPaths can
  // rediscover them after a native undo restores the text.
  const knownPaths = new Set<string>()

  let fileSearchTimer: ReturnType<typeof setTimeout> | undefined
  let fileSearchCounter = 0

  const showMention = () => mentionQuery() !== null

  createEffect(() => {
    if (!showMention()) setMentionIndex(0)
  })

  const unsubscribe = vscode.onMessage((message) => {
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
  }

  const syncMentionedPaths = (text: string) => {
    setMentionedPaths(() => _syncMentionedPaths(knownPaths, text))
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

    // Add to knownPaths BEFORE execCommand so syncMentionedPaths (triggered
    // by the input event) can discover the new path.
    if (result.type === "file" || result.type === "folder" || result.type === "opened-file")
      knownPaths.add(result.value)

    // Replace the @query with the selected @path via execCommand so the
    // change lands on the browser's native undo stack. AT_PATTERN is
    // guaranteed to match here — the dropdown only opens when it matched.
    const match = before.match(AT_PATTERN)!
    const prefix = /^\s/.test(match[0]) ? 1 : 0
    const atPos = match.index! + prefix
    const suffix = /^\s/.test(after) ? "" : " "
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
    closeMention()
    onSelect?.()
  }

  // When true, onInput skips dropdown logic (used during execCommand changes)
  let suppress = false

  const onInput = (val: string, cursor: number) => {
    syncMentionedPaths(val)
    if (suppress) return
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

  const parseFileAttachments = (text: string): FileAttachment[] =>
    buildFileAttachments(text, mentionedPaths(), workspaceDir)

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
    if (!isCursorAtMentionEnd(val, cursor - 1, mentionedPaths())) return false

    // Cursor is on the space right after a mention — remove the entire
    // mention + trailing space in one step via execCommand so the change
    // lands on the browser's native undo stack.
    const range = getMentionRemovalRange(val, cursor - 1, mentionedPaths())
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

  const handleArrowKey = (e: KeyboardEvent, textarea: HTMLTextAreaElement | undefined): boolean => {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || !textarea) return false
    // Don't interfere with selection (Shift) or word/line navigation (Ctrl/Cmd/Alt)
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false
    const cursor = textarea.selectionStart ?? 0
    // Only when there's no active selection
    if (textarea.selectionStart !== textarea.selectionEnd) return false

    const forward = e.key === (rtl(textarea) ? "ArrowLeft" : "ArrowRight")
    // Check where the cursor WOULD land after the native move
    const next = forward ? cursor + 1 : cursor - 1
    const range = findMentionRange(textarea.value, next, mentionedPaths())
    if (!range) return false

    e.preventDefault()
    const pos = forward ? range.end : range.start
    textarea.setSelectionRange(pos, pos)
    return true
  }

  let snapping = false
  const snapSelection = (textarea: HTMLTextAreaElement): void => {
    if (snapping) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    if (start === end) return // cursor, not a selection

    const val = textarea.value
    const paths = mentionedPaths()
    let snapped = start
    let snappedEnd = end

    const startRange = findMentionRange(val, start, paths)
    if (startRange) snapped = startRange.start

    const endRange = findMentionRange(val, end, paths)
    if (endRange) snappedEnd = endRange.end

    if (snapped !== start || snappedEnd !== end) {
      snapping = true
      textarea.setSelectionRange(snapped, snappedEnd, textarea.selectionDirection)
      snapping = false
    }
  }

  const seedFromText = (text: string) => {
    const re = /@([\w./-]+\.[\w]+|[\w.-]+\/[\w./-]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      knownPaths.add(m[1])
    }
    syncMentionedPaths(text)
  }

  return {
    mentionedPaths,
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
  }
}
