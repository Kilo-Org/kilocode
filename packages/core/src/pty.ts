export * as Pty from "./pty"

import { makeGlobalNode } from "./effect/app-node" // kilocode_change
import type { Disp, Proc } from "#pty"
import { Context, Effect, Layer, Option, Schema, Types } from "effect" // kilocode_change
import { Pty } from "@opencode-ai/schema/pty"
import { Config } from "./config"
import { EventV2 } from "./event"
import { Location } from "./location"
import { PtyID } from "./pty/schema"
import { SessionSchema } from "./session/schema" // kilocode_change
import { Shell } from "./shell"
import { lazy } from "./util/lazy"
import { KiloPtySelfCommand } from "./kilocode/pty-self-command" // kilocode_change
import { KiloPtyTermination } from "./kilocode/pty/termination" // kilocode_change

const BUFFER_LIMIT = 1024 * 1024 * 2
// Exited sessions stay observable (status, exit code, retained output) until removed explicitly.
// Cap retention so abandoned terminals do not accumulate unbounded buffers.
const EXITED_LIMIT = 25
const pty = lazy(() => import("#pty"))

type Subscriber = {
  readonly onData: (chunk: string) => void
  readonly onEnd: (event: { exitCode?: number }) => void
  active: boolean
  detached: boolean
  pending: string[]
  end?: { exitCode?: number }
}

type Active = {
  info: Info
  directory: string // kilocode_change
  process: Proc
  buffer: string
  bufferCursor: number
  cursor: number
  subscribers: Map<object, Subscriber>
  listeners: Disp[]
  stopping: boolean // kilocode_change
}

// kilocode_change - the Kilo `sessionID` field now lives on the canonical shared schema (see
// packages/schema/src/pty.ts) so the generated SDK carries it; reuse that schema verbatim here.
export const Info = Pty.Info
export type Info = Types.DeepMutable<typeof Info.Type>

export const CreateInput = Pty.CreateInput

export type CreateInput = Types.DeepMutable<typeof CreateInput.Type>

export const UpdateInput = Schema.Struct({
  ...Pty.UpdateInput.fields,
  sessionID: Schema.optional(Schema.NullOr(SessionSchema.ID)), // kilocode_change
})

export type UpdateInput = Types.DeepMutable<typeof UpdateInput.Type>

// kilocode_change - the shared events already carry Kilo's extended Info (see packages/schema/src/pty.ts),
// so reuse them verbatim instead of redefining pty.created/pty.updated here.
export const Event = Pty.Event

export type AttachInput = {
  // Absolute output cursor to replay from. -1 tails from the current end; omitted replays the full retained buffer.
  readonly cursor?: number
  // Callbacks fire synchronously from the native PTY data path; keep them non-blocking.
  readonly onData: (chunk: string) => void
  // Fired once when the session stops producing output: process exit (exitCode set), removal, or service teardown.
  readonly onEnd: (event: { exitCode?: number }) => void
  // Canonical routes can replay retained output after exit; legacy callers retain the former error.
  readonly allowExited?: boolean // kilocode_change
}

export type Attachment = {
  // Retained output from the requested cursor to the current end.
  readonly replay: string
  // Absolute output cursor after replay.
  readonly cursor: number
  readonly write: (data: string) => void
  // Starts live delivery after the caller has applied replay and cursor metadata.
  readonly activate: () => void
  readonly detach: () => void
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Pty.NotFoundError", {
  ptyID: PtyID,
}) {}

