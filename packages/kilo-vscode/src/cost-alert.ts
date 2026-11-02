import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { local } from "./local"
import type { Server } from "./server"

export type CostAlert = { sessionID: string; title?: string; cost: number; limit: number }
export type CostAlertChoice = "continue" | "stop" | undefined

/** Tracks the threshold and the user's choice separately for each session. */
export function createCostAlert(input: {
  notify: (alert: CostAlert) => Promise<CostAlertChoice>
  stop: (sessionID: string) => Promise<unknown>
  onError: (error: unknown) => void
  onStopError: (sessionID: string, error: unknown) => void
}) {
  const sessions = new Map<
    string,
    {
      cost: number
      title?: string
      shown?: number
      pending?: symbol
      archived?: boolean
      acknowledged: Set<number>
    }
  >()
  let limit = 0
  let disposed = false

  const check = (sessionID: string) => {
    const session = sessions.get(sessionID)
    if (
      !session ||
      session.pending ||
      !limit ||
      session.cost < limit ||
      session.acknowledged.has(limit) ||
      session.shown === limit
    )
      return
    const token = Symbol()
    const current = limit
    session.shown = current
    session.pending = token
    void input.notify({ sessionID, title: session.title, cost: session.cost, limit: current }).then(
      (choice) => {
        if (disposed || sessions.get(sessionID) !== session || session.pending !== token) return
        session.pending = undefined
        if (choice === "continue") session.acknowledged.add(current)
        if (choice === "stop") {
          void input.stop(sessionID).then(
            () => {
              if (!disposed && sessions.get(sessionID) === session && session.archived) sessions.delete(sessionID)
            },
            (error: unknown) => {
              if (disposed || sessions.get(sessionID) !== session) return
              session.shown = undefined
              input.onStopError(sessionID, error)
              if (session.archived) sessions.delete(sessionID)
            },
          )
          return
        }
        if (session.archived) {
          sessions.delete(sessionID)
          return
        }
        if (limit !== current) {
          session.shown = undefined
          check(sessionID)
        }
      },
      (error: unknown) => {
        if (session.pending === token) {
          session.pending = undefined
          session.shown = undefined
        }
        if (session.archived) sessions.delete(sessionID)
        input.onError(error)
      },
    )
  }

  return {
    setLimit(value: unknown) {
      const next = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
      if (next === limit) return
      limit = next
      for (const [id, session] of sessions) {
        if (session.pending) continue
        session.shown = undefined
        check(id)
      }
    },
    update(sessionID: string, cost: number, title?: string) {
      const session = sessions.get(sessionID)
      if (!session || disposed || !Number.isFinite(cost) || cost < 0) return
      // A snapshot can finish after a newer usage event. Session costs only increase.
      session.cost = Math.max(session.cost, cost)
      if (title !== undefined) session.title = title
      check(sessionID)
    },
    track(sessionID: string) {
      if (!disposed && !sessions.has(sessionID))
        sessions.set(sessionID, { cost: 0, acknowledged: new Set<number>() })
    },
    rearm(sessionID: string) {
      const session = sessions.get(sessionID)
      if (!session || session.pending) return
      session.shown = undefined
      check(sessionID)
    },
    forget(sessionID: string) {
      const session = sessions.get(sessionID)
      if (!session) return
      if (session.pending) {
        session.archived = true
        return
      }
      sessions.delete(sessionID)
    },
    ids() {
      return [...sessions.keys()]
    },
    dispose() {
      disposed = true
      sessions.clear()
    },
  }
}

/** Watches the host's server even when the chat webview is hidden. */
export function createCostAlerts(input: {
  notify: (alert: CostAlert) => Promise<CostAlertChoice>
  onError: (error: unknown) => void
  onStopError: (sessionID: string, error: unknown) => void
}) {
  type Connection = { api: OpenCodeClient; abort: AbortController }
  let connection: Connection | undefined
  const alert = createCostAlert({
    notify: input.notify,
    stop: async (sessionID) => {
      if (!connection) throw new Error("The Kilo server is not running")
      await connection.api.session.interrupt({ sessionID }, { signal: connection.abort.signal })
    },
    onError: input.onError,
    onStopError: input.onStopError,
  })

  const sync = async (current: Connection, sessionID: string) => {
    try {
      const info = await current.api.session.get({ sessionID }, { signal: current.abort.signal })
      if (current.abort.signal.aborted) return
      if (info.time?.archived !== undefined) return alert.forget(sessionID)
      alert.update(sessionID, info.cost, info.title)
    } catch (error) {
      if (!current.abort.signal.aborted) input.onError(error)
    }
  }
  const reconcile = async (current: Connection) => {
    try {
      const active = await current.api.session.active({ signal: current.abort.signal })
      for (const id of Object.keys(active)) {
        alert.track(id)
        alert.rearm(id)
      }
      await Promise.all([...new Set([...alert.ids(), ...Object.keys(active)])].map((id) => sync(current, id)))
    } catch (error) {
      if (!current.abort.signal.aborted) input.onError(error)
    }
  }
  const watch = async (current: Connection) => {
    const signal = current.abort.signal
    while (!signal.aborted) {
      try {
        for await (const event of current.api.event.subscribe({ signal })) {
          if (event.type === "server.connected") void reconcile(current)
          if (event.type === "session.usage.updated") alert.update(event.data.sessionID, event.data.cost)
          if (event.type === "session.renamed") alert.update(event.data.sessionID, 0, event.data.title)
          if (event.type === "session.execution.started") {
            alert.track(event.data.sessionID)
            alert.rearm(event.data.sessionID)
            void sync(current, event.data.sessionID)
          }
          if (event.type === "session.archived" || event.type === "session.deleted")
            alert.forget(event.data.sessionID)
        }
      } catch (error) {
        if (!signal.aborted) input.onError(error)
      }
      if (signal.aborted) return
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          signal.removeEventListener("abort", done)
          resolve()
        }
        const timer = setTimeout(done, 1000)
        signal.addEventListener("abort", done, { once: true })
      })
    }
  }
  const stop = () => {
    connection?.abort.abort()
    connection = undefined
  }

  return {
    setLimit: alert.setLimit,
    track(sessionID: string) {
      alert.track(sessionID)
      if (connection) void sync(connection, sessionID)
    },
    start(server: Pick<Server, "url" | "authorization">) {
      stop()
      const current = {
        api: OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization }, fetch: local }),
        abort: new AbortController(),
      }
      connection = current
      void watch(current)
    },
    stop,
    dispose() {
      stop()
      alert.dispose()
    },
  }
}
