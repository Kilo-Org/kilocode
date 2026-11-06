export * as Remote from "./index"

import { KiloRemote, KiloSessionSync } from "@kilocode/kilo-plugin"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Instance } from "@opencode/core/instance/service"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Session } from "@opencode/core/session"
import { OPENCODE_VERSION } from "@opencode/cli/version"
import { Global } from "@opencode/util/global"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Effect, Layer, Schedule, Schema, Scope, Semaphore, Stream } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import { randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import { hostname } from "node:os"
import path from "node:path"
import { RemoteCommands } from "./command-executor"
import { SessionSync } from "../session-sync"
import { RemoteSocket, type RemoteEnvelope } from "./socket"

export type Options = { launchDirectory?: string; kind?: "cli" | "remote"; enabled?: boolean; background?: boolean }

// Both host roots and total owned sessions are bounded per server process.
const capacity = 100

type Claim = { directory: string; watched: () => boolean; release: () => void }

const decodeSessionCarrier = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ sessionID: Session.ID }),
    Schema.Struct({ form: Schema.Struct({ sessionID: Session.ID }) }),
  ]),
)

const makeRuntime = Effect.fn("Remote.makeRuntime")(function* (
  options: Options & { launchDirectory: string },
  ownership: Map<string, Claim>,
  detached: Set<string>,
  pending: Map<string, string>,
) {
  const sync = yield* KiloSessionSync.Service
  const bus = yield* Bus.Service
  const global = yield* Global.Service
  const native = yield* Session.Service
  const launchDirectory = options.launchDirectory
  const instanceID = randomUUID()
  const startedAt = Date.now()
  const sessions = new Map<string, RemoteSocket>()
  const owned = new Set<string>()
  const watched = new Set<string>()
  const states = new Map<string, string>()
  const stateQueue = new Map<string, Promise<void>>()
  let account: string | undefined
  let current: KiloSessionSync.LiveContext | undefined
  let presence: RemoteSocket | undefined
  let heartbeatAt = 0
  let advertised = ""
  let accepting = options.enabled ?? process.env.KILO_REMOTE === "1"
  let initialized = options.enabled !== undefined || process.env.KILO_REMOTE === "1"
  let closed = false
  const run = Effect.runPromiseWith(yield* Effect.context<never>())
  const clearPending = () => {
    for (const [sessionID, root] of pending) {
      if (root === launchDirectory) pending.delete(sessionID)
    }
  }
  const context = async () => {
    const selected = [...owned]
    for (const [sessionID, root] of pending) {
      if (root === launchDirectory && !owned.has(sessionID)) selected.push(sessionID)
    }
    const result = await run(sync.live(launchDirectory, selected).pipe(Effect.result))
    if (result._tag === "Success") return result.success
    if (
      [
        "forbidden",
        "http_403",
        "account_blocked",
        "organization_access_denied",
        "account_changed",
        "consent_conflict",
        "session_deleted",
        "session_not_found",
        "creator_mismatch",
        "source_conflict",
      ].includes(result.failure.code)
    )
      clearPending()
    throw new RemoteCommands.Failure(result.failure)
  }
  const release = (sessionID: string, transport = true) => {
    if (ownership.get(sessionID)?.directory === launchDirectory) ownership.delete(sessionID)
    if (pending.get(sessionID) === launchDirectory) pending.delete(sessionID)
    owned.delete(sessionID)
    if (transport) {
      watched.delete(sessionID)
      sessions.get(sessionID)?.stop()
      sessions.delete(sessionID)
      states.delete(sessionID)
    }
    heartbeatAt = 0
  }
  const commands = yield* RemoteCommands.make({
    launchDirectory,
    organizationID: () => current?.organizationID,
    userID: () => current?.userID,
    canCreate: () => ownership.size < capacity || [...ownership.values()].some((claim) => !claim.watched()),
    detach: (sessionID) =>
      Effect.sync(() => {
        if (detached.size === capacity) detached.delete(detached.values().next().value!)
        detached.add(sessionID)
        release(sessionID, false)
      }),
  })
  const own = Effect.fn("Remote.own")(function* (sessionID: string) {
    if (detached.has(sessionID)) return
    if (owned.has(sessionID)) {
      owned.delete(sessionID)
      owned.add(sessionID)
      const claim = ownership.get(sessionID)
      if (claim) {
        ownership.delete(sessionID)
        ownership.set(sessionID, claim)
      }
      return
    }
    const session = yield* native
      .get(Session.ID.make(sessionID))
      .pipe(
        Effect.mapError(
          () => new RemoteCommands.Failure({ code: "session_not_found", message: "Session is unavailable" }),
        ),
      )
    const directory = yield* Effect.tryPromise({
      try: () => realpath(session.location.directory),
      catch: () =>
        new RemoteCommands.Failure({ code: "directory_unavailable", message: "Session directory is unavailable" }),
    })
    if (closed)
      return yield* Effect.fail(
        new RemoteCommands.Failure({ code: "remote_unavailable", message: "Remote host is closed" }),
      )
    const relative = path.relative(launchDirectory, directory)
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
      return yield* Effect.fail(
        new RemoteCommands.Failure({
          code: "directory_escape",
          message: "Directory must be inside the launch directory",
        }),
      )
    const previous = ownership.get(sessionID)
    if (previous && previous.directory !== launchDirectory)
      return yield* Effect.fail(
        new RemoteCommands.Failure({
          code: "session_owned",
          message: "Session is already attached to another workspace host",
        }),
      )
    if (!previous && ownership.size === capacity) {
      const oldest = [...ownership.values()].find((claim) => !claim.watched())
      if (!oldest)
        return yield* Effect.fail(
          new RemoteCommands.Failure({ code: "remote_capacity", message: "Remote session capacity is full" }),
        )
      oldest.release()
    }
    owned.add(sessionID)
    ownership.set(sessionID, {
      directory: launchDirectory,
      watched: () => watched.has(sessionID),
      release: () => release(sessionID),
    })
    heartbeatAt = 0
  })
  const stop = () => {
    presence?.stop()
    presence = undefined
    for (const socket of sessions.values()) socket.stop()
    sessions.clear()
    watched.clear()
    states.clear()
    heartbeatAt = 0
  }
  const publish = async (sessionID: string, type: string, data: unknown) => {
    if (!watched.has(sessionID)) return
    const position = await run(sync.livePosition(sessionID))
    if (!position || !watched.has(sessionID)) return
    const identity = await run(commands.identity(sessionID))
    sessions.get(sessionID)?.send({
      channel: "events",
      type,
      body: { version: 1, syncPosition: position.position, sourceID: position.sourceID, ...identity, data },
    })
  }
  const emitState = async (sessionID: string, force: boolean) => {
    if (!watched.has(sessionID) || !sessions.get(sessionID)?.connected) return
    const snapshot = await run(commands.state(sessionID))
    const fingerprint = JSON.stringify(snapshot)
    if (!force && states.get(sessionID) === fingerprint) return
    const position = await run(sync.livePosition(sessionID))
    if (!position || !watched.has(sessionID)) return
    if (
      sessions.get(sessionID)?.send({
        channel: "events",
        type: "remote.state",
        body: { version: 1, syncPosition: position.position, sourceID: position.sourceID, ...snapshot },
      })
    )
      states.set(sessionID, fingerprint)
  }
  // Serialized per session so snapshots are emitted in read order. A failed snapshot
  // (for example a session deleted mid-read) is skipped rather than closing a socket.
  const publishState = (sessionID: string, force = false) => {
    const next = (stateQueue.get(sessionID) ?? Promise.resolve())
      .then(() => emitState(sessionID, force))
      .catch(() => {})
    stateQueue.set(sessionID, next)
    void next.then(() => {
      if (stateQueue.get(sessionID) === next) stateQueue.delete(sessionID)
    })
    return next
  }
  const sessionFrame = async (sessionID: string, frame: RemoteEnvelope) => {
    if (frame.channel === "control" && frame.type === "hello") {
      await publishState(sessionID, true)
      return
    }
    if (frame.channel !== "commands") return
    const body = frame.body as { commandID?: unknown; payload?: unknown; liveOnly?: unknown; expiresAt?: unknown }
    if (!body || typeof body.commandID !== "string") return
    if (!accepting) {
      if (body.liveOnly !== true) return
      await publish(sessionID, "command.outcome", {
        commandID: body.commandID,
        status: "failed",
        error: { code: "remote_disabled", message: "Remote control is disabled" },
      })
      sessions.get(sessionID)?.send({ type: "ack", commandID: body.commandID })
      return
    }
    const expiresAt = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await publish(sessionID, "command.outcome", {
        commandID: body.commandID,
        status: "failed",
        error: { code: "command_expired", message: "Remote command expired before admission" },
      })
      sessions.get(sessionID)?.send({ type: "ack", commandID: body.commandID })
      return
    }
    const outcome = await run(
      commands.session(sessionID, frame.type, body.payload, body.liveOnly === true, body.commandID),
    )
    sessions.get(sessionID)?.send({ type: "ack", commandID: body.commandID })
    await publish(sessionID, "command.outcome", outcome)
    if (detached.has(sessionID)) {
      watched.delete(sessionID)
      sessions.get(sessionID)?.stop()
      sessions.delete(sessionID)
      states.delete(sessionID)
      heartbeatAt = 0
    }
  }
  const presenceFrame = async (frame: RemoteEnvelope) => {
    if (frame.type === "watch" && frame.channel === "control") {
      const body = frame.body as { tenant?: { type?: unknown; id?: unknown }; sessionID?: unknown; watching?: unknown }
      if (
        !body ||
        typeof body.sessionID !== "string" ||
        !current ||
        body.tenant?.type !== current.tenant.type ||
        body.tenant.id !== current.tenant.id ||
        !owned.has(body.sessionID) ||
        detached.has(body.sessionID)
      )
        return
      if (body.watching === true) watched.add(body.sessionID)
      else watched.delete(body.sessionID)
      await reconcileSessions()
      if (body.watching === true) await publishState(body.sessionID, true)
      return
    }
    if (frame.channel !== "commands") return
    const body = frame.body as { commandID?: unknown; instanceID?: unknown; payload?: unknown }
    if (!body || typeof body.commandID !== "string" || body.instanceID !== instanceID) return
    const outcome = accepting
      ? await run(commands.instance(frame.type, body.payload, body.commandID))
      : {
          commandID: body.commandID,
          status: "failed",
          error: { code: "remote_disabled", message: "Remote control is disabled" },
        }
    presence?.send({ type: "reply", commandID: body.commandID, body: outcome })
    heartbeatAt = 0
  }
  const reconcileSessions = async () => {
    const eligible = new Set(
      current?.sessions
        .filter(
          (session) =>
            owned.has(session.sessionID) &&
            !detached.has(session.sessionID) &&
            (accepting || watched.has(session.sessionID)),
        )
        .map((session) => session.sessionID),
    )
    for (const [id, socket] of sessions) {
      if (eligible.has(id)) continue
      socket.stop()
      sessions.delete(id)
      states.delete(id)
    }
    for (const sessionID of eligible) {
      if (sessions.has(sessionID) || !current) continue
      const url = new URL(`/v1/sessions/${encodeURIComponent(sessionID)}/live`, current.destination)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      const socket = new RemoteSocket({
        url: url.href,
        ticket: () => run(sync.liveTicket(sessionID)),
        onFrame: (frame) => sessionFrame(sessionID, frame),
        terminalReplacement: true,
      })
      sessions.set(sessionID, socket)
      socket.start()
    }
  }
  const reconcileLock = yield* Semaphore.make(1)
  const poll = (sessionID?: string) =>
    Effect.tryPromise({
      try: async () => {
        if (closed) {
          if (sessionID)
            throw new RemoteCommands.Failure({ code: "remote_unavailable", message: "Remote host is closed" })
          return
        }
        if (!initialized) {
          for (const name of KiloConfigFiles.names) {
            const file = Bun.file(path.join(global.config, name))
            if (!(await file.exists())) continue
            const errors: ParseError[] = []
            const value = parse(await file.text(), errors, { allowTrailingComma: true, allowEmptyContent: true })
            if (errors.length || (value?.remote_control !== undefined && typeof value.remote_control !== "boolean"))
              throw new Error("Cannot read remote_control configuration")
            if (value?.remote_control !== undefined) accepting = value.remote_control
          }
          initialized = true
        }
        const next = await context()
        if (closed) {
          if (sessionID)
            throw new RemoteCommands.Failure({ code: "remote_unavailable", message: "Remote host is closed" })
          return
        }
        if (next?.identity !== current?.identity) stop()
        // Credentials rotate independently of the verified account/tenant that owns sessions.
        const owner = next && JSON.stringify([next.userID, next.tenant.type, next.tenant.id, next.organizationID])
        if (owner && account !== undefined && owner !== account) {
          for (const id of owned) release(id)
          detached.clear()
          clearPending()
          if (sessionID) pending.set(sessionID, launchDirectory)
        }
        if (owner) account = owner
        current = next
        if (!current) {
          stop()
          if (sessionID)
            throw new RemoteCommands.Failure({
              code: "remote_unavailable",
              message: "Session synchronization is unavailable",
            })
          return
        }
        // Retry only local ownership admission, never a queued command or other mutation.
        // Candidates stay pending until identity readiness succeeds or admission is terminal.
        for (const [candidate, root] of pending) {
          if (root !== launchDirectory) continue
          if (detached.has(candidate)) {
            pending.delete(candidate)
            continue
          }
          const admitted = await run(own(candidate).pipe(Effect.result))
          if (admitted._tag === "Success") pending.delete(candidate)
          else {
            if (["session_not_found", "directory_escape", "session_owned"].includes(admitted.failure.code))
              pending.delete(candidate)
            if (candidate === sessionID) throw admitted.failure
          }
        }
        if (!presence) {
          const url = new URL("/v1/presence", current.destination)
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
          presence = new RemoteSocket({
            url: url.href,
            ticket: () => run(sync.liveTicket()),
            onFrame: presenceFrame,
            onState: (connected) => {
              if (connected) heartbeatAt = 0
            },
          })
          presence.start()
        }
        await reconcileSessions()
        const liveSessions = current.sessions
          .filter((session) => owned.has(session.sessionID) && !detached.has(session.sessionID))
          .slice(0, capacity)
          .map((session) => session.sessionID)
        const membership = liveSessions.join("\0")
        if (membership !== advertised) heartbeatAt = 0
        if (Date.now() - heartbeatAt < 30_000) return
        if (
          presence.send({
            type: "heartbeat",
            instanceID,
            advertisement: {
              name: hostname(),
              projectName: path.basename(launchDirectory),
              version: OPENCODE_VERSION,
              kind: options.kind ?? (process.env.KILO_REMOTE_KIND === "remote" ? "remote" : "cli"),
              startedAt,
              gitBranch: null,
              capabilities: ["native-live-v1", ...(accepting ? ["remote-control-v1"] : [])],
              sessions: liveSessions,
            },
          })
        ) {
          advertised = membership
          heartbeatAt = Date.now()
        }
      },
      catch: (cause) =>
        cause instanceof RemoteCommands.Failure
          ? cause
          : new RemoteCommands.Failure({ code: "remote_unavailable", message: "Remote connection is unavailable" }),
    })
  const tick = reconcileLock.withPermit(poll()).pipe(Effect.catch(() => Effect.sync(stop)))
  yield* bus.subscribe().pipe(
    Stream.runForEach((event) =>
      Effect.tryPromise(async () => {
        const data = event.data as Record<string, unknown>
        const form = data.form as { sessionID?: unknown } | undefined
        const sessionID = typeof data.sessionID === "string" ? data.sessionID : form?.sessionID
        if (typeof sessionID !== "string") return
        if (event.type === "session.deleted") {
          detached.delete(sessionID)
          release(sessionID)
          return
        }
        if (detached.has(sessionID) || !owned.has(sessionID) || !watched.has(sessionID)) return
        await publish(sessionID, event.type, event)
        if (
          event.type.startsWith("session.execution.") ||
          event.type.startsWith("permission.") ||
          event.type.startsWith("form.")
        )
          await publishState(sessionID)
      }).pipe(Effect.catch(() => Effect.void)),
    ),
    Effect.forkScoped,
  )
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true
      for (const sessionID of owned) release(sessionID)
      clearPending()
      stop()
    }),
  )
  if (options.background !== false) yield* tick.pipe(Effect.repeat(Schedule.spaced(1000)), Effect.forkScoped)
  const status = () => Effect.sync(() => ({ enabled: accepting, connected: presence?.connected ?? false }))
  return {
    status,
    attach: (sessionID: string) =>
      reconcileLock.withPermit(
        Effect.gen(function* () {
          if (detached.has(sessionID)) return yield* status()
          const root = pending.get(sessionID)
          if (root && root !== launchDirectory)
            return yield* Effect.fail(
              new RemoteCommands.Failure({
                code: "session_owned",
                message: "Session is pending in another workspace host",
              }),
            )
          if (!root && pending.size === capacity)
            return yield* Effect.fail(
              new RemoteCommands.Failure({ code: "remote_capacity", message: "Remote attachment capacity is full" }),
            )
          pending.set(sessionID, launchDirectory)
          yield* poll(sessionID)
          return yield* status()
        }),
      ),
    enable: () =>
      Effect.gen(function* () {
        if (accepting) return yield* status()
        accepting = true
        initialized = true
        // Reattach unacknowledged mailbox items that arrived while control was disabled.
        for (const socket of sessions.values()) socket.stop()
        sessions.clear()
        heartbeatAt = 0
        yield* tick
        return yield* status()
      }),
    disable: () =>
      Effect.gen(function* () {
        if (!accepting) return yield* status()
        accepting = false
        initialized = true
        heartbeatAt = 0
        yield* tick
        return yield* status()
      }),
  } satisfies KiloRemote.Runtime
})

