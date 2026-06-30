import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { appendTerminalOutput } from "@/kilocode/interactive-terminal/output"
import { Identifier } from "@/id/id"
import { Instance, type InstanceContext } from "@/kilocode/instance"
import { SessionID } from "@/session/schema"
import { Shell } from "@/shell/shell"
import { NonNegativeInt, PositiveInt, optionalOmitUndefined, withStatics } from "@opencode-ai/core/schema"
import { zod, ZodOverride } from "@opencode-ai/core/effect-zod"
import * as Log from "@opencode-ai/core/util/log"
import type { Disp, Proc } from "#pty"
import { Context, Effect, Layer, Schema, Types } from "effect"
import path from "path"
import stripAnsi from "strip-ansi"
import z from "zod"

export namespace InteractiveTerminal {
  const log = Log.create({ service: "interactive-terminal" })
  const FLUSH_MS = 25
  const DEFAULT_COLS = 100
  const DEFAULT_ROWS = 18

  const idSchema = Schema.String.annotate({ [ZodOverride]: z.string().startsWith("itx") }).pipe(
    Schema.brand("InteractiveTerminalID"),
  )
  export type ID = typeof idSchema.Type
  export const ID = idSchema.pipe(
    withStatics((schema: typeof idSchema) => ({
      ascending: (id?: string) => {
        if (id && !id.startsWith("itx")) throw new Error(`Interactive terminal ID must start with itx: ${id}`)
        return schema.make(id ?? Identifier.create("itx", "ascending"))
      },
      zod: zod(schema),
    })),
  )

  export const Status = Schema.Literals(["running", "closed"])
  export type Status = Schema.Schema.Type<typeof Status>
  export const ClosedBy = Schema.Literals(["exit", "user", "abort"])
  export type ClosedBy = Schema.Schema.Type<typeof ClosedBy>

  export const Info = Schema.Struct({
    id: ID,
    sessionID: SessionID,
    pid: PositiveInt,
    command: Schema.String,
    cwd: Schema.String,
    description: optionalOmitUndefined(Schema.String),
    status: Status,
    cols: PositiveInt,
    rows: PositiveInt,
    exitCode: optionalOmitUndefined(Schema.Number),
    signal: optionalOmitUndefined(Schema.String),
    closedBy: optionalOmitUndefined(ClosedBy),
    time: Schema.Struct({
      started: NonNegativeInt,
      updated: NonNegativeInt,
      ended: optionalOmitUndefined(NonNegativeInt),
    }),
  })
    .annotate({ identifier: "InteractiveTerminalInfo" })
    .pipe(withStatics((schema) => ({ zod: zod(schema) })))
  export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

  export const Snapshot = Schema.Struct({
    info: Info,
    output: Schema.String,
    cursor: NonNegativeInt,
  })
    .annotate({ identifier: "InteractiveTerminalSnapshot" })
    .pipe(withStatics((schema) => ({ zod: zod(schema) })))
  export type Snapshot = Types.DeepMutable<Schema.Schema.Type<typeof Snapshot>>

  export const WriteInput = Schema.Struct({
    data: Schema.String,
  }).annotate({ identifier: "InteractiveTerminalWriteInput" })

  export const ResizeInput = Schema.Struct({
    cols: PositiveInt,
    rows: PositiveInt,
  }).annotate({ identifier: "InteractiveTerminalResizeInput" })

  export const Event = {
    Updated: BusEvent.define("interactive_terminal.updated", Schema.Struct({ info: Info })),
    Data: BusEvent.define(
      "interactive_terminal.data",
      Schema.Struct({ terminalID: ID, sessionID: SessionID, data: Schema.String, cursor: NonNegativeInt }),
    ),
    Deleted: BusEvent.define("interactive_terminal.deleted", Schema.Struct({ terminalID: ID, sessionID: SessionID })),
  }

  export interface RunInput {
    sessionID: SessionID
    command: string
    cwd?: string
    description?: string
    shell: string
    env: NodeJS.ProcessEnv
    cols?: number
    rows?: number
    abort?: AbortSignal
  }

  export interface Result {
    id: ID
    output: string
    exitCode?: number
    signal?: string
    closedBy: ClosedBy
  }

  type Active = {
    ctx: InstanceContext
    info: Info
    proc: Proc
    output: string
    chunk: string
    cursor: number
    resolve: (result: Result) => void
    ready?: Promise<void>
    timer?: ReturnType<typeof setTimeout>
    data?: Disp
    exit?: Disp
    abort?: () => void
    done: boolean
    result?: Result
  }

