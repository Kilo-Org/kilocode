// The Agent Manager data layer: one client and one event stream for the panel, and one `createData` store for each
// directory the panel shows (the pinned root, expanded projects and open worktrees). `createData` binds a single
// directory, so the panel routes each event to the store of `event.location.directory`.
import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client"
import { createClientConnection } from "@opencode/client/solid"
import { createRoot, createSignal, onCleanup } from "solid-js"
import { createV2Scope, type V2 } from "../../src/v2/scope"
import { createConnectionMetadata, type ConnectionMetadata } from "../../src/v2/connection-metadata"
import { createWakeups } from "../../src/v2/wakeups"
import { catalogEvent } from "../../src/v2/kilo-catalog"
import { events } from "../../src/v2/events"
import { transport } from "../../src/v2/transport"
import type { ToHost, ToWebview } from "../../../src/protocol"

type Entry = {
  scope: V2
  emit: (event: OpenCodeEvent) => void
  dispose: () => void
  show: () => void
  visible: () => boolean
  /** The store was hidden when the server connected and has not loaded its directory for that connection yet. */
  missed?: boolean
}

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

export function createPanelData(input: {
  post: (message: ToHost) => void
  api?: OpenCodeClient
  /** Every directory whose sessions the panel draws, for the scheduled state. Defaults to the open stores. */
  directories?: () => readonly string[]
  /** The project root, whose Location answers the scheduled state of every directory. */
  home?: () => string | undefined
}) {
  const bridge = transport(input.post)
  const api = input.api ?? OpenCode.make({ baseUrl: "http://kilo.invalid", fetch: bridge.fetch })
  const stores = new Map<string, Entry>()
  const [bindings, setBindings] = createSignal<Record<string, string>>({})
  const [selection, setSelection] = createSignal(false)
  const commands = new Set<(name: string) => void>()
  const catalogHandlers = new Set<() => void>()
  let metadata: ConnectionMetadata | undefined
  let connected: OpenCodeEvent | undefined
  const route = (event: OpenCodeEvent) => {
    if (event.type === catalogEvent) catalogHandlers.forEach((handler) => handler())
    if (event.type === "server.connected") {
      // A store loads its directory's location, VCS and project when the server connects, and each of those loads
      // the whole Location on the server. A hidden store loads them once it is shown, so a reconnect with many
      // worktrees loads only the shown ones; worktree cards keep their busy state from the host's activity.
      connected = event
      stores.forEach((entry) => {
        entry.missed = !entry.visible()
        if (!entry.missed) entry.emit(event)
      })
      return
    }
    targets(event, stores.keys()).forEach((item) => stores.get(item)?.emit(event))
  }
  const connection = createClientConnection(api, { onEvent: route, pageLifecycle: true })
  // One pending-wakeup store for every directory the panel draws: a worktree row is scheduled even while another
  // worktree, or no worktree, is selected.
  const wakeups = createWakeups({
    api,
    directories: input.directories ?? (() => [...stores.keys()]),
    connected: () => connection.status() === "connected",
    home: input.home,
  })
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
        scheduled: wakeups.scheduled,
      })
      // A store created after the server connected never saw the connect event; it loads its directory once shown.
      return {
        scope,
        emit: event.emit,
        dispose,
        show: () => setVisible(true),
        visible,
        missed: connected !== undefined,
      }
    })
    stores.set(id, entry)
    return entry.scope
  }

  /** Loads the session list of each directory that the panel shows; the others keep it unloaded. */
  const show = (directories: Iterable<string>) => {
    for (const directory of directories) {
      store(directory)
      const entry = stores.get(key(directory))
      if (!entry) continue
      entry.show()
      if (!entry.missed || !connected) continue
      entry.missed = false
      entry.emit(connected)
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
    /** Runs a host command against the mounted views, as a `command` message from the host does. */
    command: (name: string) => commands.forEach((handler) => handler(name)),
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
      if (
        message.type === "response" ||
        message.type === "chunk" ||
        message.type === "end" ||
        message.type === "error"
      ) {
        bridge.receive(message)
        return true
      }
      return false
    },
  }
}

export type PanelData = ReturnType<typeof createPanelData>