// The managed server deliberately runs from $HOME and can serve several TUI workspaces.
// Roots come from authenticated RPC locations or authoritative local session metadata, never daemon cwd.
export const make = Effect.fn("Remote.make")(function* (options: Options = {}) {
  const scope = yield* Effect.scope
  const bus = yield* Bus.Service
  const native = yield* Session.Service
  const services = yield* Effect.context<
    | KiloSessionSync.Service
    | Bus.Service
    | Database.Service
    | Session.Service
    | Instance.Service
    | LocationServiceMap.Service
    | Global.Service
  >()
  const lock = yield* Semaphore.make(1)
  const ownership = new Map<string, Claim>()
  const detached = new Set<string>()
  const pending = new Map<string, string>()
  const runtimes = new Map<string, KiloRemote.Runtime>()
  const open = (directory: string, continuation = false) =>
    lock.withPermit(
      Effect.gen(function* () {
        const root = yield* Effect.tryPromise({
          try: () => realpath(path.resolve(options.launchDirectory ?? directory)),
          catch: () =>
            new RemoteCommands.Failure({ code: "directory_unavailable", message: "Launch directory is unavailable" }),
        })
        const existing = runtimes.get(root)
        if (existing) return existing
        if (continuation) {
          let match: { root: string; host: KiloRemote.Runtime } | undefined
          for (const [candidate, host] of runtimes) {
            const relative = path.relative(candidate, root)
            if (
              !path.isAbsolute(relative) &&
              relative !== ".." &&
              !relative.startsWith(`..${path.sep}`) &&
              (!match || candidate.length > match.root.length)
            )
              match = { root: candidate, host }
          }
          if (match) return match.host
        }
        if (runtimes.size === capacity)
          return yield* Effect.fail(
            new RemoteCommands.Failure({ code: "remote_capacity", message: "Remote workspace host capacity is full" }),
          )
        const runtime = yield* makeRuntime({ ...options, launchDirectory: root }, ownership, detached, pending).pipe(
          Effect.provide(services),
          Effect.provideService(Scope.Scope, scope),
        )
        runtimes.set(root, runtime)
        return runtime
      }).pipe(Effect.uninterruptible),
    )
  const service = KiloRemote.Service.of({ forDirectory: open })
  // Non-TUI callers still become live on their first local session event. A restored
  // TUI explicitly attaches through RPC instead, without waiting for such an event.
  yield* bus.subscribe().pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        if (event.type === "session.deleted") return
        const carrier = decodeSessionCarrier(event.data)
        if (carrier._tag === "None") return
        const sessionID = "sessionID" in carrier.value ? carrier.value.sessionID : carrier.value.form.sessionID
        if (detached.has(sessionID) || pending.has(sessionID)) return
        const claim = ownership.get(sessionID)
        if (claim) {
          ownership.delete(sessionID)
          ownership.set(sessionID, claim)
          return
        }
        const session = yield* native.get(sessionID)
        const directory = yield* Effect.tryPromise(() => realpath(session.location.directory))
        const host = yield* open(directory, true)
        yield* host.attach(sessionID)
      }).pipe(Effect.catch(() => Effect.void)),
    ),
    Effect.forkScoped,
  )
  return service
})

export const configured = (options: Options = {}) =>
  makeGlobalNode({
    service: KiloRemote.Service,
    layer: Layer.effect(KiloRemote.Service, make(options).pipe(Effect.orDie)),
    deps: [
      Bus.node,
      Database.node,
      Session.node,
      Instance.node,
      LocationServiceMap.node,
      Global.node,
      SessionSync.node,
    ],
  })

export const node = configured()
