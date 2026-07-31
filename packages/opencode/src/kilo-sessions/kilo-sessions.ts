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
import { IngestDrain } from "@/kilo-sessions/ingest-drain"
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
import { RemoteWS } from "@/kilo-sessions/remote-ws"
import { RemoteSender } from "@/kilo-sessions/remote-sender"
import { RemoteProtocol } from "@/kilo-sessions/remote-protocol"
import { buildInstanceAdvertisement } from "@/kilo-sessions/instance-advertisement"
import { AttachedState } from "@/kilo-sessions/attached-state"
import {
  clear as clearRenameMarks,
  consumeAutoTitle,
  consumeRenameAdoption,
  markAutoTitle,
  markRenameAdopted,
} from "@/kilo-sessions/rename-adoptions"
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
    readonly reportSessionTitle: (
      sessionID: string,
      title: string,
      opts: { generated: boolean },
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

  /**
   * Classify an `http_<status>` reason as a permanent (non-retryable) failure.
   * 4xx client errors are permanent except 408 (Request Timeout) and 429
   * (Too Many Requests), which are transient and should be retried.
   */
  function isPermanentHttpStatus(reason: string): boolean {
    const match = reason.match(/^http_(\d+)$/)
    if (!match) return false
    const status = parseInt(match[1], 10)
    return status >= 400 && status < 500 && status !== 408 && status !== 429
  }

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

  // Process-level once-guard: overlapping shutdown paths must not double-POST.
  // Do not call from per-directory instance finalizers — wrong granularity.
  // Never-reject: serve/worker await this unguarded before dispose/stop.
  const drainIngest = IngestDrain.create(
    () => ingest.drain(),
    (err) => log.warn("ingest drain failed", { err }),
  )

  export async function drainIngestForShutdown() {
    await drainIngest()
  }

  const remoteEnabled = process.env["KILO_REMOTE"] === "1"
  let remote: { conn: RemoteWS.Connection; sender: RemoteSender.Sender } | undefined
  let enabling: Promise<void> | undefined
  let remoteSeq = 0
  // kilocode_change - K1 W1: module-level instance advertisement flag.
  // `enableRemote` can be triggered either by the explicit `kilo remote` command
  // or by bootstrap auto-enable (`KILO_REMOTE=1` / `remote_control` config); it
  // is idempotent/coalescing, so passing an {instance} arg on one specific call
  // would race with whichever call happens first. A module-level flag flipped
  // by either caller is the only race-free way to advertise the instance.
  let instanceAdvertisement: RemoteProtocol.InstanceAdvertisement | undefined
  // Separate presence-owned attached session ids from newly-created (pending)
  // session announcements so a concurrent presence update cannot drop a pending
  // id and a heartbeat failure cannot delete a presence-owned id. The heartbeat
  // closure throws when no remote connection is available so `announce` cannot
  // silently mark a session as attached; create_session's catch block turns that
  // into the sanitized failure response and the user retries manually.
  const attachedState = AttachedState.create({
    heartbeat: (opts) =>
      remote ? remote.conn.heartbeat(opts) : Promise.reject(new Error("attachRemoteSession: no remote connection")),
    log: attachedLog,
  })
  const statusSyncs = new Map<string, { running: boolean; dirty: boolean }>()
  const STATUS_TIMEOUT_MS = 3_000

  // Shared attention/status resolution for ingest sync and the remote heartbeat.
  // Precedence: permission > question > SessionStatus (offline maps to retry).
  type DerivedSessionStatus = "idle" | "busy" | "question" | "permission" | "retry"

  function resolveDerivedSessionStatus(input: {
    hasPermission: boolean
    hasQuestion: boolean
    statusType: SessionStatus.Info["type"] | undefined
  }): DerivedSessionStatus {
    if (input.hasPermission) return "permission"
    if (input.hasQuestion) return "question"
    if (input.statusType === "offline") return "retry"
    if (input.statusType === "busy" || input.statusType === "retry" || input.statusType === "idle") {
      return input.statusType
    }
    return "idle"
  }

  async function deriveStatus(sessionID: string): Promise<DerivedSessionStatus> {
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
    return resolveDerivedSessionStatus({
      hasPermission: false,
      hasQuestion: false,
      statusType: status.type,
    })
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

      const reportSessionTitle = Effect.fn("KiloSessions.reportSessionTitle")(function* (
        sessionID: string,
        title: string,
        opts: { generated: boolean },
      ) {
        return yield* Effect.promise(() => reportTitleChange(sessionID, title, opts.generated))
      })

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

          // Last-known title per session so we only POST on actual title changes.
          // Seed on Created and from existing rows at bootstrap so the first real
          // rename (rename-before-prompt, or first rename after process restart)
          // is not treated as a seed-only sighting and dropped (Decision 8).
          const knownTitles = new Map<string, string>()
          yield* sessions.list().pipe(
            Effect.map((list) => {
              for (const s of list) knownTitles.set(s.id, s.title)
            }),
            Effect.orElseSucceed(() => undefined),
          )
          watch(Session.Event.Created, (evt) => {
            const info = evt.properties.info
            const sessionID = info.id
            if (typeof info.title === "string") knownTitles.set(sessionID, info.title)
            return create(sessionID).catch((error) => log.error("share init create failed", { sessionID, error }))
          })
          watch(Session.Event.Updated, async (evt) => {
            const sessionID = evt.properties.sessionID
            const session = await Effect.runPromise(sessions.get(sessionID).pipe(Effect.orElseSucceed(() => null)))
            if (!session) return
            // Consume marks before the network hop so the 60s TTL does not span
            // token resolution + ingest.sync. Advance knownTitles optimistically
            // so a concurrent Updated sees sameTitle (no duplicate POST with a
            // wrong generated flag). On ingest or title-POST failure restore
            // prev + consumed marks so the next Updated re-derives and retries.
            const prev = knownTitles.get(sessionID)
            const sameTitle = prev === session.title
            // Same-title Updated (setTitle no-op / double session.renamed): still
            // consume a matching rename adoption after sync so the mark cannot
            // stick and swallow a later real local rename (Decision 8).
            const outcome = (():
              | { kind: "same" }
              | { kind: "adopted" }
              | { kind: "report"; generated: boolean } => {
              if (sameTitle) return { kind: "same" }
              // Consume marks before the network hop so the 60s TTL does not span
              // token resolution + ingest.sync. Checks run even when prev is
              // unknown — an unseeded mark must not leak past this handler.
              if (consumeRenameAdoption(sessionID, session.title)) return { kind: "adopted" }
              return { kind: "report", generated: consumeAutoTitle(sessionID, session.title) }
            })()
            const restoreTitleState = () => {
              // Only restore if this handler still owns the knownTitles slot.
              // A concurrent handler may have advanced it to a newer title; in
              // that case do not clobber it with this handler's stale prev.
              if (knownTitles.get(sessionID) === session.title) {
                if (prev === undefined) knownTitles.delete(sessionID)
                else knownTitles.set(sessionID, prev)
              }
              if (outcome.kind === "adopted") markRenameAdopted(sessionID, session.title)
              else if (outcome.kind === "report" && outcome.generated) markAutoTitle(sessionID, session.title)
            }
            knownTitles.set(sessionID, session.title)
            try {
              await ingest.sync(sessionID, [
                { type: "kilo_meta", data: await meta(sessionID, session) },
                { type: "session", data: transport(session) },
              ])
            } catch (error) {
              restoreTitleState()
              log.error("session updated ingest failed", { sessionID, error })
              return
            }
            if (outcome.kind === "same") consumeRenameAdoption(sessionID, session.title)
            if (outcome.kind !== "report") return
            // Production path goes through the Interface method (not private helper).
            const { AppRuntime } = await import("@/effect/app-runtime")
            const reported = await AppRuntime.runPromise(
              reportSessionTitle(sessionID, session.title, { generated: outcome.generated }),
            )
            if (!reported.ok) {
              // Permanent failures (non-retryable 4xx client errors) mean the
              // server rejected this title definitively; keep the new title so
              // the next same-title Updated is a no-op instead of retrying
              // forever. Transient failures (5xx, 408, 429, network errors,
              // not_connected) still restore + retry.
              const isPermanent = isPermanentHttpStatus(reported.reason)
              if (isPermanent) {
                log.warn("session title report permanent failure; title preserved", {
                  sessionID,
                  reason: reported.reason,
                })
              } else {
                restoreTitleState()
                log.warn("session title report failed; will retry on next Updated", {
                  sessionID,
                  reason: reported.reason,
                })
              }
            }
          })
          watch(Session.Event.Deleted, (evt) => {
            const sessionID = evt.properties.sessionID
            knownTitles.delete(sessionID)
            clearRenameMarks(sessionID)
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
          catch: () => ({ ok: false, reason: "not_connected" }) as const,
        }).pipe(Effect.catch((value) => Effect.succeed(value)))

        if (!readiness.ok) return readiness
        return yield* Effect.promise(() =>
          postAgentNotification(sessionID, readiness.ingestPath, readiness.client, input),
        )
      })

      return Service.of({ init, sendAgentNotification, reportSessionTitle })
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
    reportSessionTitle: () => Effect.succeed({ ok: false, reason: "not_connected" } as const),
  })

  export const node = LayerNode.suspend(() => LayerNode.make(layer, [Bus.node, Config.node, Session.node]))

  // kilocode_change - DEF-1: default advertisement for every successful
  // enableRemote() entry (covers `/remote` after auto-enable already connected).
  // No-op when an advertisement is already set — must not re-set or fire an
  // extra heartbeat. Explicit setInstanceAdvertisement keeps replace semantics.
  function ensureDefaultInstanceAdvertisement() {
    if (instanceAdvertisement) return
    setInstanceAdvertisement(buildInstanceAdvertisement(Instance.directory))
  }

  export async function enableRemote() {
    // ingestDisabled must not advertise. Every other successful entry — including
    // already-connected and coalescing early returns — must ensure advertisement
    // before returning, otherwise `/remote` after auto-enable never registers.
    if (ingestDisabled) return
    ensureDefaultInstanceAdvertisement()
    if (remote) return
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
      // kilocode_change - K1 W1: capture module-level advertisement so each
      // heartbeat's `instance` field stays consistent with the flag at the
      // moment of sending. The flag may be set after this closure is created
      // (race-proof) — `getSessions` reads the current value each tick.
      const getSessions = async (): Promise<RemoteProtocol.Heartbeat> => {
        const [gitUrl, gitBranch] = await Promise.all([
          getGitUrl().catch(() => undefined),
          branch().catch(() => undefined),
        ])
        const { AppRuntime } = await import("@/effect/app-runtime")
        // Batch SessionStatus + attention lists once per heartbeat (not per session).
        // Permission/Question list() feeds the same precedence as deriveStatus().
        const [statusMap, permissions, questions] = await Promise.all([
          AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.list())),
          AppRuntime.runPromise(Permission.Service.use((svc) => svc.list())),
          AppRuntime.runPromise(Question.Service.use((svc) => svc.list())),
        ])
        const statuses: Record<string, SessionStatus.Info> = Object.fromEntries(statusMap)
        const permissionSessions = new Set(permissions.map((p) => p.sessionID as string))
        const questionSessions = new Set(questions.map((q) => q.sessionID as string))
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
                    status: resolveDerivedSessionStatus({
                      hasPermission: permissionSessions.has(id),
                      hasQuestion: questionSessions.has(id),
                      statusType: statuses[id]?.type,
                    }),
                    title: session.title,
                    parentSessionId: session.parentID,
                    gitUrl,
                    gitBranch,
                    // kilocode_change - K1 W1: per-session platform, mirrors
                    // meta()'s resolution order so the live value always agrees
                    // with the session's stored created_on_platform.
                    platform: KiloSession.resolvePlatform(id) || process.env["KILO_PLATFORM"] || "cli",
                  })),
                  Effect.orElseSucceed(() => undefined),
                ),
              ),
            ),
          ),
        )
        const sessions = results.filter((r): r is NonNullable<typeof r> => !!r)
        const instance = instanceAdvertisement
        return { type: "heartbeat", sessions, ...(instance ? { instance } : {}) }
      }

      const conn = RemoteWS.connect({
        url,
        getToken: kilocodeToken,
        withContext: (fn) => provide({ directory, fn }),
        getSessions,
        log,
        onOpen: () => {
          void Bus.publish(Instance.current, Event.RemoteStatusChanged, { enabled: true, connected: true })
          // kilocode_change - K1 W1: on reconnect, a headless `kilo remote` host
          // preserves its module-level advertisement flag but would otherwise not
          // be re-advertised until the next periodic heartbeat (up to ~10s).
          // Fire one immediate out-of-band heartbeat when the flag is set.
          // This is intentionally conditional: tests that do not set the flag
          // must not see extra heartbeats.
          if (instanceAdvertisement) {
            void conn.heartbeat().catch((err) =>
              log.warn("reconnect advertisement heartbeat failed", {
                error: String(err),
              }),
            )
          }
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
        // kilocode_change - K1 W1: in-process attach/detach/ownership seams
        // back to KiloSessions. The sender does NOT spawn a process per
        // session — concurrent remote sessions share this CLI process with
        // per-directory InstanceRef isolation.
        attachSession: (id) => KiloSessions.attachRemoteSession(id),
        detachSession: (id) => KiloSessions.detachRemoteSession(id),
        hasSession: (id) => KiloSessions.hasRemoteSession(id),
        ownedCount: () => KiloSessions.ownedRemoteSessionCount(),
        cancelPrompt: async (id) => {
          // kilocode_change - K1 W1: dynamic import breaks the module-load cycle
          // (@/session/prompt reads KiloSessionPrompt at eval; a static edge here
          // races that init). Mirrors remote-command.ts's lazy SessionPrompt use.
          const [{ AppRuntime }, { SessionPrompt }] = await Promise.all([
            import("@/effect/app-runtime"),
            import("@/session/prompt"),
          ])
          await AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.cancel(id)))
        },
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

  // kilocode_change - K1 W1: instance advertisement setter.
  // Idempotent. If a remote connection is already established when the flag is
  // flipped (typical for the race between bootstrap auto-enable and the
  // explicit `kilo remote` command — `enableRemote` itself is coalescing), we
  // fire one out-of-band heartbeat so the cloud side learns about the
  // instance without waiting for the next 10s timer tick.
  export function setInstanceAdvertisement(advertisement: RemoteProtocol.InstanceAdvertisement) {
    instanceAdvertisement = advertisement
    if (remote) {
      void remote.conn.heartbeat().catch((err) =>
        log.warn("instance advertisement heartbeat failed", {
          error: String(err),
        }),
      )
    }
  }

  // Test-only: the advertisement flag is intentionally one-way in production
  // (once a process runs `kilo remote`, it keeps advertising for its whole
  // lifetime, including across a transient disableRemote/enableRemote
  // reconnect cycle — disableRemote() deliberately does not clear it). Tests
  // that assert the "unset" default must reset the module-level flag
  // themselves between cases.
  export function resetInstanceAdvertisementForTests() {
    instanceAdvertisement = undefined
  }

  // Duplicate-safe single-session attach used by the remote create_session command. Delegates to
  // the two-set state so the announcement is preserved across a concurrent presence replacement
  // and a heartbeat failure rolls back only the entry this call added (a presence-owned id is never
  // reachable here because the factory guards it).
  export async function attachRemoteSession(id: string) {
    await attachedState.announce(id)
  }

  // kilocode_change - K1 W1: session-detach semantics. The exit_cli handler
  // calls this after a verified owns-check + cancel-prompt; the heartbeat
  // must confirm the id was removed from the next sent payload (negative-
  // containment fence) before the handler ACKs the request.
  //
  // The SessionStatus entry is cleared to idle (which deletes the map entry)
  // before the heartbeat fence runs, so the next getSessions() payload — and
  // therefore the fence itself — deterministically omits the id regardless of
  // whether the session was busy/retry/offline. On heartbeat-failure rollback,
  // attachedState.detach restores the id to presence/pending; the session is
  // still advertised (via the union) with an idle status until normal activity
  // re-establishes a status, so the relay does not under-report an owned session.
  export async function detachRemoteSession(id: string) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.set(SessionID.make(id), { type: "idle" })))
    await attachedState.detach(id)
  }

  // kilocode_change - K1 W1: ownership probe used by the exit_cli handler
  // before the cancel/detach sequence. Cheap and synchronous.
  export function hasRemoteSession(id: string): boolean {
    return attachedState.has(id)
  }

  // kilocode_change - K1 W1: count of "owned" sessions (presence ∪ pending).
  // Used to drive the last-interactive-session exit decision: zero remaining
  // + a registered RemoteExit callback => invoke it after the ACK can flush;
  // zero remaining + no callback (kilo remote) => keep host alive. Sessions
  // remain => stay alive regardless of callback state.
  export function ownedRemoteSessionCount(): number {
    return attachedState.union().size
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
  function trackBootstrap(sessionId: string, start: () => Promise<{ id: string; ingestPath: string } | undefined>) {
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

  async function reportTitleChange(
    sessionID: string,
    title: string,
    generated: boolean,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (ingestDisabled) {
      return { ok: false, reason: "not_connected" }
    }
    const readiness = await withTimeout(
      resolveReadiness(sessionID),
      agentNotificationTimeoutMs(),
      "session title readiness timed out",
    ).catch(() => ({ ok: false, reason: "not_connected" }) as const)
    if (!readiness.ok) {
      log.warn("report session title skipped", { sessionID, reason: readiness.reason })
      return readiness
    }
    return postSessionTitle(sessionID, readiness.client, title, generated)
  }

  async function postSessionTitle(
    sessionID: string,
    client: Client,
    title: string,
    generated: boolean,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const response = await client.fetch(`${client.url}/api/session/${encodeURIComponent(sessionID)}/title`, {
        method: "POST",
        body: JSON.stringify({ title, generated }),
      })
      if (response.ok) {
        log.info("session title reported", { sessionID, generated })
        return { ok: true }
      }
      const reason = `http_${response.status}`
      log.error("session title report failed", { sessionID, status: response.status })
      return { ok: false, reason }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log.error("session title report failed", { sessionID, error: reason })
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
        data: await meta(sessionId, session),
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

  async function meta(sessionId?: string, info?: Session.Info | null) {
    const override = sessionId ? KiloSession.resolvePlatform(sessionId) : undefined
    const platform = override || process.env["KILO_PLATFORM"] || "cli"
    const orgId = await getOrgId(sessionId, info)
    const gitBranch = await branch().catch(() => undefined)
    const gitUrl = await getGitUrl().catch(() => undefined)

    return {
      platform,
      ...(orgId ? { orgId } : {}),
      ...(gitUrl ? { gitUrl } : {}),
      ...(gitBranch ? { gitBranch } : {}),
    }
  }

  /** Test seam: meta() without preloaded info (Session.get failure → env/auth fallback). */
  export async function _metaForTests(sessionId?: string, info?: Session.Info | null) {
    return meta(sessionId, info)
  }

  async function getOrgId(sessionId?: string, info?: Session.Info | null): Promise<Uuid | undefined> {
    // Per-session org from metadata (remote create_session) wins over process-global env/auth.
    const fromMeta = await resolveSessionOrg(sessionId, info)
    if (fromMeta) return fromMeta

    const env = process.env["KILO_ORG_ID"]
    if (isUuid(env)) return env

    return withInFlightCache(orgKey, ttlMs, async () => {
      const auth = await runtime.runPromise((svc) => svc.get("kilo"))
      if (auth?.type === "oauth" && isUuid(auth.accountId)) return auth.accountId
      return undefined
    })
  }

  async function resolveSessionOrg(sessionId?: string, info?: Session.Info | null): Promise<Uuid | undefined> {
    if (!sessionId) return undefined
    const resolved =
      info !== undefined
        ? info
        : await (async () => {
            const { AppRuntime } = await import("@/effect/app-runtime")
            return AppRuntime.runPromise(Session.Service.use((svc) => svc.get(SessionID.make(sessionId)))).catch(
              () => null,
            )
          })()
    if (!resolved) return undefined
    const raw = resolved.metadata?.orgId
    return typeof raw === "string" && isUuid(raw) ? raw : undefined
  }

  function isUuid(value: string | undefined): value is Uuid {
    if (!value) return false
    return Uuid.safeParse(value).success
  }
}
