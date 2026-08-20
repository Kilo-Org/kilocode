import { createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import type { useVSCode } from "../src/context/vscode"
import type { ReviewComment } from "../diff-viewer/review-comments"
export interface DocumentMessage {
  type?: "document.result" | "agentManager.document"
  sessionId: string
  contextKey?: string
  file: string
  requestedFile?: string
  content?: string
  kind?: "text" | "image"
  mime?: string
  data?: string
  error?: string
}

export interface DocumentTab {
  id: string
  file: string
  sessionId?: string
  line?: number
  column?: number
}

export interface DocumentData {
  file: string
  content?: string
  kind?: "text" | "image"
  mime?: string
  data?: string
  error?: string
  loading: boolean
}

function key(context: string, file: string): string {
  return `${context}:${file}`
}

export function isMarkdownPath(file: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(file)
}

export function createDocuments(
  vscode: ReturnType<typeof useVSCode>,
  context: Accessor<string | null>,
  session: Accessor<string | null> = context,
  send: (sessionId: string, file: string, contextKey: string) => void = (sessionId, file, contextKey) =>
    vscode.postMessage({ type: "agentManager.requestDocument", sessionId, file, contextKey }),
) {
  const [tabs, setTabs] = createSignal<Record<string, DocumentTab[]>>({})
  const [active, setActive] = createSignal<Record<string, string | undefined>>({})
  const [data, setData] = createSignal<Record<string, DocumentData>>({})

  const current = () => context() ?? ""
  const list = () => tabs()[current()] ?? []
  const selected = () => active()[current()]
  const document = (file: string) => data()[key(current(), file)]

  const request = (file: string, sessionId = session() ?? "", contextKey = current()) => {
    const ctx = current()
    if (!ctx) return
    const id = key(ctx, file)
    setData((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { file }), file, loading: true, error: undefined } }))
    send(sessionId, file, contextKey)
  }

  const open = (file: string, sessionId = session() ?? "", line?: number, column?: number) => {
    const ctx = current()
    if (!ctx || !file) return
    setTabs((prev) => {
      const list = prev[ctx] ?? []
      const id = key(ctx, file)
      if (list.some((tab) => tab.id === id)) {
        return { ...prev, [ctx]: list.map((tab) => (tab.id === id ? { ...tab, sessionId, line, column } : tab)) }
      }
      return { ...prev, [ctx]: [...list, { id, file, sessionId, line, column }] }
    })
    setActive((prev) => ({ ...prev, [ctx]: key(ctx, file) }))
    request(file, sessionId)
    return true
  }

  const select = (id: string) => {
    const ctx = current()
    if (!ctx) return
    const tab = (tabs()[ctx] ?? []).find((item) => item.id === id)
    if (!tab) return
    setActive((prev) => ({ ...prev, [ctx]: id }))
    if (!document(tab.file)) request(tab.file, tab.sessionId)
  }

  const close = (id: string) => {
    const ctx = current()
    const list = tabs()[ctx] ?? []
    const index = list.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const next = list.filter((tab) => tab.id !== id)
    setTabs((prev) => ({ ...prev, [ctx]: next }))
    if (active()[ctx] !== id) return
    const target = next[Math.min(index, next.length - 1)]
    setActive((prev) => ({ ...prev, [ctx]: target?.id }))
  }

  const closeOthers = (id: string) => {
    const ctx = current()
    const tab = (tabs()[ctx] ?? []).find((item) => item.id === id)
    if (!tab) return
    setTabs((prev) => ({ ...prev, [ctx]: [tab] }))
    setActive((prev) => ({ ...prev, [ctx]: id }))
  }

  const reorder = (from: string, to: string) => {
    const ctx = current()
    const list = tabs()[ctx] ?? []
    const fromIndex = list.findIndex((tab) => tab.id === from)
    const toIndex = list.findIndex((tab) => tab.id === to)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    const next = [...list]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item!)
    setTabs((prev) => ({ ...prev, [ctx]: next }))
  }

  const onMessage = (message: DocumentMessage) => {
    const id = key(message.contextKey ?? message.sessionId, message.requestedFile ?? message.file)
    setData((prev) => ({
      ...prev,
      [id]: {
        file: message.file,
        content: message.content,
        kind: message.kind,
        mime: message.mime,
        data: message.data,
        error: message.error,
        loading: false,
      },
    }))
  }

  return { tabs: list, active: selected, document, open, select, close, closeOthers, reorder, onMessage, request }
}

export function createDocumentComments(context: Accessor<string | null>) {
  const [byContext, setByContext] = createSignal<Record<string, ReviewComment[]>>({})
  const comments = () => {
    const ctx = context()
    return ctx ? (byContext()[ctx] ?? []) : []
  }
  const setComments = (value: ReviewComment[]) => {
    const ctx = context()
    if (!ctx) return
    setByContext((prev) => ({ ...prev, [ctx]: value }))
  }
  return { comments, setComments }
}

export function createDocumentInspector(
  vscode: ReturnType<typeof useVSCode>,
  context: Accessor<string | null>,
  project: Accessor<string | undefined>,
  isOpen: Accessor<boolean>,
  openPanel: () => void,
  closePanel: () => void,
) {
  const scope = () => `${project() ?? "single"}:${context() ?? ""}`
  const documents = createDocuments(vscode, scope, context)
  const comments = createDocumentComments(scope)
  const open = (file?: string, sessionId?: string, line?: number, column?: number) => {
    if (!file) {
      openPanel()
      return true
    }
    const sid = sessionId ?? context()
    if (!sid || !documents.open(file, sid, line, column)) return false
    openPanel()
    return true
  }
  onMount(() => {
    const handler = (event: Event) => handleDocumentOpen(event, open)
    const message = vscode.onMessage((item) => {
      if (item.type === "document.result" || item.type === "agentManager.document") documents.onMessage(item)
    })
    window.addEventListener("kilo:open-file", handler)
    onCleanup(() => {
      window.removeEventListener("kilo:open-file", handler)
      message()
    })
  })
  // The toolbar button is a way back to already-open documents, not a way to
  // open an empty panel: documents arrive from a file reference or a diff row.
  // Tabs are keyed per worktree, so this hides itself on a worktree with none,
  // and stays visible while the panel is open so it can still be toggled shut.
  const available = () => documents.tabs().length > 0 || isOpen()
  const openFile = (file: string, line?: number, column?: number) => {
    const sessionId = context()
    if (sessionId) vscode.postMessage({ type: "agentManager.openFile", sessionId, filePath: file, line, column })
  }
  const toggle = () => (isOpen() ? closePanel() : open())
  return { documents, comments, open, openFile, toggle, available, isOpen, scope }
}

export function handleDocumentOpen(
  event: Event,
  open: (file: string, sessionId?: string, line?: number, column?: number) => boolean,
): void {
  const detail = (event as CustomEvent<{ filePath?: unknown; sessionID?: unknown; line?: unknown; column?: unknown }>)
    .detail
  const file = detail?.filePath
  if (typeof file !== "string" || !file) return
  const sessionId = typeof detail.sessionID === "string" ? detail.sessionID : undefined
  const line = typeof detail.line === "number" ? detail.line : undefined
  const column = typeof detail.column === "number" ? detail.column : undefined
  if (open(file, sessionId, line, column)) event.preventDefault()
}