  type State = {
    ctx: InstanceContext
    dir: string
    terminals: Map<ID, Active>
  }

  class StateService extends Context.Service<StateService, { readonly get: () => Effect.Effect<State> }>()(
    "@kilocode/InteractiveTerminal.State",
  ) {}

  function clone(info: Info): Info {
    return { ...info, time: { ...info.time } }
  }

  function clean(text: string) {
    return stripAnsi(text)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[\b\x00-\x07\x0b\x0c\x0e-\x1f\x7f]/g, "")
  }

  function publish(active: Active, event: typeof Event.Updated, payload: { info: Info }): Promise<void>
  function publish(
    active: Active,
    event: typeof Event.Data,
    payload: { terminalID: ID; sessionID: SessionID; data: string; cursor: number },
  ): Promise<void>
  function publish(
    active: Active,
    event: typeof Event.Deleted,
    payload: { terminalID: ID; sessionID: SessionID },
  ): Promise<void>
  function publish(
    active: Active,
    event: typeof Event.Updated | typeof Event.Data | typeof Event.Deleted,
    payload:
      | { info: Info }
      | { terminalID: ID; sessionID: SessionID; data: string; cursor: number }
      | { terminalID: ID; sessionID: SessionID },
  ) {
    return Instance.restore(active.ctx, () =>
      Bus.publish(active.ctx, event as never, payload as never).catch((err) => {
        log.warn("failed to publish terminal event", { err, id: active.info.id, type: event.type })
      }),
    )
  }

  async function flush(active: Active) {
    if (active.timer) clearTimeout(active.timer)
    active.timer = undefined
    const data = active.chunk
    const cursor = active.cursor
    active.chunk = ""
    if (!data) return
    await publish(active, Event.Data, {
      terminalID: active.info.id,
      sessionID: active.info.sessionID,
      data,
      cursor,
    })
  }

  function schedule(active: Active) {
    if (active.done || active.timer) return
    active.timer = setTimeout(() => {
      active.timer = undefined
      void flush(active)
    }, FLUSH_MS)
  }

  function append(active: Active, data: string) {
    if (active.done) return
    active.output = appendTerminalOutput(active.output, data)
    active.chunk += data
    active.cursor += data.length
    active.info.time.updated = Date.now()
    schedule(active)
  }

  function gate(shell: string, command: string) {
    const name = Shell.name(shell)
    if (name === "cmd") return `pause >nul & ${command}`
    if (Shell.ps(shell)) return `$null = [Console]::ReadKey($true); ${command}`
    return `stty -echo; IFS= read -r __kilo_gate; stty echo; ${command}`
  }

  function release(shell: string) {
    if (Shell.ps(shell) || Shell.name(shell) === "cmd") return " "
    return "\r"
  }

  function environment(input: NodeJS.ProcessEnv) {
    const env = Object.fromEntries(
      Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    env.TERM = "xterm-256color"
    env.KILO_TERMINAL = "1"
    env.KILO_INTERACTIVE_TERMINAL = "1"
    delete env.KILO_SERVER_PASSWORD
    delete env.KILO_SERVER_USERNAME
    if (process.platform === "win32") {
      env.LC_ALL = "C.UTF-8"
      env.LC_CTYPE = "C.UTF-8"
      env.LANG = "C.UTF-8"
    }
    return env
  }

  async function finish(
    state: State,
    active: Active,
    input: { closedBy: ClosedBy; exitCode?: number; signal?: number | string; kill?: boolean; silent?: boolean },
  ) {
    if (active.done) return active.result
    active.done = true
    if (active.timer) clearTimeout(active.timer)
    active.timer = undefined
    active.abort?.()
    active.abort = undefined

    if (input.kill) {
      try {
        active.proc.kill()
      } catch (err) {
        log.warn("failed to kill interactive terminal", { err, id: active.info.id })
      }
    }

    active.data?.dispose()
    active.exit?.dispose()
    active.data = undefined
    active.exit = undefined
    await active.ready
    await flush(active)

    const now = Date.now()
    active.info.status = "closed"
    active.info.closedBy = input.closedBy
    active.info.time.updated = now
    active.info.time.ended = now
    if (input.exitCode !== undefined) active.info.exitCode = input.exitCode
    if (input.signal !== undefined) active.info.signal = String(input.signal)
    state.terminals.delete(active.info.id)

    const result: Result = {
      id: active.info.id,
      output: clean(active.output),
      exitCode: active.info.exitCode,
      signal: active.info.signal,
      closedBy: input.closedBy,
    }
    active.result = result

    if (!input.silent) {
      await publish(active, Event.Updated, { info: clone(active.info) })
      await publish(active, Event.Deleted, {
        terminalID: active.info.id,
        sessionID: active.info.sessionID,
      })
    }
    active.resolve(result)
    return result
  }

  async function launch(state: State, input: RunInput) {
    const existing = Array.from(state.terminals.values()).find((active) => active.info.sessionID === input.sessionID)
    if (existing) throw new Error(`An interactive terminal is already active for session ${input.sessionID}`)

    const id = ID.ascending()
    const cwd = path.resolve(state.dir, input.cwd ?? state.dir)
    const cols = Math.max(1, input.cols ?? DEFAULT_COLS)
    const rows = Math.max(1, input.rows ?? DEFAULT_ROWS)
    const args = Shell.args(input.shell, gate(input.shell, input.command), cwd)
    const { spawn } = await import("#pty")
    const proc = spawn(input.shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: environment(input.env),
    })
    const waiter = Promise.withResolvers<Result>()
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
        status: "running",
        cols,
        rows,
        time: { started: now, updated: now },
      },
      proc,
      output: "",
      chunk: "",
      cursor: 0,
      resolve: waiter.resolve,
      done: false,
    }
    state.terminals.set(id, active)
    const announced = Promise.withResolvers<void>()
    active.ready = announced.promise
    active.data = proc.onData((data) => append(active, data))
    active.exit = proc.onExit((event) => {
      void finish(state, active, {
        closedBy: "exit",
        exitCode: event.exitCode,
        signal: event.signal,
      })
    })

    if (input.abort) {
      const abort = () => {
        input.abort?.removeEventListener("abort", abort)
        void finish(state, active, { closedBy: "abort", kill: true })
      }
      active.abort = () => input.abort?.removeEventListener("abort", abort)
      if (input.abort.aborted) abort()
      else input.abort.addEventListener("abort", abort, { once: true })
    }

    if (!active.done) active.proc.write(release(input.shell))
    await publish(active, Event.Updated, { info: clone(active.info) })
    announced.resolve()
    return waiter.promise
  }

  const stateLayer = Layer.effect(
    StateService,
    Effect.gen(function* () {
      const ref = yield* InstanceState.make(
        Effect.fn("InteractiveTerminal.state")(function* (ctx) {
          const state: State = { ctx, dir: ctx.directory, terminals: new Map() }
          yield* Effect.addFinalizer(() =>
            Effect.promise(async () => {
              await Promise.all(
                Array.from(state.terminals.values()).map((active) =>
                  finish(state, active, { closedBy: "abort", kill: true, silent: true }),
                ),
              )
              state.terminals.clear()
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
    return runtime.runPromise((service) => service.get())
  }

  export async function run(input: RunInput) {
    return launch(await state(), input)
  }

  export async function list(input?: { sessionID?: SessionID }) {
    const current = await state()
    return Array.from(current.terminals.values())
      .map((active) => clone(active.info))
      .filter((info) => !input?.sessionID || info.sessionID === input.sessionID)
      .toSorted((a, b) => a.time.started - b.time.started || a.id.localeCompare(b.id))
  }

  export async function get(id: ID): Promise<Snapshot | undefined> {
    const current = await state()
    const active = current.terminals.get(id)
    if (!active) return
    return { info: clone(active.info), output: active.output, cursor: active.cursor }
  }

  export async function write(id: ID, data: string) {
    const current = await state()
    const active = current.terminals.get(id)
    if (!active || active.done) return false
    active.proc.write(data)
    return true
  }

  export async function resize(id: ID, cols: number, rows: number) {
    const current = await state()
    const active = current.terminals.get(id)
    if (!active || active.done) return false
    const width = Math.max(1, cols)
    const height = Math.max(1, rows)
    active.proc.resize(width, height)
    active.info.cols = width
    active.info.rows = height
    active.info.time.updated = Date.now()
    await publish(active, Event.Updated, { info: clone(active.info) })
    return true
  }

  export async function close(id: ID, closedBy: ClosedBy = "user") {
    const current = await state()
    const active = current.terminals.get(id)
    if (!active) return false
    await finish(current, active, { closedBy, kill: true })
    return true
  }

  export async function stopSession(sessionID: SessionID) {
    const current = await state()
    const list = Array.from(current.terminals.values()).filter((active) => active.info.sessionID === sessionID)
    await Promise.all(list.map((active) => finish(current, active, { closedBy: "abort", kill: true })))
  }
}
