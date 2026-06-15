import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Identifier } from "@/id/id"
import { Instance, type InstanceContext } from "@/kilocode/instance"
import { SessionID } from "@/session/schema"
import { Shell } from "@/shell/shell"
import { NonNegativeInt, PositiveInt, optionalOmitUndefined, withStatics } from "@opencode-ai/core/schema"
import { zod, ZodOverride } from "@opencode-ai/core/effect-zod"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { spawn, type ChildProcess } from "child_process"
import { Context, Effect, Layer, Schema, Types } from "effect"
import net from "net"
import path from "path"
import z from "zod"
import * as Ports from "./ports"

export namespace BackgroundProcess {
  const log = Log.create({ service: "background-process" })
  const MAX = 200 * 1024
  const KILL_MS = 3_000
  const READY_MS = 30_000
  const PUBLISH_MS = 500
  const PORT_START_MS = 500
  const PORT_MS = 5_000
  const PORT_LIMIT_MS = 30_000

  const idSchema = Schema.String.annotate({ [ZodOverride]: z.string().startsWith("bgp") }).pipe(
    Schema.brand("BackgroundProcessID"),
  )
  export type ID = typeof idSchema.Type
  export const ID = idSchema.pipe(
    withStatics((schema: typeof idSchema) => ({
      ascending: (id?: string) => {
        if (id && !id.startsWith("bgp")) throw new Error(`Background process ID must start with bgp: ${id}`)
        return schema.make(id ?? Identifier.create("bgp", "ascending"))
      },
      zod: zod(schema),
    })),
  )

  export const Status = Schema.Literals(["starting", "running", "ready", "exited", "failed", "stopping", "stopped"])
  export type Status = Schema.Schema.Type<typeof Status>

  export const Ready = Schema.Struct({
    pattern: optionalOmitUndefined(Schema.String).annotate({
      description: "Regular expression matched against output to mark the process ready",
    }),
    port: optionalOmitUndefined(PositiveInt).annotate({
      description: "Local TCP port to probe until accepting connections",
    }),
    timeout: optionalOmitUndefined(PositiveInt).annotate({
      description: "Milliseconds to wait for readiness before returning the process as running",
    }),
  })
    .annotate({ identifier: "BackgroundProcessReady" })
    .pipe(withStatics((s) => ({ zod: zod(s) })))
  export type Ready = Types.DeepMutable<Schema.Schema.Type<typeof Ready>>

  export const Info = Schema.Struct({
    id: ID,
    sessionID: SessionID,
    pid: optionalOmitUndefined(PositiveInt),
    command: Schema.String,
    cwd: Schema.String,
    description: optionalOmitUndefined(Schema.String),
    ports: Schema.mutable(Schema.Array(PositiveInt)),
    status: Status,
    ready: Schema.Boolean,
    exitCode: optionalOmitUndefined(Schema.NullOr(NonNegativeInt)),
    signal: optionalOmitUndefined(Schema.NullOr(Schema.String)),
    output: Schema.String,
    time: Schema.Struct({
      started: NonNegativeInt,
      updated: NonNegativeInt,
      ended: optionalOmitUndefined(NonNegativeInt),
    }),
  })
    .annotate({ identifier: "BackgroundProcessInfo" })
    .pipe(withStatics((s) => ({ zod: zod(s) })))
  export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

  export const StartInput = Schema.Struct({
    sessionID: SessionID,
    command: Schema.String.annotate({ description: "Command to run in the configured shell" }),
    cwd: optionalOmitUndefined(Schema.String).annotate({
      description: "Working directory. Defaults to the project directory",
    }),
    description: optionalOmitUndefined(Schema.String).annotate({ description: "Short human readable process label" }),
    ready: optionalOmitUndefined(Ready),
  })
    .annotate({ identifier: "BackgroundProcessStartInput" })
    .pipe(withStatics((s) => ({ zod: zod(s) })))
  export type StartInput = Types.DeepMutable<Schema.Schema.Type<typeof StartInput>>

  export const Logs = Schema.Struct({
    id: ID,
    sessionID: SessionID,
    output: Schema.String,
  })
    .annotate({ identifier: "BackgroundProcessLogs" })
    .pipe(withStatics((s) => ({ zod: zod(s) })))
  export type Logs = Types.DeepMutable<Schema.Schema.Type<typeof Logs>>

