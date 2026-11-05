// The v2 data of one directory over a shared client and event stream. Kept free of JSX and webview contexts, so the
// extension tests can load it.
import type { OpenCodeClient } from "@opencode/client"
import { createClientConnection, createData } from "@opencode/client/solid"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { createEffect, createSignal, on, type Accessor } from "solid-js"
import type { events } from "./events"
import { createKiloCatalog } from "./kilo-catalog"
import { createKiloModels } from "./kilo-models"

type Connection = ReturnType<typeof createClientConnection>
type Events = ReturnType<typeof events>

/**
 * The data of one directory over a shared client and event stream: the sidebar has one, the Agent Manager one per
 * project and worktree. Call it inside a reactive owner; disposing the owner releases the store.
 */
export function createV2Scope(input: {
  api: OpenCodeClient
  connection: Connection
  event: Events
  directory: string
  bindings: Accessor<Record<string, string>>
  onCommand: (handler: (name: string) => void) => void
  /** Opens an external URL through the host. */
  open: (url: string) => void
}) {
  const api = input.api
  const directory = input.directory
  const connection = input.connection
  // The host inlines the extension version; the server handshake reports the server version separately.
  const extensionVersion =
    (window as unknown as { KILO_EXTENSION_VERSION?: string }).KILO_EXTENSION_VERSION ?? ""
  const [error, setError] = createSignal("")
  const [version, setVersion] = createSignal("")
  const [handshake, setHandshake] = createSignal("")
  const [loading, setLoading] = createSignal(true)
  const data = createData({
    api: () => api,
    directory,
    connection,
    event: input.event,
    onError: (err) => setError(message(err)),
  })
  const kiloFailure = createKiloCatalog({ api, directory, status: connection.status, on: input.event.on })
  const kiloModels = createKiloModels({ api, directory, models: () => data.location.model.list() })

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
    bindings: input.bindings,
    version,
    extensionVersion,
    handshake,
    error,
    /** Why the Kilo Gateway catalog failed to load; undefined while it is usable or loading. */
    kiloFailure,
    /** The Kilo Gateway model metadata and the account team, for the model pickers. */
    kiloModels,
    setError,
    report: (err: unknown) => setError(message(err)),
    open: input.open,
    onCommand: input.onCommand,
  }
}

export type V2 = ReturnType<typeof createV2Scope>

/** True when the server reports that a session does not exist: the client names declared errors by their tag. */
export function sessionMissing(error: unknown) {
  return error instanceof Error && error.name === "SessionNotFoundError"
}

export function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message)
  return String(error)
}
