// The Agent Manager data layer: one client and one event stream for the panel, and one `createData` store for each
// directory the panel shows (the pinned root, expanded projects and open worktrees). `createData` binds a single
// directory, so the panel routes each event to the store of `event.location.directory`.
import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client"
import { createClientConnection } from "@opencode/client/solid"
import { createRoot, createSignal, onCleanup } from "solid-js"
import { createV2Scope, type V2 } from "../../src/v2/scope"
import { createConnectionMetadata, type ConnectionMetadata } from "../../src/v2/connection-metadata"
import { catalogEvent } from "../../src/v2/kilo-catalog"
import { events } from "../../src/v2/events"
import { transport } from "../../src/v2/transport"
import type { ToHost, ToWebview } from "../../../src/protocol"

type Entry = { scope: V2; emit: (event: OpenCodeEvent) => void; dispose: () => void; show: () => void }

/**
 * Events that every store must see: a move changes the directory of a session, so the old and the new store both
 * apply it.
 */
const BROADCAST: ReadonlySet<string> = new Set(["session.moved"])

export function key(directory: string) {
  return directory.length > 1 ? directory.replace(/[\\/]+$/, "") : directory
}

/** The keys of the stores that receive `event`. Events without a location go to every store. */
export function targets(event: OpenCodeEvent, keys: Iterable<string>) {
  const directory = event.location?.directory
  if (!directory || BROADCAST.has(event.type)) return [...keys]
  const target = key(directory)
  return [...keys].filter((item) => item === target)
}

export function createPanelData(input: { post: (message: ToHost) => void; api?: OpenCodeClient }) {
  const bridge = transport(input.post)
  const api = input.api ?? OpenCode.make({ baseUrl: "http://kilo.invalid", fetch: bridge.fetch })
  const stores = new Map<string, Entry>()
  const [bindings, setBindings] = createSignal<Record<string, string>>({})
  const [selection, setSelection] = createSignal(false)
  const commands = new Set<(name: string) => void>()
  const catalogHandlers = new Set<() => void>()
  let metadata: ConnectionMetadata | undefined
  const route = (event: OpenCodeEvent) => {
    if (event.type === catalogEvent) catalogHandlers.forEach((handler) => handler())
    targets(event, stores.keys()).forEach((item) => stores.get(item)?.emit(event))
  }
  const connection = createClientConnection(api, { onEvent: route, pageLifecycle: true })
  metadata = createConnectionMetadata({
    api,
    connection,
    subscribe: (_type, handler) => {
      catalogHandlers.add(handler)
      return () => {
        catalogHandlers.delete(handler)
      }
    },
  })
  const open = (url: string, external?: boolean) => input.post({ type: "open", url, external })
  const onCommand = (handler: (name: string) => void) => {
    commands.add(handler)
    onCleanup(() => commands.delete(handler))
  }

  /** The store of `directory`, created on first use. Its reactive owner is detached, so `release` ends it. */
  const store = (directory: string) => {
    const id = key(directory)
    const found = stores.get(id)
    if (found) return found.scope
    const entry = createRoot((dispose) => {
      const event = events()
      onCleanup(event.clear)
      const [visible, setVisible] = createSignal(false)
      const scope = createV2Scope({
        api,
        connection,
        event,
        directory: id,
        shared: metadata,
        visible,
        bindings,
        selection,
        onCommand,
        open,
      })
      return { scope, emit: event.emit, dispose, show: () => setVisible(true) }
    })
    stores.set(id, entry)
    return entry.scope
  }

  /** Loads the session list of each directory that the panel shows; the others keep it unloaded. */
  const show = (directories: Iterable<string>) => {
    for (const directory of directories) {
      store(directory)
      stores.get(key(directory))?.show()
    }
  }

  const release = (directory: string) => {
    const id = key(directory)
    stores.get(id)?.dispose()
    stores.delete(id)
  }

  /** Keeps only the stores of `directories`; the others are released. */
  const retain = (directories: Iterable<string>) => {
    const keep = new Set([...directories].map(key))
    ;[...stores.keys()].filter((item) => !keep.has(item)).forEach(release)
  }

  onCleanup(() => [...stores.keys()].forEach(release))

  return {
    api,
    connection,
    store,
    find: (directory: string) => stores.get(key(directory))?.scope,
    show,
    release,
    retain,
    directories: () => [...stores.keys()],
    /** Relay replies and host commands; returns true when the message was one of them. */
    receive(message: ToWebview) {
      if (message.type === "command") {
        commands.forEach((handler) => handler(message.name))
        return true
      }
      if (message.type === "keybindings") {
        setBindings(message.bindings)
        setSelection(message.selection)
        return true
      }
      if (message.type === "response" || message.type === "chunk" || message.type === "end" || message.type === "error") {
        bridge.receive(message)
        return true
      }
      return false
    },
  }
}

export type PanelData = ReturnType<typeof createPanelData>