export class ExitedError extends Schema.TaggedErrorClass<ExitedError>()("Pty.ExitedError", {
  ptyID: PtyID,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: PtyID) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (id: PtyID, input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: PtyID) => Effect.Effect<void, NotFoundError>
  readonly removeDirectory: (directory: string) => Effect.Effect<void> // kilocode_change
  readonly write: (id: PtyID, data: string) => Effect.Effect<void, NotFoundError>
  readonly attach: (id: PtyID, input: AttachInput) => Effect.Effect<Attachment, NotFoundError | ExitedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Pty") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)
    const sessions = new Map<PtyID, Active>()
    const exitOrder: PtyID[] = []

    function notifyEnd(session: Active, event: { exitCode?: number }) {
      for (const subscriber of session.subscribers.values()) {
        if (!subscriber.active) {
          subscriber.end = event
          continue
        }
        try {
          subscriber.onEnd(event)
        } catch {}
      }
      session.subscribers.clear()
    }

    // kilocode_change start - terminate the complete PTY tree before reporting removal.
    async function teardown(session: Active) {
      session.stopping = true
      if (session.info.status === "running") await KiloPtyTermination.terminate(session.process)
      for (const listener of session.listeners) listener.dispose()
      session.listeners.length = 0
      notifyEnd(session, session.info.status === "exited" ? { exitCode: session.info.exitCode } : {})
    }
    // kilocode_change end

    yield* Effect.addFinalizer(
      () =>
        // kilocode_change start - wait for process-tree termination during async service teardown.
        Effect.promise(async () => {
          await Promise.all(Array.from(sessions.values()).map(teardown))
          sessions.clear()
          exitOrder.length = 0
        }),
      // kilocode_change end
    )

    const requireSession = Effect.fn("Pty.requireSession")(function* (id: PtyID) {
      const session = sessions.get(id)
      if (!session) return yield* new NotFoundError({ ptyID: id })
      // kilocode_change start - the global registry still enforces location isolation.
      const location = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
      if (location && session.directory !== location.directory) return yield* new NotFoundError({ ptyID: id })
      // kilocode_change end
      return session
    })

    const removeSession = Effect.fnUntraced(function* (id: PtyID) {
      // kilocode_change start - removal and its deleted event are one uninterruptible lifecycle transition.
      yield* Effect.gen(function* () {
        const session = sessions.get(id)
        if (!session) return
        yield* Effect.logInfo("removing session", { id })
        yield* Effect.promise(() => teardown(session))
        sessions.delete(id)
        const index = exitOrder.indexOf(id)
        if (index !== -1) exitOrder.splice(index, 1)
        yield* events.publish(Event.Deleted, { id: session.info.id })
      }).pipe(Effect.uninterruptible)
      // kilocode_change end
    })

    const remove = Effect.fn("Pty.remove")(function* (id: PtyID) {
      yield* requireSession(id)
      yield* removeSession(id)
    })

    // kilocode_change start - explicit worktree deletion is the PTY cleanup boundary.
    const removeDirectory = Effect.fn("Pty.removeDirectory")(function* (directory: string) {
      const owned = Array.from(sessions.values()).filter((session) => session.directory === directory)
      yield* Effect.forEach(owned, (session) => removeSession(session.info.id), { concurrency: 4 })
    })
    // kilocode_change end

    const list = Effect.fn("Pty.list")(function* () {
      // kilocode_change start - filter the process-wide registry by request location.
      const location = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
      return Array.from(sessions.values())
        .filter((session) => !location || session.directory === location.directory)
        .map((session) => session.info)
      // kilocode_change end
    })

    const get = Effect.fn("Pty.get")(function* (id: PtyID) {
      return (yield* requireSession(id)).info
    })

    const create = Effect.fn("Pty.create")(function* (input: CreateInput) {
      const id = PtyID.ascending()
      // kilocode_change start - resolve Kilo self-commands to the real binary, arguments, and project cwd
      const resolved = KiloPtySelfCommand.resolve({
        command: input.command,
        args: input.args ? [...input.args] : undefined,
        cwd: input.cwd,
      })
      const implicit = !resolved.command
      // kilocode_change start - location and config are request-scoped now that PTYs are global.
      const location = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
      const config = Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))
      const entries = config ? yield* config.entries() : []
      const command = resolved.command || Shell.preferred(Config.latest(entries, "shell"))
      const base = resolved.args ?? []
      const args = implicit && Shell.login(command) ? [...base, "-l"] : [...base]
      const cwd = resolved.cwd || location?.directory || process.cwd()
      const directory = location?.directory || cwd
      // kilocode_change end
      // kilocode_change end
      const env = {
        ...process.env,
        ...input.env,
        TERM: "xterm-256color",
        KILO_TERMINAL: "1",
        KILO_PTY_ID: id, // kilocode_change - let nested Kilo processes identify their parent terminal
      } as Record<string, string>
      // kilocode_change start - do not expose local server credentials to user terminals.
      // node-pty inherits parent values for omitted keys, so empty tombstones are required.
      env.KILO_SERVER_PASSWORD = ""
      env.KILO_SERVER_USERNAME = ""
      // kilocode_change end
      if (process.platform === "win32") {
        env.LC_ALL = "C.UTF-8"
        env.LC_CTYPE = "C.UTF-8"
        env.LANG = "C.UTF-8"
      }
      yield* Effect.logInfo("creating session", { id, cmd: command, args, cwd })
      const { spawn } = yield* Effect.promise(() => pty())
      // kilocode_change start - spawn with initial terminal dimensions
      const proc = yield* Effect.sync(() =>
        spawn(command, args, {
          name: "xterm-256color",
          cwd,
          env,
          cols: input.size?.cols,
          rows: input.size?.rows,
        }),
      )
      // kilocode_change end
      const info: Info = {
        id,
        title: input.title || `Terminal ${id.slice(-4)}`,
        command,
        args,
        cwd,
        status: "running",
        pid: proc.pid,
      }
      const session: Active = {
        info,
        directory, // kilocode_change
        process: proc,
        buffer: "",
        bufferCursor: 0,
        cursor: 0,
        subscribers: new Map(),
        listeners: [],
        stopping: false, // kilocode_change
      }
      sessions.set(id, session)
      session.listeners.push(
        proc.onData((chunk) => {
          session.cursor += chunk.length
          for (const [token, subscriber] of session.subscribers.entries()) {
            if (!subscriber.active) {
              subscriber.pending.push(chunk)
              continue
            }
            try {
              subscriber.onData(chunk)
            } catch {
              session.subscribers.delete(token)
            }
          }
          session.buffer += chunk
          if (session.buffer.length <= BUFFER_LIMIT) return
          const excess = session.buffer.length - BUFFER_LIMIT
          session.buffer = session.buffer.slice(excess)
          session.bufferCursor += excess
        }),
        proc.onExit(({ exitCode }) => {
          if (session.info.status === "exited" || session.stopping) return // kilocode_change
          session.info.status = "exited"
          session.info.exitCode = exitCode
          notifyEnd(session, { exitCode })
          exitOrder.push(id)
          runFork(
            Effect.gen(function* () {
              yield* Effect.logInfo("session exited", { id, exitCode })
              yield* events.publish(Event.Exited, { id, exitCode })
              while (exitOrder.length > EXITED_LIMIT) {
                const oldest = exitOrder[0]
                if (!oldest) break
                yield* removeSession(oldest)
              }
            }),
          )
        }),
      )
      yield* events.publish(Event.Created, { info })
      return info
    })

    const update = Effect.fn("Pty.update")(function* (id: PtyID, input: UpdateInput) {
      const session = yield* requireSession(id)
      if (input.title) session.info.title = input.title
      // kilocode_change start - associate nested Kilo TUI terminals with the viewed session
      if ("sessionID" in input) session.info.sessionID = input.sessionID ?? undefined
      // kilocode_change end
      if (input.size && session.info.status === "running") session.process.resize(input.size.cols, input.size.rows)
      yield* events.publish(Event.Updated, { info: session.info })
      return session.info
    })

    const write = Effect.fn("Pty.write")(function* (id: PtyID, data: string) {
      const session = yield* requireSession(id)
      if (session.info.status === "running") session.process.write(data)
    })

    const attach = Effect.fn("Pty.attach")(function* (id: PtyID, input: AttachInput) {
      const session = yield* requireSession(id)
      if (session.info.status !== "running" && !input.allowExited) return yield* new ExitedError({ ptyID: id }) // kilocode_change
      // kilocode_change start - location is optional because the registry is process-wide.
      const location = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
      yield* Effect.logInfo("client attached to session", { id, directory: location?.directory })
      // kilocode_change end
      const token = {}
      const subscriber: Subscriber = {
        onData: input.onData,
        onEnd: input.onEnd,
        active: false,
        detached: false,
        pending: [],
        end: session.info.status === "exited" ? { exitCode: session.info.exitCode } : undefined, // kilocode_change
      }
      session.subscribers.set(token, subscriber)
      const start = session.bufferCursor
      const end = session.cursor
      const from =
        input.cursor === -1
          ? end
          : typeof input.cursor === "number" && Number.isSafeInteger(input.cursor)
            ? Math.max(0, input.cursor)
            : 0
      const replay = (() => {
        if (!session.buffer || from >= end) return ""
        const offset = Math.max(0, from - start)
        if (offset >= session.buffer.length) return ""
        return session.buffer.slice(offset)
      })()
      return {
        replay,
        cursor: end,
        write: (data: string) => {
          if (session.info.status === "running") session.process.write(data)
        },
        activate: () => {
          if (subscriber.active || subscriber.detached) return
          subscriber.active = true
          try {
            for (const chunk of subscriber.pending) subscriber.onData(chunk)
            subscriber.pending.length = 0
            if (subscriber.end) subscriber.onEnd(subscriber.end)
          } catch {
            session.subscribers.delete(token)
          }
        },
        detach: () => {
          subscriber.detached = true
          subscriber.pending.length = 0
          subscriber.end = undefined
          session.subscribers.delete(token)
        },
      }
    })

    return Service.of({ list, get, create, update, remove, removeDirectory, write, attach }) // kilocode_change
  }),
)

export const locationLayer = layer // kilocode_change

export const node = makeGlobalNode({ service: Service, layer, deps: [EventV2.node] }) // kilocode_change
