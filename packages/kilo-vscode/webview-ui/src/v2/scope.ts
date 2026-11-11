// The v2 data of one directory over a shared client and event stream. Kept free of JSX and webview contexts, so the
// extension tests can load it.
import type { OpenCodeClient } from "@opencode/client"
import { createClientConnection, createData } from "@opencode/client/solid"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { createConnectionMetadata, type ConnectionMetadata } from "./connection-metadata"
import { toFailure, type Failure } from "./error"
import type { events } from "./events"
import { createKiloModels } from "./kilo-models"
import { createModelDrafts } from "./model-draft"

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
  /** Server-wide metadata shared by every store of one connection. Created here when omitted. */
  shared?: ConnectionMetadata
  /** Whether the session list of this directory is shown. A hidden directory loads it when it becomes visible. */
  visible?: Accessor<boolean>
  bindings: Accessor<Record<string, string>>
  /** Whether the active editor has selected text, which the prompt hint reads. */
  selection: Accessor<boolean>
  /**
   * Loads the sidebar data: the session list and the Kilo Gateway catalog status. The Settings and Profile panels
   * pass false, because neither renders a transcript and neither shows the catalog failure.
   */
  chat?: boolean
  onCommand: (handler: (name: string) => void) => void
  /** Opens an external URL through the host. */
  /** Opens a web link. `external` (shift-click) asks for the system browser instead of the Integrated Browser. */
  open: (url: string, external?: boolean) => void
}) {
  const api = input.api
  const directory = input.directory
  const connection = input.connection
  const chat = input.chat ?? true
  // The host inlines the extension version; the server handshake reports the server version separately.
  const extensionVersion =
    typeof window === "undefined" ? "" : ((window as unknown as { KILO_EXTENSION_VERSION?: string }).KILO_EXTENSION_VERSION ?? "")
  const [failure, setFailure] = createSignal<Failure>()
  const [loading, setLoading] = createSignal(true)
  const data = createData({
    api: () => api,
    directory,
    connection,
    event: input.event,
    onError: (err) => setFailure(toFailure(err)),
  })
  const metadata =
    input.shared ??
    createConnectionMetadata({
      api,
      connection,
      chat,
      subscribe: (type, handler) => input.event.on(type, handler),
    })
  metadata.attach(directory)
  const kiloModels = createKiloModels({
    api,
    directory,
    models: () => data.location.model.list(),
    cache: metadata.kiloModelsCache,
  })
  // The composer's model drafts live with the directory, not the chat view, so an effort change survives the history
  // view and an Agent Manager worktree switch, as the TUI keeps them app-wide. The echo of a commit, or any client
  // switching the session to the same model, makes a draft redundant.
  const drafts = createModelDrafts()
  onCleanup(input.event.on("session.model.selected", (event) => drafts.settle(event.data.sessionID, event.data.model)))
  onCleanup(input.event.on("session.deleted", (event) => drafts.drop(event.data.sessionID)))
  const visible = input.visible ?? (() => true)
  const state = { listed: false }
  createEffect(
    on(connection.status, (status) => {
      if (status !== "connected") state.listed = false
    }),
  )
  createEffect(
    on(
      () => [connection.status(), visible()] as const,
      ([status, show]) => {
        if (!chat) {
          setLoading(false)
          return
        }
        if (status !== "connected" || !show || state.listed) return
        state.listed = true
        setLoading(true)
        void api.session
          .list({ directory, parentID: null, order: "desc", limit: 50 })
          .then((response) => response.data.forEach(data.session.remember))
          .catch((err: unknown) => setFailure(toFailure(err)))
          .finally(() => setLoading(false))
      },
    ),
  )

  return {
    api,
    data,
    directory,
    connection,
    loading,
    bindings: input.bindings,
    selection: input.selection,
    version: metadata.version,
    extensionVersion,
    handshake: metadata.handshake,
    /** The last failure this window reported; undefined once it is dismissed. */
    failure,
    /** Why the Kilo Gateway catalog failed to load; undefined while it is usable or loading. */
    kiloFailure: metadata.kiloFailure,
    /** The Kilo Gateway model metadata and the account team, for the model pickers. */
    kiloModels,
    /** The composer's uncommitted model and effort per session; the next prompt commits it. */
    drafts,
    clearError: () => setFailure(undefined),
    report: (err: unknown) => setFailure(toFailure(err)),
    open: input.open,
    onCommand: input.onCommand,
  }
}

export type V2 = ReturnType<typeof createV2Scope>

/** True when the server reports that a session does not exist: the client names declared errors by their tag. */
export function sessionMissing(error: unknown) {
  return error instanceof Error && error.name === "SessionNotFoundError"
}

export { message } from "./error"
