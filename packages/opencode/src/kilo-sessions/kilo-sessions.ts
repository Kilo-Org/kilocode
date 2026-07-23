import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { KiloSession } from "@/kilocode/session"
import { SessionID } from "@/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageV2 } from "@/session/message-v2"
import { Storage } from "@/storage/storage"
import * as Log from "@opencode-ai/core/util/log"
import { Auth } from "@/auth"
import { makeRuntime } from "@/effect/run-service"
import { IngestQueue } from "@/kilo-sessions/ingest-queue"
import { clearInFlightCache, withInFlightCache } from "@/kilo-sessions/inflight-cache"
import type * as SDK from "@kilocode/sdk/v2"
import z from "zod"
import { Context, Effect, Layer, Schema } from "effect"
import { KILO_API_BASE } from "@kilocode/kilo-gateway"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Instance } from "@/kilocode/instance"
import { Vcs } from "@/project/vcs"
import simpleGit from "simple-git"
import type { RemoteWS } from "@/kilo-sessions/remote-ws"
import type { RemoteSender } from "@/kilo-sessions/remote-sender"
import { AttachedState } from "@/kilo-sessions/attached-state"
import { SessionStatus } from "@/session/status"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { withTimeout } from "@/util/timeout"
import { Snapshot } from "@/snapshot"
import { cumulativeSessionDiff } from "@/kilocode/session-portability/cumulative-diff"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

async function provide<R>(input: { directory: string; fn: () => R }): Promise<R> {
  const { provide } = await import("@/kilocode/instance")
  return provide(input)
}

export namespace KiloSessions {
  export const Event = {
    RemoteStatusChanged: BusEvent.define(
      "kilo-sessions.remote-status-changed",
      Schema.Struct({
        enabled: Schema.Boolean,
        connected: Schema.Boolean,
      }),
    ),
  }

  export interface Interface {
    readonly init: () => Effect.Effect<void, unknown>
    readonly sendAgentNotification: (
      sessionID: string,
      input: { id: string; message: string },
    ) => Effect.Effect<{ ok: true } | { ok: false; reason: string }, never>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/KiloSessions") {}

  const log = Log.create({ service: "kilo-sessions" })
  const attachedLog = { warn: (msg: string, meta?: unknown) => log.warn(msg, meta as never) }
  const runtime = makeRuntime(Auth.Service, Auth.defaultLayer)

  const Uuid = z.uuid()
  type Uuid = z.infer<typeof Uuid>

  const tokenValidKeyTemplate = "kilo-sessions:token-valid:"
  let tokenValidKey = tokenValidKeyTemplate + "unknown"

  const tokenKey = "kilo-sessions:token"
  const orgKey = "kilo-sessions:org"
  const clientKey = "kilo-sessions:client"
  const gitUrlKeyPrefix = "kilo-sessions:git-url:"

  const ttlMs = 10_000

  function agentNotificationTimeoutMs(): number {
    const value = process.env["KILO_AGENT_NOTIFICATION_TIMEOUT_MS"]
    return value ? Number(value) : 10_000
  }

  // Per-session in-flight bootstrap tracker so concurrent calls to
  // sendAgentNotification (and the watch(Session.Event.Created) path) share a
  // single POST /api/session call. Entries resolve to the same share record or
  // a thrown error; on bootstrap failure the rejection is captured as a
  // `{ ok:false, reason }` outcome so callers can map it to the tool's failure
  // text without re-throwing.
  type BootstrapOutcome = { ok: true; ingestPath: string } | { ok: false; reason: string }
  const bootstrapInflight = new Map<string, Promise<BootstrapOutcome>>()

  function clearCache() {
    clearInFlightCache(tokenKey)
    clearInFlightCache(tokenValidKey)
    clearInFlightCache(clientKey)
    clearInFlightCache(orgKey)
    clearInFlightCache(gitUrlKeyPrefix + Instance.worktree)
  }

