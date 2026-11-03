import { createSignal, type Accessor } from "solid-js"
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
  return `${context}\0${file}`
}

/** Tabs keep the path they were opened with (possibly absolute); loaded data carries the canonical relative path. */
export function documentPath(tab: DocumentTab, get: (file: string) => DocumentData | undefined): string {
  return get(tab.file)?.file ?? tab.file
}

export function isMarkdownPath(file: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(file)
}

export function createDocuments(
  context: Accessor<string | null>,
  session: Accessor<string | null> = context,
  send: (sessionId: string, file: string, contextKey: string) => void,
) {
  const [tabs, setTabs] = createSignal<Record<string, DocumentTab[]>>({})
  const [active, setActive] = createSignal<Record<string, string | undefined>>({})
  const [data, setData] = createSignal<Record<string, DocumentData>>({})

  const current = () => context() ?? ""
  const list = () => tabs()[current()] ?? []
  const selected = () => active()[current()]
  const document = (file: string) => data()[key(current(), file)]

  const drop = (ctx: string, files: Iterable<string>) => {
    setData((prev) => {
      const next = { ...prev }
      for (const file of files) delete next[key(ctx, file)]
      return next
    })
  }

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
    const tab = list[index]!
    drop(ctx, [tab.file])
    setTabs((prev) => ({ ...prev, [ctx]: next }))
    if (active()[ctx] !== id) return
    const target = next[Math.min(index, next.length - 1)]
    setActive((prev) => ({ ...prev, [ctx]: target?.id }))
  }

  const closeOthers = (id: string) => {
    const ctx = current()
    const list = tabs()[ctx] ?? []
    const tab = list.find((item) => item.id === id)
    if (!tab) return
    drop(
      ctx,
      list.filter((item) => item.id !== id).map((item) => item.file),
    )
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

  /** Drop everything held for scopes that `keep` rejects. */
  const prune = (keep: (scope: string) => boolean) => {
    setTabs((prev) => Object.fromEntries(Object.entries(prev).filter(([scope]) => keep(scope))))
    setActive((prev) => Object.fromEntries(Object.entries(prev).filter(([scope]) => keep(scope))))
    setData((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([id]) => keep(id.includes("\0") ? id.slice(0, id.indexOf("\0")) : id)),
      ),
    )
  }

  const onMessage = (message: DocumentMessage) => {
    const ctx = message.contextKey ?? message.sessionId
    const file = message.requestedFile ?? message.file
    // A closed tab or a pruned scope no longer references the file; ignore its late response.
    if (!tabs()[ctx]?.some((tab) => tab.file === file)) return
    const id = key(ctx, file)
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

  return {
    tabs: list,
    active: selected,
    document,
    open,
    select,
    close,
    closeOthers,
    reorder,
    onMessage,
    request,
    prune,
  }
}

export function createDocumentComments(context: Accessor<string | null>) {
  const [byContext, setByContext] = createSignal<Record<string, ReviewComment[]>>({})
  const prune = (keep: (scope: string) => boolean) => {
    setByContext((prev) => Object.fromEntries(Object.entries(prev).filter(([scope]) => keep(scope))))
  }
  const comments = () => {
    const ctx = context()
    return ctx ? (byContext()[ctx] ?? []) : []
  }
  const setComments = (value: ReviewComment[]) => {
    const ctx = context()
    if (!ctx) return
    setByContext((prev) => ({ ...prev, [ctx]: value }))
  }
  return { comments, setComments, prune }
}

/** The transport each surface provides for the panel: the Agent Manager panel and the editor tab answer differently. */
export interface DocumentTransport {
  send: (sessionId: string, file: string, contextKey: string) => void
  openFile: (file: string, sessionId?: string, line?: number, column?: number) => boolean
  copyPath: (file: string, sessionId?: string) => boolean
  onMessage: (handler: (message: DocumentMessage) => void) => () => void
}

export function createDocumentInspector(
  transport: DocumentTransport,
  context: Accessor<string | null>,
  project: Accessor<string | undefined>,
  isOpen: Accessor<boolean>,
  openPanel: () => void,
  closePanel: () => void,
) {
  const scope = () => `${project() ?? "single"}:${context() ?? ""}`
  const documents = createDocuments(scope, context, transport.send)
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
  const openFile = (file: string, line?: number, column?: number, sessionId = context()) => {
    if (!sessionId) return false
    return transport.openFile(file, sessionId, line, column)
  }
  const copyPath = (file: string, sessionId = context()) => {
    if (!sessionId) return false
    return transport.copyPath(file, sessionId)
  }
  const subscribe = (handler: (message: DocumentMessage) => void) => {
    const off = transport.onMessage((message) => {
      if (message.type === "document.result" || message.type === "agentManager.document") handler(message)
    })
    return off
  }
  // The toolbar button is a way back to already-open documents, not a way to open an empty panel: documents arrive
  // from a file reference or a diff row. Tabs are keyed per worktree, so this hides itself on a worktree with none,
  // and stays visible while the panel is open so it can still be toggled shut.
  const available = () => documents.tabs().length > 0 || isOpen()
  const toggle = () => (isOpen() ? closePanel() : open())
  /** Drop documents and comments for worktrees this project no longer has. */
  const prune = (project: string, ids: ReadonlySet<string>) => {
    const prefix = `${project}:`
    const keep = (scope: string) => !scope.startsWith(prefix) || ids.has(scope.slice(prefix.length))
    documents.prune(keep)
    comments.prune(keep)
  }
  /** Drop documents and comments for a project that left the Agent Manager. */
  const clearProject = (project: string) => {
    const prefix = `${project}:`
    const keep = (scope: string) => !scope.startsWith(prefix)
    documents.prune(keep)
    comments.prune(keep)
  }
  return {
    documents,
    comments,
    open,
    openFile,
    copyPath,
    toggle,
    available,
    isOpen,
    scope,
    subscribe,
    prune,
    clearProject,
  }
}
