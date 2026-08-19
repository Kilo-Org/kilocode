import { createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import type { useVSCode } from "../../src/context/vscode"
import type { ReviewComment } from "../../diff-viewer/review-comments"
import type { AgentManagerDocumentMessage } from "../../src/types/messages"

export interface DocumentTab {
  id: string
  file: string
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

export function createDocuments(vscode: ReturnType<typeof useVSCode>, context: Accessor<string | null>) {
  const [tabs, setTabs] = createSignal<Record<string, DocumentTab[]>>({})
  const [active, setActive] = createSignal<Record<string, string | undefined>>({})
  const [data, setData] = createSignal<Record<string, DocumentData>>({})

  const current = () => context() ?? ""
  const list = () => tabs()[current()] ?? []
  const selected = () => active()[current()]
  const document = (file: string) => data()[key(current(), file)]

  const request = (file: string) => {
    const ctx = current()
    if (!ctx) return
    const id = key(ctx, file)
    setData((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { file }), file, loading: true, error: undefined } }))
    vscode.postMessage({ type: "agentManager.requestDocument", sessionId: ctx, file })
  }

  const open = (file: string) => {
    const ctx = current()
    if (!ctx || !file) return
    setTabs((prev) => {
      const list = prev[ctx] ?? []
      if (list.some((tab) => tab.file === file)) return prev
      return { ...prev, [ctx]: [...list, { id: key(ctx, file), file }] }
    })
    setActive((prev) => ({ ...prev, [ctx]: key(ctx, file) }))
    request(file)
  }

  const select = (id: string) => {
    const ctx = current()
    if (!ctx) return
    const tab = (tabs()[ctx] ?? []).find((item) => item.id === id)
    if (!tab) return
    setActive((prev) => ({ ...prev, [ctx]: id }))
    if (!document(tab.file)) request(tab.file)
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

  const onMessage = (message: AgentManagerDocumentMessage) => {
    const id = key(message.sessionId, message.requestedFile ?? message.file)
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
  isOpen: Accessor<boolean>,
  openPanel: () => void,
  closePanel: () => void,
) {
  const documents = createDocuments(vscode, context)
  const comments = createDocumentComments(context)
  const open = (file?: string) => (openPanel(), file ? documents.open(file) : undefined)
  onMount(() => {
    const handler = (event: Event) => handleDocumentOpen(event, open)
    const message = vscode.onMessage((item) => {
      if (item.type === "agentManager.document") documents.onMessage(item)
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
  const openFile = (file: string, line?: number) => {
    const sessionId = context()
    if (sessionId) vscode.postMessage({ type: "agentManager.openFile", sessionId, filePath: file, line })
  }
  const toggle = () => (isOpen() ? closePanel() : open())
  return { documents, comments, open, openFile, toggle, available }
}

export function handleDocumentOpen(event: Event, open: (file: string) => void): void {
  const file = (event as CustomEvent<{ filePath?: unknown }>).detail?.filePath
  if (typeof file !== "string" || !file) return
  event.preventDefault()
  open(file)
}
