// Connects a webview to the server event stream without burning connectTimeout/reconnectDelay cycles
// while the extension host is still booting the server. When the server is already running (warm
// reopen, reload, or tests without KILO_SERVER_READY=false), connects immediately.
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client"
import { createClientConnection } from "@opencode/client/solid"
import { createRoot, createSignal, onCleanup } from "solid-js"
import type { ToHost, ToWebview } from "../../../src/protocol"

type Connection = ReturnType<typeof createClientConnection>

// Matches server.ts TIMEOUT so a missing host status message can never stall forever.
const FALLBACK_WAIT_MS = 60_000

export function createHostConnection(input: {
  api: OpenCodeClient
  onEvent: (event: OpenCodeEvent) => void
  post: (message: ToHost) => void
  pageLifecycle?: boolean
}): { connection: Connection; receive: (message: ToWebview) => boolean } {
  const initialReady =
    typeof window === "undefined" || (window as unknown as { KILO_SERVER_READY?: boolean }).KILO_SERVER_READY !== false
  const [inner, setInner] = createSignal<Connection>()
  let disposeInner: (() => void) | undefined
  let disposed = false
  let fallback: ReturnType<typeof setTimeout> | undefined

  const start = () => {
    if (disposed || inner()) return
    clearTimeout(fallback)
    fallback = undefined
    createRoot((dispose) => {
      disposeInner = dispose
      setInner(
        createClientConnection(input.api, {
          onEvent: input.onEvent,
          pageLifecycle: input.pageLifecycle,
        }),
      )
    })
  }

  onCleanup(() => {
    disposed = true
    clearTimeout(fallback)
    disposeInner?.()
    disposeInner = undefined
  })

  if (initialReady) {
    start()
  } else {
    // Ask after the caller installs its message listener so an already-ready host replies right away.
    queueMicrotask(() => {
      if (!disposed && !inner()) input.post({ type: "requestServerStatus" })
    })
    fallback = setTimeout(start, FALLBACK_WAIT_MS)
  }

  const receive = (message: ToWebview): boolean => {
    if (message.type !== "serverStatus") return false
    if (message.status === "ready" || message.status === "failed") start()
    return true
  }

  const connection: Connection = {
    status: () => inner()?.status() ?? "connecting",
    attempt: () => inner()?.attempt() ?? 0,
    error: () => inner()?.error(),
    internal: {
      history: () => inner()?.internal.history() ?? [],
      resync: (reason: string) => inner()?.internal.resync(reason),
    },
  }

  return { connection, receive }
}