  async function authValid(token: string) {
    const newTokenValidKey = tokenValidKeyTemplate + token

    if (newTokenValidKey !== tokenValidKey) {
      clearInFlightCache(tokenValidKey)

      tokenValidKey = newTokenValidKey
    }

    return withInFlightCache(tokenValidKey, 15 * 60_000, async () => {
      const response = await fetch(`${KILO_API_BASE}/api/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => undefined)

      // Don't cache transient network failures; allow future calls to retry.
      if (!response) return undefined

      const valid = response.ok
      return valid
    })
  }

  async function kilocodeToken() {
    return withInFlightCache(tokenKey, ttlMs, async () => {
      const auth = await runtime.runPromise((svc) => svc.get("kilo"))
      if (auth?.type === "api" && auth.key.length > 0) return auth.key
      if (auth?.type === "oauth" && auth.access.length > 0) return auth.access
      if (auth?.type === "wellknown" && auth.token.length > 0) return auth.token

      const key = process.env["KILO_API_KEY"]?.trim()
      if (key) return key
      return undefined
    })
  }

  async function model(providerID: ProviderV2.ID, modelID: ModelV2.ID) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Provider.Service.use((svc) => svc.getModel(providerID, modelID)))
  }

  async function models(refs: Array<{ providerID: string; modelID: string }>) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(
      Provider.Service.use((svc) =>
        Effect.all(refs.map((ref) => svc.getModel(ProviderV2.ID.make(ref.providerID), ModelV2.ID.make(ref.modelID)))),
      ),
    )
  }

  type Client = {
    url: string
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }

  function transport(info: Session.Info): SDK.Session {
    return {
      ...info,
      summary: info.summary
        ? {
            ...info.summary,
            diffs: info.summary.diffs?.filter(
              (diff): diff is typeof diff & { file: string } => diff.file !== undefined,
            ),
          }
        : undefined,
    }
  }

  async function getClient(): Promise<Client | undefined> {
    return withInFlightCache(clientKey, ttlMs, async () => {
      const token = await kilocodeToken()
      if (!token) return undefined

      const valid = await authValid(token)
      if (!valid) return undefined

      const base = process.env["KILO_SESSION_INGEST_URL"] ?? "https://ingest.kilosessions.ai"
      const baseHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }

      const withHeaders = (init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        for (const [k, v] of Object.entries(baseHeaders)) headers.set(k, v)
        return {
          ...init,
          headers,
        } satisfies RequestInit
      }

      return {
        url: base,
        fetch: (input, init) => fetch(input, withHeaders(init)),
      }
    })
  }

  const shareDisabled = process.env["KILO_DISABLE_SHARE"] === "true" || process.env["KILO_DISABLE_SHARE"] === "1"
  const ingestDisabled =
    process.env["KILO_DISABLE_SESSION_INGEST"] === "true" || process.env["KILO_DISABLE_SESSION_INGEST"] === "1"
  const debugIngest =
    process.env["KILO_DEBUG_SESSION_INGEST"] === "true" || process.env["KILO_DEBUG_SESSION_INGEST"] === "1"

  const ingest = IngestQueue.create({
    getShare: async (sessionId) => get(sessionId).catch(() => undefined),
    getClient,
    log: {
      ...(debugIngest ? { info: log.info.bind(log) } : {}),
      error: log.error.bind(log),
    },
    onAuthError: () => {
      // Non-retryable until credentials are fixed.
      // Clearing caches prevents repeated use of a now-invalid token/client.
      clearCache()
    },
  })

  const remoteEnabled = process.env["KILO_REMOTE"] === "1"
  let remote: { conn: RemoteWS.Connection; sender: RemoteSender.Sender } | undefined
  let enabling: Promise<void> | undefined
  let remoteSeq = 0
  // Separate presence-owned attached session ids from newly-created (pending)
  // session announcements so a concurrent presence update cannot drop a pending
  // id and a heartbeat failure cannot delete a presence-owned id. The heartbeat
  // closure throws when no remote connection is available so `announce` cannot
  // silently mark a session as attached; create_session's catch block turns that
  // into the sanitized failure response and the user retries manually.
  const attachedState = AttachedState.create({
    heartbeat: (opts) =>
      remote
        ? remote.conn.heartbeat(opts)
        : Promise.reject(new Error("attachRemoteSession: no remote connection")),
    log: attachedLog,
  })
  const statusSyncs = new Map<string, { running: boolean; dirty: boolean }>()
  const STATUS_TIMEOUT_MS = 3_000

  async function deriveStatus(sessionID: string): Promise<"idle" | "busy" | "question" | "permission" | "retry"> {
    const { AppRuntime } = await import("@/effect/app-runtime")
    const permissions = (await AppRuntime.runPromise(Permission.Service.use((svc) => svc.list()))).filter(
      (p) => p.sessionID === sessionID,
    )
    if (permissions.length > 0) return "permission"

    const questions = (await AppRuntime.runPromise(Question.Service.use((svc) => svc.list()))).filter(
      (q) => q.sessionID === sessionID,
    )
    if (questions.length > 0) return "question"

    const status = await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.get(SessionID.make(sessionID))))
    if (status.type === "offline") return "retry"
    return status.type
  }

  async function deriveAndSyncStatus(sessionID: string) {
    const status = await withTimeout(deriveStatus(sessionID), STATUS_TIMEOUT_MS)
    await ingest.sync(sessionID, [{ type: "session_status", data: { status } }])
  }

  async function cumulative(sessionId: string, local: Snapshot.FileDiff[]) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(
      Storage.Service.use((storage) => cumulativeSessionDiff(storage, SessionID.make(sessionId), local)),
    )
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const sessions = yield* Session.Service
      const state = yield* InstanceState.make(
        Effect.fn("KiloSessions.state")(function* (ctx) {
          if (ingestDisabled) return

          // Register event callbacks into a type→callback dispatch map, drained by a single
          // GlobalBus listener installed below. GlobalBus is the unified channel that receives BOTH legacy Bus
          // emissions (TurnOpen/TurnClose) and EventV2Bridge emissions (upstream moved Session/Message/Question/
          // Status/Permission events to EventV2, which publishes only to GlobalBus, not the legacy typed Bus).
          // Both channels emit the same { payload: { id, type, properties } } shape.
          const handlers = new Map<string, (evt: { properties: any }) => unknown | Promise<unknown>>()
          const watch = <D extends { type: string }>(
            def: D,
            fn: (evt: { properties: any }) => unknown | Promise<unknown>,
          ) => {
            handlers.set(def.type, fn)
          }

          watch(Session.Event.Created, (evt) => {
            const sessionID = evt.properties.info.id
            return create(sessionID).catch((error) => log.error("share init create failed", { sessionID, error }))
          })
          watch(Session.Event.Updated, async (evt) => {
            const sessionID = evt.properties.sessionID
            const session = await Effect.runPromise(sessions.get(sessionID).pipe(Effect.orElseSucceed(() => null)))
            if (!session) return
            await ingest.sync(sessionID, [
              { type: "kilo_meta", data: await meta(sessionID) },
              { type: "session", data: transport(session) },
            ])
          })
          watch(MessageV2.Event.Updated, async (evt) => {
            await ingest.sync(evt.properties.info.sessionID, [{ type: "message", data: evt.properties.info }])
            if (evt.properties.info.role !== "user") return
            const mdl = await model(evt.properties.info.model.providerID, evt.properties.info.model.modelID)
            await ingest.sync(evt.properties.info.sessionID, [{ type: "model", data: [mdl] }])
          })
          watch(MessageV2.Event.PartUpdated, (evt) =>
            ingest.sync(evt.properties.part.sessionID, [{ type: "part", data: evt.properties.part }]),
          )
          watch(Session.Event.Diff, (evt) =>
            cumulative(evt.properties.sessionID, evt.properties.diff).then((diff) =>
              ingest.sync(evt.properties.sessionID, [{ type: "session_diff", data: diff }]),
            ),
          )
          watch(Session.Event.TurnOpen, (evt) =>
            ingest.sync(evt.properties.sessionID, [{ type: "session_open", data: {} }]),
          )
          watch(Session.Event.TurnClose, (evt) =>
            ingest.sync(evt.properties.sessionID, [{ type: "session_close", data: { reason: evt.properties.reason } }]),
          )

          const sync = (evt: { properties: { sessionID: string } }) => {
            const sessionID = evt.properties.sessionID
            const current = statusSyncs.get(sessionID)
            if (current?.running) {
              current.dirty = true
              return
            }

            const entry = current ?? { running: false, dirty: false }
            statusSyncs.set(sessionID, entry)

            const fail = (error: unknown) => {
              const dirty = entry.dirty
              statusSyncs.delete(sessionID)
              log.error("status sync failed", { sessionID, error: String(error) })
              if (dirty) sync(evt)
            }

            const loop = async () => {
              entry.running = true
              entry.dirty = false
              await deriveAndSyncStatus(sessionID)
              if (entry.dirty) {
                void loop().catch(fail)
                return
              }
              statusSyncs.delete(sessionID)
            }

            void loop().catch(fail)
          }
          watch(SessionStatus.Event.Status, sync)
          watch(Question.Event.Asked, sync)
          watch(Question.Event.Replied, sync)
          watch(Question.Event.Rejected, sync)
          watch(Permission.Event.Asked, sync)
          watch(Permission.Event.Replied, sync)

          // One GlobalBus listener drains the dispatch map. This state is cached per-directory
          // (InstanceState), matching the per-directory legacy Bus PubSub it replaced, so we filter process-wide
          // GlobalBus events down to this instance's directory. A single listener (vs one per event type) keeps
          // us well under GlobalBus's max-listeners cap when several worktrees are active.
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const handler = (event: { directory?: string; payload?: { type?: string; properties?: unknown } }) => {
                if (event.directory !== ctx.directory) return
                const type = event.payload?.type
                if (type === undefined) return
                const fn = handlers.get(type)
                if (!fn) return
                // Instance.restore: handlers run async work after the emitting fiber's
                // synchronous window, where fiber-scoped InstanceRef is no longer visible.
                Promise.resolve(Instance.restore(ctx, () => fn({ properties: event.payload!.properties }))).catch(
                  (cause) => log.error("subscriber failed", { type, cause }),
                )
              }
              GlobalBus.on("event", handler)
              return handler
            }),
            (handler) => Effect.sync(() => void GlobalBus.off("event", handler)),
          )

          const cfg = yield* config.getGlobal()
          if (remoteEnabled || cfg.remote_control) {
            yield* Effect.sync(
              () => void enableRemote().catch((err) => log.warn("remote not enabled", { error: String(err) })),
            )
          }
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              statusSyncs.clear()
              disableRemote()
            }),
          )
        }),
      )

      const init = Effect.fn("KiloSessions.init")(function* () {
        yield* InstanceState.get(state)
      })

      const sendAgentNotification = Effect.fn("KiloSessions.sendAgentNotification")(function* (
        sessionID: string,
        input: { id: string; message: string },
      ) {
        if (ingestDisabled) {
          return { ok: false, reason: "not_connected" } as const
        }

      const readiness = yield* Effect.tryPromise({
        try: () =>
          withTimeout(
            resolveReadiness(sessionID),
            agentNotificationTimeoutMs(),
            "agent notification readiness timed out",
          ),
        catch: () => ({ ok: false, reason: "not_connected" } as const),
      }).pipe(Effect.catch((value) => Effect.succeed(value)))

      if (!readiness.ok) return readiness
      return yield* Effect.promise(() =>
        postAgentNotification(sessionID, readiness.ingestPath, readiness.client, input),
      )
      })

      return Service.of({ init, sendAgentNotification })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Session.defaultLayer),
  )

  // No-op service for unit tests. Avoids touching the real Bus/Config/Session
  // graph and never initiates bootstrap or POSTs. `sendAgentNotification` reports `not_connected`
  // so tests can assert the failure-text path without mocking fetch.
  export const testLayer = Layer.succeed(Service, {
    init: () => Effect.void,
    sendAgentNotification: () => Effect.succeed({ ok: false, reason: "not_connected" } as const),
  })

  export const node = LayerNode.suspend(() => LayerNode.make(layer, [Bus.node, Config.node, Session.node]))

  export async function enableRemote() {
    if (remote) return
    if (ingestDisabled) return
    if (enabling) return enabling
    const seq = ++remoteSeq
    void Bus.publish(Instance.current, Event.RemoteStatusChanged, { enabled: true, connected: false })
    enabling = (async () => {
      const token = await kilocodeToken()
      if (!token) {
        throw new Error("Unable to enable remote: no Kilo credentials found. Run `kilo auth login`.")
      }

      const valid = await authValid(token)
      if (valid === false) {
        throw new Error("Unable to enable remote: invalid or expired Kilo credentials. Run `kilo auth login`.")
      }
      if (valid === undefined) throw new Error("Unable to enable remote: failed to verify Kilo credentials.")

      const url = (process.env["KILO_SESSION_INGEST_URL"] ?? "https://ingest.kilosessions.ai")
        .replace(/^https:\/\//, "wss://")
        .replace(/^http:\/\//, "ws://")

      const [{ RemoteWS }, { RemoteSender }] = await Promise.all([
        import("@/kilo-sessions/remote-ws"),
        import("@/kilo-sessions/remote-sender"),
      ])

      // Capture directory so the heartbeat timer can re-enter the Instance context
      // (setInterval runs outside AsyncLocalStorage scope)
      const directory = Instance.directory
      const getSessions = async () => {
        const [gitUrl, gitBranch] = await Promise.all([
          getGitUrl().catch(() => undefined),
          branch().catch(() => undefined),
        ])
        const { AppRuntime } = await import("@/effect/app-runtime")
        const statusMap = await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.list()))
        const statuses: Record<string, SessionStatus.Info> = Object.fromEntries(statusMap)
        // Advertise both presence-owned and pending-created ids so the relay learns about new
        // sessions before the next periodic heartbeat and the create_session response can be sent.
        const ids = new Set(Object.keys(statuses))
        for (const id of attachedState.union()) ids.add(id)
        const results = await AppRuntime.runPromise(
          Session.Service.use((svc) =>
            Effect.all(
              [...ids].map((id) =>
                svc.get(SessionID.make(id)).pipe(
                  Effect.map((session) => ({
                    id,
                    status: statuses[id]?.type ?? ("idle" as const),
                    title: session.title,
                    parentSessionId: session.parentID,
                    gitUrl,
                    gitBranch,
                  })),
                  Effect.orElseSucceed(() => undefined),
                ),
              ),
            ),
          ),
        )
        const sessions = results.filter((r): r is NonNullable<typeof r> => !!r)
        return { sessions }
      }

      const conn = RemoteWS.connect({
        url,
        getToken: kilocodeToken,
        withContext: (fn) => provide({ directory, fn }),
        getSessions,
        log,
        onOpen: () => {
          void Bus.publish(Instance.current, Event.RemoteStatusChanged, { enabled: true, connected: true })
        },
        onDisconnect: () => {
          void Bus.publish(Instance.current, Event.RemoteStatusChanged, { enabled: !!remote, connected: false })
        },
        onMessage: (msg) => {
          // Restore the directory context before dispatching an async remote message.
          void provide({ directory, fn: () => sender.handle(msg) })
        },
        onClose: () => disableRemote(),
      })

      const sender = RemoteSender.create({
        conn,
        directory: Instance.directory,
        log,
      })

      if (seq !== remoteSeq) {
        sender.dispose()
        conn.close()
        return
      }

      remote = { conn, sender }
      log.info("remote connection enabled", { connected: conn.connected })
      Telemetry.trackRemoteConnectionOpened()
      void Bus.publish(Instance.current, Event.RemoteStatusChanged, { enabled: true, connected: conn.connected })
    })()
      .catch((err) => {
        if (remoteSeq === seq && !remote)
          void Bus.publish(Instance.current, Event.RemoteStatusChanged, { enabled: false, connected: false })
        throw err
      })
      .finally(() => {
        if (remoteSeq === seq) enabling = undefined
      })

    return enabling
  }

  export function disableRemote() {
    remoteSeq += 1
    const pending = !!enabling
    enabling = undefined
    // Clear both presence and pending-created ids so the next remote connection lifecycle starts
    // with a clean slate and stale pending announcements from a previous connection do not leak.
    attachedState.reset()
    if (!remote) {
      if (pending) void Bus.publish(Instance.current, Event.RemoteStatusChanged, { enabled: false, connected: false })
      return
    }
    remote.sender.dispose()
    remote.conn.close()
    remote = undefined
    log.info("remote connection disabled")
    void Bus.publish(Instance.current, Event.RemoteStatusChanged, { enabled: false, connected: false })
  }

  export function remoteStatus() {
    return {
      enabled: !!remote || !!enabling,
      connected: remote?.conn.connected ?? false,
    }
  }
  export function setAttachedSessions(ids: readonly string[]) {
    // Delegate to the two-set state so a concurrent create announcement is not dropped by a presence
    // clear+rebuild.
    attachedState.setPresence(ids)
  }

  // Duplicate-safe single-session attach used by the remote create_session command. Delegates to
  // the two-set state so the announcement is preserved across a concurrent presence replacement
  // and a heartbeat failure rolls back only the entry this call added (a presence-owned id is never
  // reachable here because the factory guards it).
  export async function attachRemoteSession(id: string) {
    await attachedState.announce(id)
  }

export async function create(sessionId: string) {
  const inflight = bootstrapInflight.get(sessionId)
  if (inflight) {
    const result = await inflight
    if (!result.ok) return { id: "", ingestPath: "" }
    return { id: sessionId, ingestPath: result.ingestPath }
  }

  // Synchronously register the in-flight bootstrap promise before any await
  // so concurrent callers (e.g. sendAgentNotification racing the
  // Session.Event.Created handler) deterministically coalesce onto the same
  // POST /api/session.
  const task = trackBootstrap(sessionId, () => bootstrap(sessionId))
  const result = await task
  if (!result) return { id: "", ingestPath: "" }

  void fullSync(sessionId).catch((error) => log.error("share full sync failed", { sessionId, error }))

  return result
}

// Track an in-flight bootstrap for `sessionId` so callers that race the
// share ingest path (e.g. the `notify_user` tool calling
// sendAgentNotification before the Session.Event.Created handler has
// finished POSTing /api/session) can await the same outcome instead of
// firing their own bootstrap or failing. The bootstrap outcome promise is
// created and stored in `bootstrapInflight` synchronously before the first
// `await` so concurrent callers are deterministically coalesced.
function trackBootstrap(
  sessionId: string,
  start: () => Promise<{ id: string; ingestPath: string } | undefined>,
) {
  // Build the task and derived outcome promise as synchronous expressions
  // first; only then register the entry. This guarantees the value stored
  // in `bootstrapInflight` is the real promise rather than `undefined`.
  const task = start()
  const tracked: Promise<BootstrapOutcome> = task
    .then((value): BootstrapOutcome => {
      if (!value) return { ok: false, reason: "not_connected" }
      return { ok: true, ingestPath: value.ingestPath }
    })
    .catch((error: unknown): BootstrapOutcome => {
      const reason = error instanceof Error ? error.message : String(error)
      log.warn("session bootstrap failed", { sessionId, reason })
      return { ok: false, reason }
    })

  // Register synchronously before any async work starts so concurrent
  // callers see the entry in `bootstrapInflight` immediately.
  bootstrapInflight.set(sessionId, tracked)
  tracked.finally(() => {
    if (bootstrapInflight.get(sessionId) === tracked) bootstrapInflight.delete(sessionId)
  })
  return task
}

/** @internal - test-only helper */
export function _getBootstrapInflight(sessionId: string): Promise<BootstrapOutcome> | undefined {
  return bootstrapInflight.get(sessionId)
}

  export async function bootstrap(sessionId: string) {
    if (ingestDisabled) {
      log.info("session bootstrap skipped: ingest disabled", { sessionId })
      return
    }

    const client = await getClient()
    if (!client) {
      log.info("session bootstrap skipped: no client", { sessionId })
      return
    }

    log.info("creating session", { sessionId })

    const response = await client.fetch(`${client.url}/api/session`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    })

    if (!response.ok) {
      throw new Error(`Unable to create session ${sessionId}: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as { id: string; ingestPath: string }

    await save(sessionId, result)

    log.info("session bootstrap completed", { sessionId })

    return result
  }

  export async function share(sessionId: string) {
    if (ingestDisabled) {
      throw new Error("Session ingest is disabled (KILO_DISABLE_SESSION_INGEST=1)")
    }

    if (shareDisabled) {
      throw new Error("Sharing is disabled (KILO_DISABLE_SHARE=1)")
    }

    const client = await getClient()
    if (!client) {
      throw new Error("Unable to share session: no Kilo credentials found. Run `kilo auth login`.")
    }

    const current = (await get(sessionId).catch(() => undefined)) ?? (await create(sessionId))
    if (!current.id || !current.ingestPath) {
      throw new Error(`Unable to share session ${sessionId}: failed to initialize session sync.`)
    }

    log.info("sharing", { sessionId })

    const response = await client.fetch(`${client.url}/api/session/${encodeURIComponent(sessionId)}/share`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    })

    if (!response.ok) {
      throw new Error(`Unable to share session ${sessionId}: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as { public_id?: string }
    if (!result.public_id) {
      throw new Error(`Unable to share session ${sessionId}: server did not return a public id`)
    }

    const url = `https://app.kilo.ai/s/${result.public_id}`

    await save(sessionId, {
      ...current,
      url,
    })

    return { url }
  }

  export async function unshare(sessionId: string) {
    if (ingestDisabled) {
      throw new Error("Session ingest is disabled (KILO_DISABLE_SESSION_INGEST=1)")
    }

    if (shareDisabled) {
      throw new Error("Unshare is disabled (KILO_DISABLE_SHARE=1)")
    }

    const client = await getClient()
    if (!client) {
      throw new Error("Unable to unshare session: no Kilo credentials found. Run `kilo auth login`.")
    }

    log.info("unsharing", { sessionId })

    const response = await client.fetch(`${client.url}/api/session/${encodeURIComponent(sessionId)}/unshare`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    })

    if (!response.ok) {
      throw new Error(`Unable to unshare session ${sessionId}: ${response.status} ${response.statusText}`)
    }

    const current = await get(sessionId).catch(() => undefined)
    if (!current) return

    const next = {
      ...current,
    }
    delete next.url

    await save(sessionId, next)
  }

  type Share = {
    id: string
    url?: string
    ingestPath: string
  }

  async function save(sessionId: string, share: Share) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Storage.Service.use((svc) => svc.write(["session_share", sessionId], share)))
  }

  async function get(sessionId: string) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Storage.Service.use((svc) => svc.read<Share>(["session_share", sessionId])))
  }

