// The v2 data of one directory over a shared client and event stream. Kept free of JSX and webview contexts, so the
// extension tests can load it.
import type { OpenCodeClient } from "@opencode/client"
import { createClientConnection, createData } from "@opencode/client/solid"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { createConnectionMetadata, type ConnectionMetadata } from "./connection-metadata"
import { toFailure, type Failure } from "./error"
import type { events } from "./events"
import { createKiloCatalog } from "./kilo-catalog"
import { createKiloModels } from "./kilo-models"
import { createModelDrafts } from "./model-draft"
import { createWakeups } from "./wakeups"

type Connection = ReturnType<typeof createClientConnection>
type Events = ReturnType<typeof events>

/** Retry delays for a failed session list; a longer window than the handshake covers a server that is restarted. */
const LIST_RETRY = [1_000, 3_000, 10_000] as const

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
  /**
   * Whether a Session holds a future wakeup. A panel with several directories supplies one store for all of them; a
   * single-directory scope reads its own directory instead.
   */
  scheduled?: (sessionID: string) => boolean
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
  const lifecycle = { disposed: false }
  onCleanup(() => {
    lifecycle.disposed = true
  })
  const dataApi = wrapLocationSync(api, () => data, () => lifecycle.disposed)
  const data = createData({
    api: () => dataApi,
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
    })
  onCleanup(metadata.attach(directory))
  const visible = input.visible ?? (() => true)
  const catalogActive = () => visible() || data.location.model.list() !== undefined
  const kiloFailure = !chat
    ? () => undefined
    : createKiloCatalog({
        api,
        directory: () => directory,
        status: () => (catalogActive() ? connection.status() : "disconnected"),
        on: (type, handler) => input.event.on(type, handler),
      })
  const kiloModels = createKiloModels({
    api,
    directory,
    models: () => data.location.model.list(),
  })
  // The composer's model drafts live with the directory, not the chat view, so an effort change survives the history
  // view and an Agent Manager worktree switch, as the TUI keeps them app-wide. The echo of a commit, or any client
  // switching the session to the same model, makes a draft redundant.
  const drafts = createModelDrafts()
  onCleanup(input.event.on("session.model.selected", (event) => drafts.settle(event.data.sessionID, event.data.model)))
  onCleanup(input.event.on("session.deleted", (event) => drafts.drop(event.data.sessionID)))
  // Settings scopes draw no sessions, so only a chat scope that was not given a shared store reads its own directory.
  const wakeups =
    input.scheduled || !chat
      ? undefined
      : createWakeups({
          api,
          directories: () => [directory],
          connected: () => connection.status() === "connected",
        })
  const state = {
    listed: false,
    retry: undefined as ReturnType<typeof setTimeout> | undefined,
    reported: undefined as Failure | undefined,
  }
  onCleanup(() => clearTimeout(state.retry))
  // A failed read must not leave the list empty for the life of the connection: it releases the latch so the next
  // connected or visible transition retries, and a short backoff covers one bad response on a healthy connection.
  const list = (attempt = 0) => {
    clearTimeout(state.retry)
    state.listed = true
    setLoading(true)
    void api.session
      .list({ directory, parentID: null, order: "desc", limit: 50 })
      .then((response) => {
        response.data.forEach(data.session.remember)
        // Clear the failure this list reported, not one a later action owns.
        const reported = state.reported
        if (reported === undefined) return
        state.reported = undefined
        setFailure((current) => (current === reported ? undefined : current))
      })
      .catch((err: unknown) => {
        const failure = toFailure(err)
        state.listed = false
        state.reported = failure
        setFailure(failure)
        const delay = LIST_RETRY[attempt]
        if (delay === undefined) return
        state.retry = setTimeout(() => {
          if (state.listed || connection.status() !== "connected" || !visible()) return
          list(attempt + 1)
        }, delay)
      })
      .finally(() => setLoading(false))
  }
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
        list()
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
    kiloFailure,
    /** The Kilo Gateway model metadata and the account team, for the model pickers. */
    kiloModels,
    /** The composer's uncommitted model and effort per session; the next prompt commits it. */
    drafts,
    /** Whether a Session holds a future wakeup, shown as `scheduled` instead of idle. */
    scheduled: input.scheduled ?? wakeups?.scheduled ?? (() => false),
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

type LocationInfo = Awaited<ReturnType<OpenCodeClient["location"]["get"]>>

/**
 * Aligns `createData`'s `defaultLocation` with the server's canonical `location.directory` without adding a duplicate
 * `/api/location` request. Upstream `createData` populates `location.info` on `server.connected` without calling
 * `setDefaultLocation`, and `{ alias: true }` only aliases writes keyed by `defaultLocation()` rather than located
 * `model.updated` / `provider.updated` refreshes. When the server returns a different canonical directory (e.g.
 * Windows backslashes or a symlink target), this triggers `syncInfo()` using the already-fetched or in-flight
 * `location.get` response so subsequent located updates land directly at the key `list()` reads.
 */
function wrapLocationSync(
  api: OpenCodeClient,
  getData: () => ReturnType<typeof createData>,
  disposed: () => boolean,
): OpenCodeClient {
  if (!api.location) return api
  let cached: { requested: string; info: LocationInfo } | undefined
  let inflight: { requested: string; promise: Promise<LocationInfo> } | undefined

  const align = (requested: string | undefined, canonical: string, info?: LocationInfo) => {
    if (!requested) return
    // Defer past the caller's microtask so an explicit `syncInfo()` updates `defaultLocation()` first.
    queueMicrotask(() => {
      if (disposed()) return
      const data = getData()
      const current = data.location.default().directory
      if (requested !== current || canonical === current) return
      if (info) cached = { requested, info }
      void data.location
        .syncInfo()
        .then(() => {
          if (disposed()) return
          // `config.get` returns no `location`, so `createData` stores it under the requested key; resync under the
          // canonical default if it was loaded before `defaultLocation` aligned.
          if (
            data.location.default().directory !== requested &&
            data.location.config.list({ directory: requested }) !== undefined &&
            data.location.config.list() === undefined
          ) {
            void data.location.config.sync().catch(() => undefined)
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (info && cached?.info === info) cached = undefined
        })
    })
  }

  return {
    ...api,
    location: {
      ...api.location,
      get: (query, options) => {
        const requested = query?.location?.directory
        if (cached && requested === cached.requested) {
          const info = cached.info
          cached = undefined
          return Promise.resolve(info)
        }
        if (inflight && !options?.signal && requested === inflight.requested) return inflight.promise
        const promise = api.location.get(query, options)
        if (requested && !options?.signal) {
          const entry = { requested, promise }
          inflight = entry
          const clear = () => {
            if (inflight === entry) inflight = undefined
          }
          void promise.then(clear, clear)
        }
        void promise.then((info) => align(requested, info.directory, info), () => undefined)
        return promise
      },
    },
    ...(api.model
      ? {
          model: {
            ...api.model,
            list: (query, options) => {
              const requested = query?.location?.directory
              const promise = api.model.list(query, options)
              void promise.then((response) => align(requested, response.location.directory), () => undefined)
              return promise
            },
          },
        }
      : {}),
    ...(api.provider
      ? {
          provider: {
            ...api.provider,
            list: (query, options) => {
              const requested = query?.location?.directory
              const promise = api.provider.list(query, options)
              void promise.then((response) => align(requested, response.location.directory), () => undefined)
              return promise
            },
          },
        }
      : {}),
  }
}
