import { createContext, createEffect, createMemo, createSignal, onCleanup, untrack, useContext } from "solid-js"
import type { Accessor, ParentComponent } from "solid-js"
import { useServer } from "./server"
import { useSession } from "./session"
import { useVSCode } from "./vscode"
import { useLanguage } from "./language"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { MemoryShowResponse, MemoryStatusResponse } from "@kilocode/sdk/v2"
import type { ExtensionMessage, Message, Part } from "../types/messages"
import { addMemoryActivity, markerActivity, type MemoryActivity } from "../utils/memory-activity"
import { visibleParts } from "./session-queue"

export interface MemoryContextValue {
  status: Accessor<MemoryStatusResponse | undefined>
  show: Accessor<MemoryShowResponse | undefined>
  loading: Accessor<boolean>
  pending: Accessor<boolean>
  error: Accessor<string | undefined>
  enabled: Accessor<boolean>
  sessionTokens: Accessor<number>
  totalTokens: Accessor<number>
  activity: Accessor<MemoryActivity[]>
  refresh: (includeSources?: boolean) => void
  showMemory: () => void
  enable: () => void
  disable: () => void
  auto: (mode: "on" | "off") => void
  verbose: (mode: "on" | "off") => void
  rebuild: () => void
  remember: () => void
  forget: () => void
}

export const MemoryContext = createContext<MemoryContextValue>()
const EVENT_DEDUPE_MS = 1000

type Marker = { part: string; item: MemoryActivity }

