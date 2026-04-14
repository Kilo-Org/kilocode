import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { FileAttachment, WebviewMessage, ExtensionMessage } from "../types/messages"
import {
  AT_PATTERN,
  syncMentionedPaths as _syncMentionedPaths,
  buildTextAfterMentionSelect,
  buildFileAttachments,
  buildMentionResults,
  type MentionResult,
} from "./file-mention-utils"

const FILE_SEARCH_DEBOUNCE_MS = 150

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
}

export function useFileMention(vscode: VSCodeContext): FileMention {
  const [mentionedPaths, setMentionedPaths] = createSignal<Set<string>>(new Set())
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null)
  const [mentionResults, setMentionResults] = createSignal<MentionResult[]>([])
  const [mentionIndex, setMentionIndex] = createSignal(0)
  let workspaceDir = ""

  let fileSearchTimer: ReturnType<typeof setTimeout> | undefined
  let fileSearchCounter = 0

  const showMention = () => mentionQuery() !== null

  createEffect(() => {
    if (!showMention()) setMentionIndex(0)
  })

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "fileSearchResult") return
    const result = message as { type: "fileSearchResult"; paths: string[]; dir: string; requestId: string }
    if (result.requestId === `file-search-${fileSearchCounter}`) {
      workspaceDir = result.dir
      setMentionResults(buildMentionResults(mentionQuery() ?? "", result.paths))
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
      vscode.postMessage({ type: "requestFileSearch", query, requestId: `file-search-${fileSearchCounter}` })
    }, FILE_SEARCH_DEBOUNCE_MS)
  }

  const closeMention = () => {
    setMentionQuery(null)
    setMentionResults([])
  }

  const syncMentionedPaths = (text: string) => {
    setMentionedPaths((prev) => _syncMentionedPaths(prev, text))
  }

  const selectMention = (
    result: MentionResult,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const val = textarea.value
    const cursor = textarea.selectionStart ?? val.length
    const before = val.substring(0, cursor)
    const after = val.substring(cursor)

    const text = buildTextAfterMentionSelect(before, after, result.value)
    textarea.value = text
    setText(text)

    // Position cursor right after the inserted @mention
    const pos = text.length - after.length
    textarea.setSelectionRange(pos, pos)
    textarea.focus()

    if (result.type === "file") setMentionedPaths((prev) => new Set([...prev, result.value]))
    closeMention()
    onSelect?.()
  }

  const onInput = (val: string, cursor: number) => {
    syncMentionedPaths(val)
    const before = val.substring(0, cursor)
    const match = before.match(AT_PATTERN)
    if (match) {
      const query = match[1] ?? ""
      setMentionQuery(query)
      setMentionResults(buildMentionResults(query, []))
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
    setMentionedPaths((prev) => {
      const next = new Set(prev)
      for (const p of paths) next.add(p)
      return next
    })
  }

  const parseFileAttachments = (text: string): FileAttachment[] =>
    buildFileAttachments(text, mentionedPaths(), workspaceDir)

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
  }
}
