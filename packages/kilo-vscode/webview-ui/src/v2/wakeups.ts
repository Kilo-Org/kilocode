// The pending wakeups of the directories a client shows, reduced to the sessions it draws as `scheduled`. One connect
// lists the pending state of each directory once and `changed` events keep it current; a session with no future wakeup
// leaves the map, so the state can never stick.
import type { OpenCodeClient } from "@opencode/client"
import { KiloWakeupRpc } from "@opencode/schema/kilocode/wakeup"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { readListed } from "../../../src/shared/plugin-inventory"

function errorType(error: unknown) {
  if (error && typeof error === "object" && "type" in error && typeof error.type === "string") return error.type
  return undefined
}

export function createWakeups(input: {
  api: OpenCodeClient
  /** The directories whose sessions are drawn. Read reactively: a project or worktree added later is seeded too. */
  directories: () => readonly string[]
  connected: () => boolean
  /**
   * The directory whose Location answers for all of them. The wakeup state is global and `pending` filters it by its
   * `directory` input, so asking one loaded Location keeps the server from loading every worktree just to answer.
   * Without it, each directory answers for itself.
   */
  home?: () => string | undefined
}) {
  const rpc = input.api.rpc(KiloWakeupRpc.Definition)
  // Directory to session id to the earliest future due time.
  const [pending, setPending] = createSignal<Record<string, Record<string, number>>>({})
  const seeded = new Set<string>()
  let unsupported = false
  // The connection the reads belong to. A dropped connection and a disposed owner end the reads of the one before.
  let connection = 0
  // Per directory, the sessions a `changed` event set while the seed read is open. An event carries the session's
  // whole pending state and every later write sends another one, so the snapshot of the read must not replace it.
  const touched = new Map<string, Set<string>>()

  const seed = (directory: string) => {
    if (unsupported) return
    const run = connection
    const location = input.home?.() ?? directory
    const events = new Set<string>()
    touched.set(directory, events)
    void readListed({
      api: input.api,
      directory: location,
      active: () => run === connection,
      read: () => rpc.pending({ directory }, { location: { directory: location } }),
    })
      .then((value) => {
        // The answer of a dropped connection is older than the reseed of the next one.
        if (run !== connection) return
        touched.delete(directory)
        setPending((current) => {
          const map: Record<string, number> = {}
          for (const item of value.sessions)
            if (item.dueAt !== undefined && !events.has(item.sessionID)) map[item.sessionID] = item.dueAt
          for (const sessionID of events) {
            const dueAt = current[directory]?.[sessionID]
            if (dueAt !== undefined) map[sessionID] = dueAt
          }
          return { ...current, [directory]: map }
        })
      })
      .catch((error: unknown) => {
        if (run !== connection) return
        touched.delete(directory)
        // A server without the plugin keeps every map empty instead of reporting a failure on each connect.
        if (errorType(error) === "rpc.unavailable") unsupported = true
      })
  }

  const sync = () => {
    if (!input.connected()) return
    for (const directory of input.directories())
      if (!seeded.has(directory)) {
        seeded.add(directory)
        seed(directory)
      }
  }

  createEffect(
    on(
      () => [input.connected(), input.directories().join("\n")] as const,
      ([connected]) => {
        if (!connected) {
          // A reconnect reseeds from the server so a fire or cancel missed while offline cannot linger.
          connection++
          seeded.clear()
          touched.clear()
          unsupported = false
          setPending({})
          return
        }
        sync()
      },
    ),
  )

  onCleanup(() => {
    connection++
  })
  onCleanup(
    rpc.events.on("changed", (event) => {
      const { directory, sessionID, pending: count, dueAt } = event.data
      touched.get(directory)?.add(sessionID)
      setPending((current) => {
        const map = { ...(current[directory] ?? {}) }
        if (count > 0 && dueAt !== undefined) map[sessionID] = dueAt
        else delete map[sessionID]
        return { ...current, [directory]: map }
      })
    }),
  )

  return {
    /**
     * Whether the session holds a future wakeup, which clients show as `scheduled` instead of idle. The due time is
     * compared too, so a fire whose `changed` event was missed stops reporting `scheduled` once its time passes.
     */
    scheduled: (sessionID: string) => {
      const now = Date.now()
      return Object.values(pending()).some((map) => (map[sessionID] ?? 0) > now)
    },
  }
}
