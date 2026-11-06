// The v2 data layer of the sidebar webview: `@opencode/client` over the host relay, the event stream and the data of
// the workspace directory.
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { createClientConnection } from "@opencode/client/solid"
import { createContext, createSignal, onCleanup, useContext, type ParentComponent } from "solid-js"
import type { ToWebview } from "../../../src/protocol"
import { getVSCodeAPI } from "../context/vscode"
import { events } from "./events"
import { createV2Scope, type V2 } from "./scope"
import { transport } from "./transport"

export { message, type V2 } from "./scope"

function create(directory: string, chat: boolean) {
  const vscode = getVSCodeAPI()
  const bridge = transport((message) => vscode.postMessage(message as never))
  const api: OpenCodeClient = OpenCode.make({ baseUrl: "http://kilo.invalid", fetch: bridge.fetch })
  const event = events()
  const [bindings, setBindings] = createSignal<Record<string, string>>({})
  const commands = new Set<(name: string) => void>()
  const connection = createClientConnection(api, { onEvent: event.emit, pageLifecycle: true })

  const receive = (event: MessageEvent<ToWebview>) => {
    const message = event.data
    if (!message || typeof message !== "object" || !("type" in message)) return
    if (message.type === "command") return commands.forEach((handler) => handler(message.name))
    if (message.type === "keybindings") return setBindings(message.bindings)
    bridge.receive(message)
  }
  window.addEventListener("message", receive)
  onCleanup(() => window.removeEventListener("message", receive))
  onCleanup(event.clear)

  return createV2Scope({
    api,
    connection,
    event,
    directory,
    bindings,
    chat,
    onCommand(handler) {
      commands.add(handler)
      onCleanup(() => commands.delete(handler))
    },
    open: (url, external) => vscode.postMessage({ type: "open", url, external } as never),
  })
}

const Context = createContext<V2>()

export const V2Provider: ParentComponent<{ directory: string; chat?: boolean }> = (props) => (
  <Context.Provider value={create(props.directory, props.chat ?? true)}>{props.children}</Context.Provider>
)

/** Provides an existing directory scope, for example one Agent Manager worktree. */
export const V2Scope: ParentComponent<{ value: V2 }> = (props) => (
  <Context.Provider value={props.value}>{props.children}</Context.Provider>
)

export function useV2() {
  const value = useContext(Context)
  if (!value) throw new Error("useV2 must be used inside V2Provider")
  return value
}

/** The directory scope when one is provided; a list that spans directories reads each row store instead. */
export function useV2Optional() {
  return useContext(Context)
}
