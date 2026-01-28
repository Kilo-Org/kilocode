import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  type ParentProps,
  type Accessor,
} from "solid-js"
import { createOpencodeClient, type OpencodeClient } from "../sdk"
import type { ServerInfo, ExtensionMessage, ModelSelection } from "../types"

export interface ServerContextValue {
  server: Accessor<ServerInfo | null>
  directory: Accessor<string | null>
  client: Accessor<OpencodeClient | null>
  status: Accessor<"disconnected" | "connecting" | "connected">
  savedModel: Accessor<ModelSelection | null>
  saveModel: (model: ModelSelection | null) => void
}

const ServerContext = createContext<ServerContextValue>()

export function useServer() {
  const ctx = useContext(ServerContext)
  if (!ctx) {
    throw new Error("useServer must be used within ServerProvider")
  }
  return ctx
}

const vscode = acquireVsCodeApi<{ server: ServerInfo | null; directory: string | null }>()

export function ServerProvider(props: ParentProps) {
  const initial = vscode.getState()
  const [server, setServer] = createSignal<ServerInfo | null>(initial?.server ?? null)
  const [directory, setDirectory] = createSignal<string | null>(initial?.directory ?? null)
  const [client, setClient] = createSignal<OpencodeClient | null>(null)
  const [status, setStatus] = createSignal<"disconnected" | "connecting" | "connected">("disconnected")
  const [savedModel, setSavedModel] = createSignal<ModelSelection | null>(null)

  function handleMessage(event: MessageEvent<ExtensionMessage>) {
    const message = event.data
    console.log("[server] handleMessage", message)
    switch (message.type) {
      case "server":
        setServer(message.server ?? null)
        vscode.setState({ server: message.server ?? null, directory: directory() })
        break
      case "workspace":
        console.log("[server] setting directory to:", message.directory)
        setDirectory(message.directory ?? null)
        vscode.setState({ server: server(), directory: message.directory ?? null })
        break
      case "settings":
        console.log("[server] received settings, model:", message.model)
        setSavedModel(message.model ?? null)
        break
    }
  }

  function saveModel(model: ModelSelection | null) {
    vscode.postMessage({ type: "save-settings", model })
  }

  onMount(() => {
    window.addEventListener("message", handleMessage)
    vscode.postMessage({ type: "ready" })
  })

  onCleanup(() => {
    window.removeEventListener("message", handleMessage)
  })

  createEffect(() => {
    const info = server()
    const dir = directory()

    console.log("[server] createEffect - server:", info, "directory:", dir)

    if (!info) {
      setClient(null)
      setStatus("disconnected")
      return
    }

    setStatus("connecting")
    console.log("[server] creating client with baseUrl:", info.url, "directory:", dir)
    const newClient = createOpencodeClient({
      baseUrl: info.url,
      directory: dir ?? undefined,
    })
    setClient(newClient)
    setStatus("connected")
    console.log("[server] client created, status: connected")
  })

  return (
    <ServerContext.Provider value={{ server, directory, client, status, savedModel, saveModel }}>
      {props.children}
    </ServerContext.Provider>
  )
}
