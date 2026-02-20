import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { FileAttachment, WebviewMessage, ExtensionMessage } from "../types/messages"

const FILE_SEARCH_DEBOUNCE_MS = 150
const AT_PATTERN = /(?:^|\s)@(\S*)$/

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface FileMention {
  mentionedPaths: Accessor<Set<string>>
  mentionResults: Accessor<string[]>
  mentionIndex: Accessor<number>
  showMention: Accessor<boolean>
  onInput: (val: string, cursor: number) => void
  onKeyDown: (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => boolean
  selectFile: (
    path: string,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => void
  setMentionIndex: (index: number) => void
  closeMention: () => void
  parseFileAttachments: (text: string) => FileAttachment[]
}

export function useFileMention(vscode: VSCodeContext): FileMention {
  const [mentionedPaths, setMentionedPaths] = createSignal<Set<string>>(new Set())
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null)
  const [mentionResults, setMentionResults] = createSignal<string[]>([])
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
      setMentionResults(result.paths)
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
    setMentionedPaths((prev) => {
      const next = new Set<string>()
      for (const path of prev) {
        if (text.includes(`@${path}`)) next.add(path)
      }
      return next
    })
  }

  const selectMentionFile = (
    path: string,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const val = textarea.value
    const cursor = textarea.selectionStart ?? val.length
    const before = val.substring(0, cursor)
    const after = val.substring(cursor)

    const replaced = before.replace(AT_PATTERN, (match) => {
      const prefix = match.startsWith(" ") ? " " : ""
      return `${prefix}@${path}`
    })
    const newText = replaced + after
    textarea.value = newText
    setText(newText)

    const newCursor = replaced.length
    textarea.setSelectionRange(newCursor, newCursor)
    textarea.focus()

    setMentionedPaths((prev) => new Set([...prev, path]))
    closeMention()
    onSelect?.()
  }

  const onInput = (val: string, cursor: number) => {
    syncMentionedPaths(val)
    const before = val.substring(0, cursor)
    const match = before.match(AT_PATTERN)
    if (match) {
      setMentionQuery(match[1])
      requestFileSearch(match[1])
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

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setMentionIndex((i) => Math.min(i + 1, mentionResults().length - 1))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setMentionIndex((i) => Math.max(i - 1, 0))
      return true
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const path = mentionResults()[mentionIndex()]
      if (!path) return false
      e.preventDefault()
      if (textarea) selectMentionFile(path, textarea, setText, onSelect)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      closeMention()
      return true
    }

    return false
  }

  const parseFileAttachments = (text: string): FileAttachment[] => {
    const paths = mentionedPaths()
    const result: FileAttachment[] = []
    const dir = workspaceDir.replaceAll("\\", "/")
    for (const path of paths) {
      if (text.includes(`@${path}`)) {
        const abs = path.startsWith("/") ? path : `${dir}/${path}`
        const url = new URL("file://")
        url.pathname = abs.startsWith("/") ? abs : `/${abs}`
        result.push({ mime: "text/plain", url: url.href })
      }
    }
    return result
  }

  return {
    mentionedPaths,
    mentionResults,
    mentionIndex,
    showMention,
    onInput,
    onKeyDown,
    selectFile: selectMentionFile,
    setMentionIndex,
    closeMention,
    parseFileAttachments,
  }
}
