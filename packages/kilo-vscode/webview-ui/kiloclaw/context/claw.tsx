// KiloClaw state context
//
// All data arrives from the extension host via postMessage.
// The webview has no direct network access.

import { createContext, createSignal, onMount, onCleanup, useContext, type JSX } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { ClawStatus, ChatMessage, KiloClawOutMessage } from "../lib/types"

type VSCodeAPI = {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare function acquireVsCodeApi(): VSCodeAPI

const vscode = acquireVsCodeApi()

const MAX_MESSAGES = 500

type Phase = "loading" | "noInstance" | "needsUpgrade" | "error" | "ready"

type ClawCtx = {
  phase: () => Phase
  locale: () => string | undefined
  status: () => ClawStatus | null
  messages: () => ChatMessage[]
  online: () => boolean
  connected: () => boolean
  error: () => string | null
  send: (text: string) => void
  openExternal: (url: string) => void
  retry: () => void
}

const ClawContext = createContext<ClawCtx>()

export function ClawProvider(props: { children: JSX.Element }) {
  const [phase, setPhase] = createSignal<Phase>("loading")
  const [locale, setLocale] = createSignal<string | undefined>(undefined)
  const [status, setStatus] = createSignal<ClawStatus | null>(null)
  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [online, setOnline] = createSignal(false)
  const [connected, setConnected] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const handler = (event: MessageEvent) => {
    const msg = event.data as KiloClawOutMessage
    if (!msg?.type?.startsWith("kiloclaw.")) return

    switch (msg.type) {
      case "kiloclaw.state": {
        const s = msg.state
        setPhase(s.phase)
        setLocale(s.locale)
        if (s.phase === "ready") {
          setStatus(s.status)
          setConnected(s.connected)
          setOnline(s.online)
          setMessages(s.messages)
          setError(null)
        } else if (s.phase === "error") {
          setError(s.error)
        }
        break
      }
      case "kiloclaw.message":
        setMessages((prev) => {
          // Dedupe: if a message with this id already exists, update it
          const idx = prev.findIndex((m) => m.id === msg.message.id)
          if (idx !== -1) return prev.map((m, i) => (i === idx ? msg.message : m))
          const next = [...prev, msg.message]
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next
        })
        break
      case "kiloclaw.messageUpdated": {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === msg.message.id)
          if (idx === -1) {
            const next = [...prev, msg.message]
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next
          }
          return prev.map((m, i) => (i === idx ? msg.message : m))
        })
        break
      }
      case "kiloclaw.presence":
        setOnline(msg.online)
        break
      case "kiloclaw.status":
        setStatus(msg.data)
        break
      case "kiloclaw.locale":
        setLocale(msg.locale)
        break
      case "kiloclaw.error":
        showToast({ title: msg.error, variant: "error", duration: 5000 })
        break
    }
  }

  // Register listener immediately (before mount) to catch early pushes
  window.addEventListener("message", handler)
  onCleanup(() => window.removeEventListener("message", handler))

  onMount(() => {
    vscode.postMessage({ type: "kiloclaw.ready" })
  })

  const ctx: ClawCtx = {
    phase,
    locale,
    status,
    messages,
    online,
    connected,
    error,
    send: (text: string) => vscode.postMessage({ type: "kiloclaw.send", text }),
    openExternal: (url: string) => vscode.postMessage({ type: "kiloclaw.openExternal", url }),
    retry: () => vscode.postMessage({ type: "kiloclaw.ready" }),
  }

  return <ClawContext.Provider value={ctx}>{props.children}</ClawContext.Provider>
}

export function useClaw(): ClawCtx {
  const ctx = useContext(ClawContext)
  if (!ctx) throw new Error("useClaw must be used within ClawProvider")
  return ctx
}
