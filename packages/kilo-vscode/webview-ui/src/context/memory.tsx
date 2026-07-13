import { createContext, createEffect, createMemo, createSignal, onCleanup, useContext } from "solid-js"
import type { Accessor, ParentComponent } from "solid-js"
import { useServer } from "./server"
import { useSession } from "./session"
import { useVSCode } from "./vscode"
import { useLanguage } from "./language"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { MemoryShowResponse, MemoryStatusResponse } from "@kilocode/sdk/v2"
import type { ExtensionMessage } from "../types/messages"

export interface MemoryContextValue {
  status: Accessor<MemoryStatusResponse | undefined>
  show: Accessor<MemoryShowResponse | undefined>
  loading: Accessor<boolean>
  pending: Accessor<boolean>
  error: Accessor<string | undefined>
  enabled: Accessor<boolean>
  sessionTokens: Accessor<number>
  totalTokens: Accessor<number>
  refresh: (includeSources?: boolean) => void
  showMemory: () => void
  enable: () => void
  disable: () => void
  auto: (mode: "on" | "off") => void
  rebuild: () => void
  remember: () => void
  forget: () => void
}

export const MemoryContext = createContext<MemoryContextValue>()
const EVENT_DEDUPE_MS = 1000

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

  const id = () => session.currentSessionID()
  const key = (sid?: string) => sid ?? ""
  const current = (sid?: string) => {
    if (!sid) return true
    // A response can be addressed to a draft session that hasn't been promoted to
    // currentSessionID yet (PromptInput posts with the draft id), so match both.
    return sid === id() || sid === session.draftSessionID()
  }
  let last: { key: string; time: number } | undefined
  let scope = ""

  const clear = () => {
    setStatus(undefined)
    setShow(undefined)
    setError(undefined)
    setPending(undefined)
    last = undefined
  }

  const refresh = (includeSources = false) => {
    if (!server.isConnected()) return
    setLoading(true)
    setError(undefined)
    vscode.postMessage({ type: "requestMemory", sessionID: id(), includeSources })
  }

  const operation = (op: "enable" | "disable" | "rebuild") => {
    if (!server.isConnected()) return
    setPending(key(id()))
    setError(undefined)
    vscode.postMessage({ type: "memoryOperation", operation: op, sessionID: id() })
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
    if (message.detail.type === "skipped") return
    if (!message.detail.message) return
    const dedupeKey = `${message.sessionID ?? ""}:${message.detail.type ?? ""}:${message.detail.message}`
    const now = Date.now()
    if (last?.key === dedupeKey && now - last.time < EVENT_DEDUPE_MS) return
    last = { key: dedupeKey, time: now }
    showToast({
      ...(message.detail.type === "saved"
        ? { variant: "success" as const }
        : message.detail.type === "error"
          ? { variant: "error" as const }
          : {}),
      title: message.detail.message,
    })
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

  const value: MemoryContextValue = {
    status,
    show,
    loading,
    pending: createMemo(() => pending() === key(id())),
    error,
    enabled: createMemo(() => status()?.state.enabled ?? false),
    sessionTokens: sessionTotal,
    totalTokens: total,
    refresh,
    showMemory,
    enable: () => operation("enable"),
    disable: () => operation("disable"),
    auto,
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