export const MemoryProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const session = useSession()
  const language = useLanguage()
  const [status, setStatus] = createSignal<MemoryStatusResponse | undefined>()
  const [show, setShow] = createSignal<MemoryShowResponse | undefined>()
  const [loading, setLoading] = createSignal(false)
  const [pending, setPending] = createSignal<string | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const [saved, setSaved] = createSignal<MemoryActivity[]>([])
  const [markers, setMarkers] = createSignal<Record<string, Marker>>({})

  const id = () => session.currentSessionID()
  const key = (sid?: string) => sid ?? ""
  const current = (sid?: string) => {
    if (!sid) return true
    // A response can be addressed to a draft session that hasn't been promoted to
    // currentSessionID yet (PromptInput posts with the draft id), so match both.
    return sid === id() || sid === session.draftSessionID()
  }
  const marker = (parts: readonly Part[], at: number) => {
    for (const part of parts) {
      const item = markerActivity([part], at)
      if (item) return { part: part.id, item } satisfies Marker
    }
  }
  const stamp = (message: Message) => message.time?.created ?? Date.parse(message.createdAt)
  const mark = (messageID: string, part: Part, at: number) => {
    const item = marker([part], at)
    setMarkers((items) => {
      if (item) return { ...items, [messageID]: item }
      if (items[messageID]?.part !== part.id) return items
      const next = { ...items }
      delete next[messageID]
      return next
    })
  }
  const load = (message: Extract<ExtensionMessage, { type: "messagesLoaded" }>) => {
    if (!current(message.sessionID)) return
    const next = message.mode === "replace" || !message.mode ? {} : { ...markers() }
    for (const entry of message.messages) {
      const item = marker(entry.parts ?? [], stamp(entry))
      if (item) next[entry.id] = item
      else delete next[entry.id]
    }
    setMarkers(next)
  }
  const created = (message: Extract<ExtensionMessage, { type: "messageCreated" }>) => {
    if (!current(message.message.sessionID)) return
    const item = marker(message.message.parts ?? [], stamp(message.message))
    if (item) setMarkers((items) => ({ ...items, [message.message.id]: item }))
  }
  const dropped = (messageID: string) =>
    setMarkers((items) => {
      if (!items[messageID]) return items
      const next = { ...items }
      delete next[messageID]
      return next
    })
  const track = (message: ExtensionMessage) => {
    if (message.type === "messagesLoaded") return load(message)
    if (message.type === "messageCreated") return created(message)
    if (message.type === "partUpdated") {
      if (current(message.sessionID)) mark(message.messageID, message.part, Date.now())
      return
    }
    if (message.type === "partsUpdated") {
      for (const update of message.updates) {
        if (current(update.sessionID)) mark(update.messageID, update.part, Date.now())
      }
      return
    }
    if (message.type === "partRemoved") {
      if (!current(message.sessionID)) return
      if (markers()[message.messageID]?.part === message.partID) dropped(message.messageID)
      return
    }
    if (message.type === "messageRemoved" && current(message.sessionID)) dropped(message.messageID)
  }
  const scan = () => {
    const next: Record<string, Marker> = {}
    for (const message of session.messages()) {
      const item = marker(session.getParts(message.id), stamp(message))
      if (item) next[message.id] = item
    }
    setMarkers(next)
  }
  let last: { key: string; time: number } | undefined
  let scope = ""

  const clear = () => {
    setStatus(undefined)
    setShow(undefined)
    setError(undefined)
    setPending(undefined)
    setSaved([])
    setMarkers({})
    last = undefined
  }

  const refresh = (includeSources = false) => {
    if (!server.isConnected()) return
    setLoading(true)
    setError(undefined)
    vscode.postMessage({ type: "requestMemory", sessionID: id(), includeSources })
  }

  const operation = (op: "enable" | "disable" | "rebuild" | "verbose", mode?: "on" | "off") => {
    if (!server.isConnected()) return
    setPending(key(id()))
    setError(undefined)
    vscode.postMessage({
      type: "memoryOperation",
      operation: op,
      ...(mode ? { mode } : {}),
      sessionID: id(),
    })
  }

  const auto = (mode: "on" | "off") => {
    if (!server.isConnected()) return
    setPending(key(id()))
    setError(undefined)
    vscode.postMessage({ type: "memoryOperation", operation: "auto", mode, sessionID: id() })
  }

  const prompt = (op: "remember" | "forget") => {
    if (!server.isConnected()) return
    setPending(key(id()))
    setError(undefined)
    vscode.postMessage({ type: "memoryPrompt", operation: op, sessionID: id() })
  }

  const showMemory = () => {
    if (!server.isConnected()) return
    setLoading(true)
    setError(undefined)
    vscode.postMessage({ type: "memoryShow", sessionID: id() })
  }

  const event = (message: Extract<ExtensionMessage, { type: "memoryEvent" }>) => {
    if (!current(message.sessionID)) return
    if (message.detail.type === "saved") {
      setSaved((items) => addMemoryActivity(items, message.detail, Date.now()))
      return
    }
    if (message.detail.type !== "error") return
    if (!message.detail.message) return
    const dedupeKey = `${message.sessionID ?? ""}:${message.detail.type ?? ""}:${message.detail.message}`
    const now = Date.now()
    if (last?.key === dedupeKey && now - last.time < EVENT_DEDUPE_MS) return
    last = { key: dedupeKey, time: now }
    showToast({ variant: "error", title: message.detail.message })
  }

  const loaded = (message: Extract<ExtensionMessage, { type: "memoryLoaded" }>) => {
    if (!current(message.sessionID)) return
    setLoading(false)
    if (message.error) {
      setError(message.error)
      setStatus(undefined)
      setShow(undefined)
      return
    }
    if (message.status) setStatus(message.status)
    if (message.show) setShow(message.show)
    setError(undefined)
  }

  const done = (message: Extract<ExtensionMessage, { type: "memoryOperationResult" }>) => {
    if (pending() === key(message.sessionID)) setPending(undefined)
    if (!current(message.sessionID)) return
    setLoading(false)
    if (!message.ok) {
      const err = message.error ?? language.t("chat.memory.command.failed")
      setError(err)
      showToast({ variant: "error", title: err })
      return
    }
    if (message.status) setStatus(message.status)
    if (message.show) setShow(message.show)
    setError(undefined)
  }

  const receive = (message: ExtensionMessage) => {
    track(message)
    if (message.type === "memoryEvent") {
      event(message)
      return
    }
    if (message.type === "memoryLoaded") {
      loaded(message)
      return
    }
    if (message.type === "memoryOperationResult") {
      done(message)
      return
    }
    if (message.type === "extensionDataReady" && server.isConnected() && !status()) refresh(false)
  }

  const unsubscribe = vscode.onMessage(receive)

  onCleanup(unsubscribe)

  createEffect(() => {
    const sid = id()
    const dir = server.workspaceDirectory()
    const connected = server.isConnected()
    const next = `${connected ? "1" : "0"}:${sid ?? ""}:${dir ?? ""}`
    if (scope !== next) {
      scope = next
      clear()
      untrack(scan)
    }
    if (!connected) {
      setLoading(false)
      return
    }
    refresh(false)
  })

  const sessionTokens = (snapshot?: MemoryStatusResponse) => {
    const sid = id()
    if (!snapshot?.state.enabled) return 0
    if (!sid || snapshot.state.stats.lastInjectedSessionID !== sid) return 0
    return snapshot.state.stats.lastInjectedTokens
  }

  const total = createMemo(() => status()?.index.estimatedTokens ?? 0)

  const sessionTotal = createMemo(() => sessionTokens(status()))

  const activity = createMemo(() => {
    const revert = session.currentSession()?.revert ?? undefined
    const items = Object.entries(markers()).flatMap(([mid, entry]) => {
      if (!revert || mid < revert.messageID) return [entry.item]
      if (mid !== revert.messageID || !revert.partID) return []
      const visible = visibleParts(mid, session.getParts(mid), revert)
      return visible.some((part) => part.id === entry.part) ? [entry.item] : []
    })
    return [...items, ...saved()]
  })

  const value: MemoryContextValue = {
    status,
    show,
    loading,
    pending: createMemo(() => pending() === key(id())),
    error,
    enabled: createMemo(() => status()?.state.enabled ?? false),
    sessionTokens: sessionTotal,
    totalTokens: total,
    activity,
    refresh,
    showMemory,
    enable: () => operation("enable"),
    disable: () => operation("disable"),
    auto,
    verbose: (mode) => operation("verbose", mode),
    rebuild: () => operation("rebuild"),
    remember: () => prompt("remember"),
    forget: () => prompt("forget"),
  }

  return <MemoryContext.Provider value={value}>{props.children}</MemoryContext.Provider>
}

export function useMemory(): MemoryContextValue {
  const context = useContext(MemoryContext)
  if (!context) {
    throw new Error("useMemory must be used within a MemoryProvider")
  }
  return context
}