  export const Event = {
    Updated: BusEvent.define(
      "background_process.updated",
      Schema.Struct({
        info: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "background_process.deleted",
      Schema.Struct({
        sessionID: SessionID,
        processID: ID,
      }),
    ),
  }

  type Active = {
    ctx: InstanceContext
    info: Info
    proc: ChildProcess
    start: StartInput
    pattern?: RegExp
    resolve?: (ready: boolean) => void
    notify?: ReturnType<typeof setTimeout>
    poll?: ReturnType<typeof setTimeout>
    scan?: Promise<boolean>
    disposed?: boolean
  }

  type State = {
    ctx: InstanceContext
    dir: string
    processes: Map<ID, Active>
  }

  class StateService extends Context.Service<StateService, { readonly get: () => Effect.Effect<State> }>()(
    "@kilocode/BackgroundProcess.State",
  ) {}

  function clone(info: Info): Info {
    return {
      ...info,
      ports: [...info.ports],
      time: { ...info.time },
    }
  }

  function terminal(status: Status) {
    return status === "exited" || status === "failed" || status === "stopped"
  }

  function clamp(text: string) {
    const buf = Buffer.from(text, "utf-8")
    if (buf.length <= MAX) return text
    let start = buf.length - MAX
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
    return buf.subarray(start).toString("utf-8")
  }

  function same(a: number[], b: number[]) {
    return a.length === b.length && a.every((port, index) => port === b[index])
  }

  function infer() {
    return Flag.KILO_CLIENT === "cli" && process.env.KILO_BACKGROUND_PROCESS_PORTS === "true"
  }

  function update(active: Active, ports?: number[]) {
    const pid = active.proc.pid
    if (!pid || terminal(active.info.status)) {
      const changed = active.info.ports.length > 0
      active.info.ports = []
      return changed
    }
    const fallback = active.info.ready && active.start.ready?.port ? [active.start.ready.port] : []
    const next = Array.from(new Set([...(ports ?? active.info.ports), ...fallback])).toSorted((a, b) => a - b)
    if (same(active.info.ports, next)) return false
    active.info.ports = next
    active.info.time.updated = Date.now()
    return true
  }

  async function refresh(active: Active) {
    const pid = active.proc.pid
    if (!pid || terminal(active.info.status)) return update(active)
    return update(active, await Ports.list(pid))
  }

  function emit(active: Active) {
    Instance.restore(active.ctx, () => {
      void Bus.publish(active.ctx, Event.Updated, { info: clone(active.info) }).catch((err) => {
        log.warn("failed to publish process update", { err, id: active.info.id })
      })
    })
  }

  function publish(active: Active) {
    if (active.disposed) return
    update(active)
    emit(active)
  }

  function finished(active: Active) {
    if (active.disposed) return true
    if (!infer()) return true
    if (terminal(active.info.status)) return true
    if (active.info.ports.length > 0) return true
    return Date.now() - active.info.time.started >= PORT_LIMIT_MS
  }

  function scan(active: Active) {
    if (finished(active)) return
    if (active.scan) return
    active.scan = refresh(active)
      .then((changed) => {
        active.scan = undefined
        if (active.disposed) return false
        if (changed) emit(active)
        poll(active)
        return changed
      })
      .catch((err) => {
        active.scan = undefined
        if (active.disposed) return false
        log.debug("failed to refresh process ports", { err, id: active.info.id })
        poll(active)
        return false
      })
  }

  function poll(active: Active, ms = PORT_MS) {
    if (finished(active)) return
    if (active.poll) return
    active.poll = setTimeout(() => {
      active.poll = undefined
      scan(active)
    }, ms)
  }

  function schedule(active: Active) {
    if (active.disposed) return
    if (active.notify) return
    active.notify = setTimeout(() => {
      active.notify = undefined
      publish(active)
    }, PUBLISH_MS)
  }

  function ready(active: Active) {
    if (active.disposed) return
    if (active.info.ready) return
    active.info.ready = true
    active.info.status = "ready"
    active.info.time.updated = Date.now()
    active.resolve?.(true)
    active.resolve = undefined
    publish(active)
  }

  function append(active: Active, chunk: string) {
    if (active.disposed) return
    active.info.output = clamp(active.info.output + chunk)
    active.info.time.updated = Date.now()
    if (active.pattern?.test(active.info.output)) ready(active)
    schedule(active)
  }

  function exited(active: Active, code: number | null, signal: NodeJS.Signals | null) {
    if (active.disposed) return
    if (terminal(active.info.status)) return
    if (active.notify) clearTimeout(active.notify)
    if (active.poll) clearTimeout(active.poll)
    active.notify = undefined
    active.poll = undefined
    if (code === null) delete active.info.exitCode
    else active.info.exitCode = code
    if (signal === null) delete active.info.signal
    else active.info.signal = signal
    active.info.ports = []
    active.info.ready = active.info.ready && code === 0
    active.info.status = active.info.status === "stopping" ? "stopped" : code === 0 ? "exited" : "failed"
    active.info.time.updated = Date.now()
    active.info.time.ended = active.info.time.updated
    active.resolve?.(false)
    active.resolve = undefined
    publish(active)
  }

  function failed(active: Active, err: unknown) {
    if (active.disposed) return
    append(active, `\n${err instanceof Error ? err.message : String(err)}\n`)
    exited(active, 1, null)
  }

  function pattern(input?: string) {
    if (!input) return
    try {
      return new RegExp(input)
    } catch (err) {
      throw new Error(`Invalid ready pattern: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function connected(port: number) {
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: "127.0.0.1" })
      const done = (ok: boolean) => {
        socket.removeAllListeners()
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(500)
      socket.once("connect", () => done(true))
      socket.once("error", () => done(false))
      socket.once("timeout", () => done(false))
    })
  }

  async function wait(active: Active, input: Ready) {
    if (!input.pattern && !input.port) return false
    if (input.pattern && active.pattern?.test(active.info.output)) {
      ready(active)
      return true
    }
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        if (active.info.status === "starting") {
          active.info.status = "running"
          active.info.time.updated = Date.now()
          publish(active)
        }
        active.resolve = undefined
        resolve(false)
      }, input.timeout ?? READY_MS)
      active.resolve = (ok) => {
        clearTimeout(timeout)
        resolve(ok)
      }
      const poll = async () => {
        if (!input.port) return
        while (!terminal(active.info.status) && !active.info.ready && active.resolve) {
          if (await connected(input.port)) {
            ready(active)
            return
          }
          await Bun.sleep(250)
        }
      }
      void poll().catch((err) => {
        log.warn("port readiness check failed", { err, id: active.info.id, port: input.port })
      })
    })
  }

  function env() {
    const result: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: "dumb",
    }
    delete result.KILO_SERVER_PASSWORD
    delete result.KILO_SERVER_USERNAME
    delete result.KILO_BACKGROUND_PROCESS_PORTS
    return result
  }

  function stopped(proc: ChildProcess) {
    return proc.exitCode !== null || proc.signalCode !== null
  }

  function code(err: unknown) {
    if (!err || typeof err !== "object" || !("code" in err)) return
    const value = (err as { code?: unknown }).code
    return typeof value === "string" ? value : undefined
  }

  function group(pid: number) {
    try {
      process.kill(-pid, 0)
      return true
    } catch (err) {
      if (code(err) === "ESRCH") return false
      log.debug("failed to probe process group", { err, pid })
      return true
    }
  }

  function waitExit(proc: ChildProcess, ms: number) {
    if (stopped(proc)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        proc.off("exit", done)
        proc.off("error", done)
        resolve()
      }
      proc.once("exit", done)
      proc.once("error", done)
    })
  }

  async function kill(active: Active) {
    const pid = active.proc.pid
    if (!pid || stopped(active.proc)) return
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const child = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
        })
        child.once("exit", () => resolve())
        child.once("error", () => resolve())
      })
      return
    }
    try {
      process.kill(-pid, "SIGTERM")
    } catch (err) {
      log.warn("failed to terminate process group", { err, pid })
      active.proc.kill("SIGTERM")
    }
    await waitExit(active.proc, KILL_MS)
    if (stopped(active.proc) && !group(pid)) return
    try {
      process.kill(-pid, "SIGKILL")
    } catch (err) {
      log.warn("failed to kill process group", { err, pid })
      active.proc.kill("SIGKILL")
    }
  }

  async function terminate(state: State, active: Active, opts?: { remove?: boolean; silent?: boolean }) {
    if (!terminal(active.info.status)) {
      active.info.status = "stopping"
      active.info.time.updated = Date.now()
      if (!opts?.silent) publish(active)
      await kill(active)
      if (!terminal(active.info.status)) exited(active, active.proc.exitCode, active.proc.signalCode)
    }
    if (!opts?.remove) return
    active.disposed = true
    state.processes.delete(active.info.id)
    if (active.notify) clearTimeout(active.notify)
    if (active.poll) clearTimeout(active.poll)
    active.resolve?.(false)
    active.resolve = undefined
    if (opts.silent) return
    await Instance.restore(active.ctx, () =>
      Bus.publish(active.ctx, Event.Deleted, { sessionID: active.info.sessionID, processID: active.info.id }).catch(
        (err) => {
          log.warn("failed to publish process deletion", { err, id: active.info.id })
        },
      ),
    )
  }

  async function launch(state: State, input: StartInput, id = ID.ascending()) {
    const sh = Shell.acceptable()
    const cwd = path.resolve(state.dir, input.cwd ?? state.dir)
    const readyPattern = pattern(input.ready?.pattern)
    if (input.ready?.port && (await connected(input.ready.port))) {
      throw new Error(`Ready port is already in use: ${input.ready.port}`)
    }
    const args = Shell.args(sh, input.command, cwd)
    const proc = spawn(sh, args, {
      cwd,
      env: env(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    })
    const now = Date.now()
    const active: Active = {
      ctx: state.ctx,
      info: {
        id,
        sessionID: input.sessionID,
        pid: proc.pid,
        command: input.command,
        cwd,
        description: input.description,
        ports: [],
        status: input.ready ? "starting" : "running",
        ready: false,
        output: "",
        time: {
          started: now,
          updated: now,
        },
      },
      proc,
      start: { ...input, cwd },
      pattern: readyPattern,
    }
    state.processes.set(id, active)
    proc.stdout?.on("data", (chunk) => append(active, chunk.toString("utf-8")))
    proc.stderr?.on("data", (chunk) => append(active, chunk.toString("utf-8")))
    proc.once("error", (err) => failed(active, err))
    proc.once("exit", (code, signal) => {
      if (state.processes.get(id) !== active) return
      exited(active, code, signal)
    })
    publish(active)
    poll(active, PORT_START_MS)
    if (input.ready) await wait(active, input.ready)
    return clone(active.info)
  }

  const stateLayer = Layer.effect(
    StateService,
    Effect.gen(function* () {
      const ref = yield* InstanceState.make(
        Effect.fn("BackgroundProcess.state")(function* (ctx) {
          const state: State = { ctx, dir: ctx.directory, processes: new Map() }
          yield* Effect.addFinalizer(() =>
            Effect.promise(async () => {
              await Promise.all(
                Array.from(state.processes.values()).map((active) =>
                  terminate(state, active, { remove: true, silent: true }),
                ),
              )
              state.processes.clear()
            }),
          )
          return state
        }),
      )
      return StateService.of({ get: () => InstanceState.get(ref) })
    }),
  )

  const runtime = makeRuntime(StateService, stateLayer)

  function state() {
    return runtime.runPromise((svc) => svc.get())
  }

  export async function start(input: StartInput) {
    return launch(await state(), input)
  }

  export async function list(input?: { sessionID?: SessionID }) {
    const current = await state()
    return Array.from(current.processes.values())
      .map((active) => clone(active.info))
      .filter((info) => !input?.sessionID || info.sessionID === input.sessionID)
      .toSorted((a, b) => a.time.started - b.time.started || a.id.localeCompare(b.id))
  }

  export async function get(id: ID) {
    const current = await state()
    const active = current.processes.get(id)
    return active ? clone(active.info) : undefined
  }

  export async function logs(id: ID): Promise<Logs | undefined> {
    const current = await state()
    const active = current.processes.get(id)
    if (!active) return
    return { id: active.info.id, sessionID: active.info.sessionID, output: active.info.output }
  }

  export async function stop(id: ID) {
    const current = await state()
    const active = current.processes.get(id)
    if (!active) return
    await terminate(current, active)
    return clone(active.info)
  }

  export async function restart(id: ID) {
    const current = await state()
    const active = current.processes.get(id)
    if (!active) return
    const input = active.start
    await terminate(current, active, { remove: true })
    return launch(current, input, id)
  }

  export async function stopSession(sessionID: SessionID) {
    const current = await state()
    const list = Array.from(current.processes.values()).filter((active) => active.info.sessionID === sessionID)
    await Promise.all(list.map((active) => terminate(current, active, { remove: true })))
  }
}
