import type { Session } from "@kilocode/sdk/v2"
import type { useSDK } from "@tui/context/sdk"
import { createEffect, onCleanup } from "solid-js"

type Store = { session: Session[] }

export namespace GoalSync {
  export function watch(
    sdk: Pick<ReturnType<typeof useSDK>, "client" | "event">,
    workspace: () => string | undefined,
    store: Store,
    update: (fn: (draft: Store) => void) => void,
  ) {
    createEffect(() => {
      const owner = workspace()
      const pending = new Map<string, object>()
      const foreign = new Set<string>()
      let controller = new AbortController()
      const off = sdk.event.on("event", (event) => {
        const payload = event.payload
        if (payload.type === "sync") {
          const record = payload.syncEvent
          if (record.type === "session.deleted.1") {
            pending.delete(record.aggregateID)
            foreign.delete(record.aggregateID)
          }
          if (record.type === "session.created.1" || record.type === "session.updated.1") {
            pending.delete(record.aggregateID)
            if (event.workspace !== owner && record.data.info.metadata?.["kilo.goal"]) {
              foreign.add(record.aggregateID)
              return
            }
            foreign.delete(record.aggregateID)
          }
          return
        }
        if (
          payload.type !== "server.connected" &&
          (payload.type !== "workspace.status" || payload.properties.workspaceID !== owner)
        )
          return
        controller.abort()
        pending.clear()
        if (payload.type === "workspace.status" && payload.properties.status !== "connected") return
        controller = new AbortController()
        const signal = controller.signal
        for (const session of store.session) {
          if (foreign.has(session.id) || (session.workspaceID && session.workspaceID !== owner)) continue
          const goal = session.metadata?.["kilo.goal"]
          if (!goal || typeof goal !== "object" || !("active" in goal) || goal.active !== true) continue
          const token = {}
          pending.set(session.id, token)
          void sdk.client.session
            .get({ sessionID: session.id, workspace: owner }, { signal, throwOnError: true })
            .then(({ data }) => {
              if (signal.aborted || pending.get(session.id) !== token) return
              update((draft) => {
                const current = draft.session.find((item) => item.id === session.id)
                if (!current) return
                const value = data.metadata?.["kilo.goal"]
                if (value == null) {
                  if (current.metadata) delete current.metadata["kilo.goal"]
                  return
                }
                current.metadata ??= {}
                current.metadata["kilo.goal"] = value
              })
            })
            .catch((err) => {
              if (signal.aborted || pending.get(session.id) !== token) return
              console.error("Failed to refresh goal state", err instanceof Error ? err.message : "Request failed")
            })
            .finally(() => {
              if (pending.get(session.id) === token) pending.delete(session.id)
            })
        }
      })
      onCleanup(() => {
        controller.abort()
        pending.clear()
        off()
      })
    })
  }
}
