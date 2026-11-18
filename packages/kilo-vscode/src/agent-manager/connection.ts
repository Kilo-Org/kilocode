// The Agent Manager connection to the Kilo v2 server. One client per server start: every call carries its own
// `location.directory`, so the Agent Manager needs no per-directory clients. One event stream per server start, with
// reconnect, feeds every listener; a listener filters by the event location.
import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client"
import { local } from "../local"
import type { Manager, Server } from "../server"

export type ConnectionState = "connecting" | "connected" | "disconnected"

type Listener = (event: OpenCodeEvent) => void
type Filter = (event: OpenCodeEvent) => boolean

/** Events after which a visible session may have a new idle transition to mark as viewed. */
const IDLE: ReadonlySet<string> = new Set(["session.idle", "session.execution.succeeded", "session.execution.failed"])
const RECONNECT = 1_000

export function createAgentManagerConnection(input: { server: Manager; reconnect?: number }) {
  const state: {
    status: ConnectionState
    server?: Server
    client?: { url: string; api: OpenCodeClient }
    events?: AbortController
    visible: Set<string>
  } = { status: "disconnected", visible: new Set() }
  const states = new Set<(status: ConnectionState) => void>()
  const listeners = new Map<Listener, Filter | undefined>()

  const make = (server: Pick<Server, "url" | "authorization">) => {
    if (state.client?.url === server.url) return state.client.api
    const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization }, fetch: local })
    state.client = { url: server.url, api }
    return api
  }

  const set = (status: ConnectionState) => {
    if (state.status === status) return
    state.status = status
    states.forEach((listener) => listener(status))
  }

  const dispatch = (event: OpenCodeEvent) => {
    listeners.forEach((filter, listener) => {
      if (!filter || filter(event)) listener(event)
    })
    if (IDLE.has(event.type) && "sessionID" in event.data && state.visible.has(String(event.data.sessionID)))
      void mark(String(event.data.sessionID))
  }

  // The stream ends when the server restarts or the connection drops: subscribe again after a short delay until the
  // server stops.
  const watch = async (api: OpenCodeClient, signal: AbortSignal) => {
    while (!signal.aborted) {
      set("connecting")
      await (async () => {
        for await (const event of api.event.subscribe({ signal })) {
          if (event.type === "server.connected") set("connected")
          dispatch(event)
        }
      })().catch(() => undefined)
      if (signal.aborted) return
      await new Promise((resolve) => setTimeout(resolve, input.reconnect ?? RECONNECT))
    }
  }

  // Marks the last idle transition of a visible session as viewed. A session that never went idle, or whose idle
  // transition is already viewed, needs no call.
  const mark = async (sessionID: string) => {
    const api = state.client?.api
    if (!api || state.status !== "connected") return
    const session = await api.session.get({ sessionID }).catch(() => undefined)
    const idle = session?.time.idle
    if (idle === undefined || (session?.time.viewed ?? 0) >= idle) return
    await api.session.view({ sessionID, idle }).catch(() => undefined)
  }

  return {
    /** The client of the running server; starts the server when needed. */
    async client() {
      return make(await input.server.get())
    },
    /** The client of the running server, or undefined while none runs. */
    current: () => (state.status === "disconnected" ? undefined : state.client?.api),
    state: () => state.status,
    onState(listener: (status: ConnectionState) => void) {
      states.add(listener)
      return () => void states.delete(listener)
    },
    onEvent(listener: Listener, filter?: Filter) {
      listeners.set(listener, filter)
      return () => void listeners.delete(listener)
    },
    /** URL and credential of the running server, for clients that cannot use the relay (terminal sockets). */
    server: () => (state.server ? { url: state.server.url, authorization: state.server.authorization } : undefined),
    /** The sessions the panel shows to the user. Their idle transitions are marked as viewed. */
    view(sessionIDs: readonly string[]) {
      const added = sessionIDs.filter((id) => !state.visible.has(id))
      state.visible = new Set(sessionIDs)
      added.forEach((id) => void mark(id))
    },
    /** True when the panel shows this session to the user. */
    viewing: (sessionID: string) => state.visible.has(sessionID),
    started(server: Server) {
      state.server = server
      state.events?.abort()
      const events = new AbortController()
      state.events = events
      void watch(make(server), events.signal)
    },
    stopped() {
      state.events?.abort()
      state.events = undefined
      state.server = undefined
      state.client = undefined
      set("disconnected")
    },
    dispose() {
      state.events?.abort()
      listeners.clear()
      states.clear()
      state.visible.clear()
    },
  }
}

export type AgentManagerConnection = ReturnType<typeof createAgentManagerConnection>

/** A filter that passes events located in one of `directories`, and events without a location. */
export function located(directories: () => Iterable<string>): Filter {
  return (event) => {
    const directory = event.location?.directory
    if (!directory) return true
    return [...directories()].includes(directory)
  }
}
