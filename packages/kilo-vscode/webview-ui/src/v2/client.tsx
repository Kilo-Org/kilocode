// The v2 data layer of the webview: `@opencode/client` over the host relay, the event stream and `createData`.
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { createClientConnection, createData } from "@opencode/client/solid"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { createContext, createEffect, createSignal, on, onCleanup, useContext, type ParentComponent } from "solid-js"
import type { ToWebview } from "../../../src/protocol"
import { getVSCodeAPI } from "../context/vscode"
import { events } from "./events"
import { transport } from "./transport"

function create(directory: string) {
  const vscode = getVSCodeAPI()
  const bridge = transport((message) => vscode.postMessage(message as never))
  const api: OpenCodeClient = OpenCode.make({ baseUrl: "http://kilo.invalid", fetch: bridge.fetch })
  const event = events()
  const [error, setError] = createSignal("")
  const [version, setVersion] = createSignal("")
  const [handshake, setHandshake] = createSignal("")
  const [loading, setLoading] = createSignal(true)
  const commands = new Set<(name: string) => void>()
  const connection = createClientConnection(api, { onEvent: event.emit, pageLifecycle: true })
  const data = createData({ api: () => api, directory, connection, event, onError: (err) => setError(message(err)) })

  const receive = (event: MessageEvent<ToWebview>) => {
    const message = event.data
    if (!message || typeof message !== "object" || !("type" in message)) return
    if (message.type === "command") return commands.forEach((handler) => handler(message.name))
    bridge.receive(message)
  }
  window.addEventListener("message", receive)
  onCleanup(() => window.removeEventListener("message", receive))
  onCleanup(event.clear)

  createEffect(
    on(connection.status, (status) => {
      if (status !== "connected") return
      setLoading(true)
      void api.session
        .list({ directory, parentID: null, order: "desc", limit: 50 })
        .then((response) => response.data.forEach(data.session.remember))
        .catch((err: unknown) => setError(message(err)))
        .finally(() => setLoading(false))
      void api
        .rpc(KiloHandshakeRpc.Definition)
        .get({}, { location: { directory } })
        .then((info) => {
          setVersion(info.version)
          setHandshake("")
        })
        .catch((err: unknown) => setHandshake(`Not a Kilo v2 server: ${message(err)}`))
    }),
  )

  return {
    api,
    data,
    directory,
    connection,
    loading,
    version,
    handshake,
    error,
    setError,
    report: (err: unknown) => setError(message(err)),
    open: (url: string) => vscode.postMessage({ type: "open", url } as never),
    onCommand(handler: (name: string) => void) {
      commands.add(handler)
      onCleanup(() => commands.delete(handler))
    },
  }
}

export type V2 = ReturnType<typeof create>

const Context = createContext<V2>()

export const V2Provider: ParentComponent<{ directory: string }> = (props) => (
  <Context.Provider value={create(props.directory)}>{props.children}</Context.Provider>
)

export function useV2() {
  const value = useContext(Context)
  if (!value) throw new Error("useV2 must be used inside V2Provider")
  return value
}

export function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message)
  return String(error)
}