  // Read the current share; if missing, return undefined (the agent tool
  // will then check the in-flight bootstrap tracker and only initiate a
  // bootstrap when one is already running, never on its own).
  async function readShare(sessionId: string) {
    return get(sessionId).catch(() => undefined)
  }

  // Await any in-flight bootstrap for `sessionId` with a bounded timeout.
  // Returns the share ingest path on success, `{ok:false, reason}` on
  // failure, or `not_connected` if no bootstrap is in flight (this method
  // never initiates a new one). Used by the `notify_user` tool's send path.
  async function awaitBootstrapForAgent(
    sessionId: string,
    timeoutMs: number,
  ): Promise<{ ok: true; ingestPath: string } | { ok: false; reason: string }> {
    const inflight = bootstrapInflight.get(sessionId)
    if (!inflight) return { ok: false, reason: "not_connected" }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<{ ok: false; reason: string }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "not_connected" }), timeoutMs)
    })
    try {
      return await Promise.race([inflight, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // Resolve the authenticated client and session ingest path needed by the
  // `notify_user` tool. This bundles auth/client resolution with any in-flight
  // bootstrap wait so the whole readiness path can be bounded by one timeout.
  async function resolveReadiness(
    sessionID: string,
  ): Promise<{ ok: true; client: Client; ingestPath: string } | { ok: false; reason: string }> {
    const client = await getClient()
    if (!client) return { ok: false, reason: "not_connected" }

    const existing = await readShare(sessionID)
    if (existing?.ingestPath) return { ok: true, client, ingestPath: existing.ingestPath }

    const ready = await awaitBootstrapForAgent(sessionID, agentNotificationTimeoutMs())
    if (!ready.ok) return ready
    return { ok: true, client, ingestPath: ready.ingestPath }
  }

  // Dedicated immediate POST for a single `agent_notification` item to the
  // session's ingest path. Reuses the shared authenticated client/base URL
  // state. Per §4.13 the operation does not initiate a new bootstrap, fails
  // closed with `not_connected` when disabled or unauthenticated or when the
  // in-flight bootstrap wait times out, and maps any HTTP non-2xx (incl.
  // network errors) to `ok:false` with the failure reason — no internal
  // retry loop. ok:true ⇔ the ingest API returned HTTP 2xx.
  async function postAgentNotification(
    sessionID: string,
    ingestPath: string,
    client: Client,
    item: { id: string; message: string },
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const response = await client.fetch(`${client.url}${ingestPath}?v=2`, {
        method: "POST",
        body: JSON.stringify({ data: [{ type: "agent_notification", data: item }] }),
      })
      if (response.ok) {
        log.info("agent notification sent", { sessionID, notificationId: item.id })
        return { ok: true }
      }
      const reason = `http_${response.status}`
      log.error("agent notification failed", { sessionID, notificationId: item.id, status: response.status })
      return { ok: false, reason }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log.error("agent notification failed", { sessionID, notificationId: item.id, error: reason })
      return { ok: false, reason }
    }
  }

  export async function remove(sessionId: string) {
    const client = await getClient()
    if (!client) return

    log.info("removing share", { sessionId })

    const share = await get(sessionId)
    if (!share) return

    const response = await client
      .fetch(`${client.url}/api/session/${encodeURIComponent(share.id)}`, {
        method: "DELETE",
      })
      .catch(() => undefined)

    if (!response) {
      log.error("share remove failed", { sessionId, error: "network" })
      return
    }

    if (!response.ok) {
      log.error("share remove failed", {
        sessionId,
        status: response.status,
        statusText: response.statusText,
      })
      return
    }

    const { AppRuntime } = await import("@/effect/app-runtime")
    await AppRuntime.runPromise(Storage.Service.use((svc) => svc.remove(["session_share", sessionId])))
  }

  async function fullSync(sessionId: string) {
    log.info("full sync", { sessionId })

    const { AppRuntime } = await import("@/effect/app-runtime")
    const [session, local] = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const storage = yield* Storage.Service
        return yield* Effect.all([
          sessions.get(SessionID.make(sessionId)),
          storage
            .read<Snapshot.FileDiff[]>(["session_diff", sessionId])
            .pipe(Effect.orElseSucceed((): Snapshot.FileDiff[] => [])),
        ])
      }),
    )
    const diffs = await cumulative(sessionId, local)
    const messages = await AppRuntime.runPromise(MessageV2.stream(SessionID.make(sessionId)))
    messages.reverse()
    const mdls = await models(
      messages.filter((m) => m.info.role === "user").map((m) => (m.info as SDK.UserMessage).model),
    )

    await ingest.sync(sessionId, [
      {
        type: "kilo_meta",
        data: await meta(sessionId),
      },
      {
        type: "session",
        data: transport(session),
      },
      ...messages.map((x) => ({
        type: "message" as const,
        data: x.info,
      })),
      ...messages.flatMap((x) => x.parts.map((y) => ({ type: "part" as const, data: y }))),
      {
        type: "session_diff",
        data: diffs,
      },
      {
        type: "model",
        data: mdls,
      },
      {
        type: "session_status",
        data: { status: await deriveStatus(sessionId) },
      },
    ])
  }

  /** Normalize a git remote URL: strip credentials, query params, and hash. Returns undefined for unrecognized formats. */
  function normalizeGitUrl(raw: string): string | undefined {
    const ssh = raw.match(/^git@([^:]+):(.+)$/)
    if (ssh) return `git@${ssh[1]}:${ssh[2].split("?")[0]}`
    try {
      const parsed = new URL(raw)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
      parsed.username = ""
      parsed.password = ""
      parsed.search = ""
      parsed.hash = ""
      return parsed.toString()
    } catch {
      return undefined
    }
  }

  async function getGitUrl(): Promise<string | undefined> {
    return withInFlightCache(gitUrlKeyPrefix + Instance.worktree, ttlMs, async () => {
      const repo = simpleGit(Instance.worktree)
      const remotes = await repo.getRemotes(true).catch(() => [])
      if (remotes.length === 0) return undefined

      const names = remotes.map((r) => r.name)
      const remote = names.includes("origin")
        ? "origin"
        : remotes.length === 1
          ? names[0]
          : names.includes("upstream")
            ? "upstream"
            : undefined

      if (!remote) return undefined

      const url = remotes.find((r) => r.name === remote)?.refs.fetch ?? ""
      return url ? normalizeGitUrl(url) : undefined
    })
  }

  async function branch() {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Vcs.Service.use((svc) => svc.branch()))
  }

  async function meta(sessionId?: string) {
    const override = sessionId ? KiloSession.resolvePlatform(sessionId) : undefined
    const platform = override || process.env["KILO_PLATFORM"] || "cli"
    const orgId = await getOrgId()
    const gitBranch = await branch().catch(() => undefined)
    const gitUrl = await getGitUrl().catch(() => undefined)

    return {
      platform,
      ...(orgId ? { orgId } : {}),
      ...(gitUrl ? { gitUrl } : {}),
      ...(gitBranch ? { gitBranch } : {}),
    }
  }

  async function getOrgId(): Promise<Uuid | undefined> {
    const env = process.env["KILO_ORG_ID"]
    if (isUuid(env)) return env

    return withInFlightCache(orgKey, ttlMs, async () => {
      const auth = await runtime.runPromise((svc) => svc.get("kilo"))
      if (auth?.type === "oauth" && isUuid(auth.accountId)) return auth.accountId
      return undefined
    })
  }

  function isUuid(value: string | undefined): value is Uuid {
    if (!value) return false
    return Uuid.safeParse(value).success
  }
}
