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
import { Effect, Layer, Schedule, Stream } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import { randomUUID } from "node:crypto"
import { hostname } from "node:os"
import path from "node:path"
import { RemoteCommands } from "./commands"
import { SessionSync } from "../session-sync"
import { RemoteSocket, type RemoteEnvelope } from "./socket"

export type Options = { launchDirectory?: string; kind?: "cli" | "remote"; enabled?: boolean; background?: boolean }

export const make = Effect.fn("Remote.make")(function* (options: Options = {}) {
  const sync = yield* KiloSessionSync.Service
  const bus = yield* Bus.Service
  const global = yield* Global.Service
  const launchDirectory = path.resolve(options.launchDirectory ?? process.cwd())
  const instanceID = randomUUID()
  const startedAt = Date.now()
  const sessions = new Map<string, RemoteSocket>()
  const owned = new Set<string>()
  const watched = new Set<string>()
  const detached = new Set<string>()
  let current: KiloSessionSync.LiveContext | undefined
  let presence: RemoteSocket | undefined
  let heartbeatAt = 0
  let advertised = ""
  let accepting = options.enabled ?? process.env.KILO_REMOTE === "1"
  let initialized = options.enabled !== undefined || process.env.KILO_REMOTE === "1"
  let closed = false
  const run = Effect.runPromiseWith(yield* Effect.context<never>())
  const context = () => run(sync.live(launchDirectory))
  const commands = yield* RemoteCommands.make({
    launchDirectory,
    organizationID: () => current?.organizationID,
    userID: () => current?.userID,
    detach: (sessionID) =>
      Effect.sync(() => {
        detached.add(sessionID)
        watched.delete(sessionID)
        sessions.get(sessionID)?.stop()
        sessions.delete(sessionID)
        heartbeatAt = 0
      }),
  })
  const stop = () => {
    presence?.stop()
    presence = undefined
    for (const socket of sessions.values()) socket.stop()
    sessions.clear()
    watched.clear()
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
  const sessionFrame = async (sessionID: string, frame: RemoteEnvelope) => {
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
  const tick = Effect.tryPromise({
    try: async () => {
      if (closed) return
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
      if (closed) return
      if (next?.identity !== current?.identity) stop()
      current = next
      if (!current) {
        stop()
        return
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
        .slice(0, 128)
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
    catch: () => new Error("Remote connection is unavailable"),
  }).pipe(Effect.catch(() => Effect.sync(stop)))
  yield* bus.subscribe().pipe(
    Stream.runForEach((event) =>
      Effect.tryPromise(async () => {
        const data = event.data as Record<string, unknown>
        const form = data.form as { sessionID?: unknown } | undefined
        const sessionID = typeof data.sessionID === "string" ? data.sessionID : form?.sessionID
        if (typeof sessionID !== "string") return
        owned.add(sessionID)
        if (!watched.has(sessionID)) return
        await publish(sessionID, event.type, event)
      }).pipe(Effect.catch(() => Effect.void)),
    ),
    Effect.forkScoped,
  )
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true
      stop()
    }),
  )
  if (options.background !== false) yield* tick.pipe(Effect.repeat(Schedule.spaced(1000)), Effect.forkScoped)
  const status = () => Effect.sync(() => ({ enabled: accepting, connected: presence?.connected ?? false }))
  return KiloRemote.Service.of({
    status,
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
  })
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
