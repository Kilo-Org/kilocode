import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Identifier } from "@/id/id"
import { Instance, type InstanceContext } from "@/kilocode/instance"
import { KiloShutdown } from "@/kilocode/cli/shutdown"
import { SessionID } from "@/session/schema"
import { Shell } from "@opencode-ai/core/shell"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Process } from "@/util/process"
import { NonNegativeInt, PositiveInt, optionalOmitUndefined, withStatics } from "@opencode-ai/core/schema"
import { zod, ZodOverride } from "@opencode-ai/core/effect-zod"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { Flock } from "@opencode-ai/core/util/flock"
import * as Log from "@opencode-ai/core/util/log"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"
import { BackgroundProcessRunner } from "./runner"
import { chmod, mkdir, readFile, readdir, rm, stat } from "fs/promises"
import { randomUUID } from "crypto"
import { hostname } from "os"
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

  export const Lifetime = Schema.Literals(["session", "parent", "persistent"])
  export type Lifetime = Schema.Schema.Type<typeof Lifetime>

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
    lifetime: Lifetime,
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
    lifetime: optionalOmitUndefined(Lifetime),
    parentID: optionalOmitUndefined(SessionID),
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
        scope: Schema.String,
      }),
    ),
    Deleted: BusEvent.define(
      "background_process.deleted",
      Schema.Struct({
        sessionID: SessionID,
        processID: ID,
        scope: Schema.String,
      }),
    ),
  }

  type Active = {
    ctx: InstanceContext
    info: Info
    proc?: ChildProcess
    start: StartInput
    pattern?: RegExp
    resolve?: (ready: boolean) => void
    notify?: ReturnType<typeof setTimeout>
    poll?: ReturnType<typeof setTimeout>
    watch?: ReturnType<typeof setTimeout>
    retry?: ReturnType<typeof setTimeout>
    scan?: Promise<boolean>
    log?: string
    control?: string
    token?: string
    shared?: Shared
    offset?: number
    file?: string
    saved?: boolean
    saving?: Promise<void>
    disposed?: boolean
  }

  const Persisted = Schema.Struct({
    scope: Schema.String,
    token: Schema.String,
    info: Info,
    start: StartInput,
  }).pipe(withStatics((s) => ({ zod: zod(s) })))
  type Persisted = Schema.Schema.Type<typeof Persisted>

  type Shared = {
    key: string
    dir: string
    processes: Map<ID, Active>
    adopt?: Promise<void>
    claim?: Promise<boolean>
    lease?: Flock.Lease
  }

  type State = {
    ctx: InstanceContext
    dir: string
    processes: Map<ID, Active>
    shared: Shared
  }

  type Probe = "owned" | "gone" | "foreign" | "unknown"

  class StateService extends Context.Service<StateService, { readonly get: () => Effect.Effect<State> }>()(
    "@kilocode/BackgroundProcess.State",
  ) {}

  function scoped(ctx: InstanceContext) {
    const root = ctx.project.id === ProjectV2.ID.global ? ctx.directory : ctx.project.worktree
    const hash = Hash.fast(`${ctx.project.id}\0${Filesystem.resolve(root)}`)
    return { key: `scope:${hash}`, dir: `scope-${hash}` }
  }

  function root(shared: Shared) {
    return path.join(Global.Path.state, "background-process", shared.dir)
  }

  function manifest(shared: Shared, id: ID) {
    return path.join(root(shared), `${id}.json`)
  }

  function logroot(shared: Shared) {
    return path.join(Global.Path.log, "background-process", shared.dir)
  }

  function logfile(shared: Shared, id: ID) {
    return path.join(logroot(shared), `${id}.log`)
  }

  function controlfile(shared: Shared, id: ID) {
    return path.join(root(shared), `${id}.stop`)
  }

  async function secure(shared: Shared) {
    const dirs = [
      path.join(Global.Path.state, "background-process"),
      path.join(Global.Path.state, "background-process", "locks"),
      root(shared),
      path.join(Global.Path.log, "background-process"),
      logroot(shared),
    ]
    await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true, mode: 0o700 })))
    if (process.platform === "win32") return
    await Promise.all(dirs.map((dir) => chmod(dir, 0o700)))
  }

  function lockroot() {
    return path.join(Global.Path.state, "background-process", "locks")
  }

  async function held(shared: Shared) {
    const file = path.join(lockroot(), `${Hash.fast(shared.key)}.lock`, "meta.json")
    const value = await readFile(file, "utf8")
      .then((text): unknown => JSON.parse(text))
      .catch(() => undefined)
    if (!isRecord(value) || typeof value.pid !== "number" || typeof value.hostname !== "string") return false
    if (value.hostname !== hostname() || value.pid === process.pid) return false
    return alive(value.pid)
  }

  async function claim(shared: Shared) {
    if (shared.lease) return true
    if (shared.claim) return shared.claim
    if (await held(shared)) return false
    const pending = Flock.acquire(shared.key, {
      dir: lockroot(),
      timeoutMs: 100,
      staleMs: 10_000,
      baseDelayMs: 25,
      maxDelayMs: 50,
    })
      .then((lease) => {
        shared.lease = lease
        return true
      })
      .catch((err) => {
        log.debug("persistent process scope is managed by another Kilo process", { err, scope: shared.key })
        return false
      })
      .finally(() => {
        if (shared.claim === pending) shared.claim = undefined
      })
    shared.claim = pending
    return pending
  }

  async function save(shared: Shared, active: Active, opts?: { create?: boolean; disposed?: boolean }) {
    const token = active.token
    if ((!opts?.disposed && active.disposed) || active.info.lifetime !== "persistent" || !token) return
    if (!opts?.create && !active.saved) return
    if (opts?.create) active.saved = true
    const prev = active.saving?.catch(() => undefined) ?? Promise.resolve()
    const next = prev.then(async () => {
      await secure(shared)
      const info = clone(active.info)
      info.output = ""
      info.ports = []
      await Filesystem.writeJson(
        manifest(shared, active.info.id),
        {
          scope: shared.key,
          token,
          info,
          start: active.start,
        } satisfies Persisted,
        0o600,
      )
    })
    active.saving = next
    try {
      await next
    } catch (err) {
      if (opts?.create) active.saved = false
      throw err
    } finally {
      if (active.saving === next) active.saving = undefined
    }
  }

  async function forget(shared: Shared, active: Active) {
    active.saved = false
    await active.saving?.catch((err) =>
      log.warn("failed to finish persistent process metadata", { err, id: active.info.id }),
    )
    await Promise.all(
      [manifest(shared, active.info.id), logfile(shared, active.info.id), controlfile(shared, active.info.id)].map(
        (file) =>
          rm(file, { force: true }).catch((err) =>
            log.warn("failed to remove persistent process artifact", { err, file }),
          ),
      ),
    )
  }

  function alive(pid: number | undefined) {
    if (!pid || pid === process.pid) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return code(err) === "EPERM"
    }
  }

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
    const pid = active.info.pid
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
    const pid = active.info.pid
    if (!pid || terminal(active.info.status)) return update(active)
    return update(active, await Ports.list(pid))
  }

  function eventscope(active: Active) {
    if (active.info.lifetime === "persistent" && active.ctx.project.id !== ProjectV2.ID.global) {
      return active.ctx.project.worktree
    }
    return active.ctx.directory
  }

  function emit(active: Active) {
    Instance.restore(active.ctx, () => {
      void Bus.publish(active.ctx, Event.Updated, { info: clone(active.info), scope: eventscope(active) }).catch(
        (err) => {
          log.warn("failed to publish process update", { err, id: active.info.id })
        },
      )
    })
  }

  function publish(active: Active) {
    if (active.disposed) return
    update(active)
    emit(active)
  }

  function persist(active: Active) {
    if (!active.shared) return
    void save(active.shared, active).catch((err) =>
      log.warn("failed to save persistent process metadata", { err, id: active.info.id }),
    )
  }

  function recover(shared: Shared, active: Active) {
    if (active.disposed || active.saved || active.retry) return
    active.retry = setTimeout(() => {
      active.retry = undefined
      void save(shared, active, { create: true })
        .catch((err) => log.warn("failed to recover persistent process metadata", { err, id: active.info.id }))
        .finally(() => recover(shared, active))
    }, 5_000)
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
    persist(active)
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
          persist(active)
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

  function env(id?: ID, token?: string) {
    const result: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: "dumb",
      ...(id ? { KILO_BACKGROUND_PROCESS_ID: id } : {}),
      ...(token ? { KILO_BACKGROUND_PROCESS_TOKEN: token } : {}),
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
    if (process.platform === "win32") return false
    try {
      process.kill(-pid, 0)
      return true
    } catch (err) {
      if (code(err) === "EPERM") return true
      if (code(err) !== "ESRCH") log.debug("failed to probe process group", { err, pid })
      return false
    }
  }

  function pgrp(text: string): number | undefined {
    const end = text.lastIndexOf(")")
    if (end < 0) return undefined
    const fields = text
      .slice(end + 2)
      .trim()
      .split(/\s+/)
    const value = Number(fields[2])
    return Number.isInteger(value) && value > 0 ? value : undefined
  }

  async function linux(active: Active): Promise<Probe> {
    const pid = active.info.pid
    const token = active.token
    if (!pid || !token) return "unknown"
    const leader = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined)
    if (leader && pgrp(leader) === pid) {
      const data = await readFile(`/proc/${pid}/environ`).catch(() => undefined)
      if (data?.toString("utf8").split("\0").includes(`KILO_BACKGROUND_PROCESS_TOKEN=${token}`)) return "owned"
    }
    const names = await readdir("/proc").catch(() => undefined)
    if (!names) return "unknown"
    const members: number[] = []
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue
      const text = await readFile(`/proc/${name}/stat`, "utf8").catch(() => undefined)
      if (text && pgrp(text) === pid) members.push(Number(name))
    }
    if (members.length === 0) return "gone"
    let read = false
    for (const member of members) {
      const data = await readFile(`/proc/${member}/environ`).catch(() => undefined)
      if (!data) continue
      read = true
      if (data.toString("utf8").split("\0").includes(`KILO_BACKGROUND_PROCESS_TOKEN=${token}`)) return "owned"
    }
    return read ? "foreign" : "unknown"
  }

  async function unix(active: Active): Promise<Probe> {
    const pid = active.info.pid
    const token = active.token
    if (!pid || !token) return "unknown"
    const out = await Process.text(["ps", "eww", "-axo", "pid=,pgid=,command="], {
      nothrow: true,
      abort: AbortSignal.timeout(2_000),
      timeout: 2_000,
    })
    if (out.code !== 0) return "unknown"
    const members = out.text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      if (!match || Number(match[2]) !== pid) return []
      return [match[3]]
    })
    if (members.length === 0) return "gone"
    return members.some((command) => command.includes(token)) ? "owned" : "foreign"
  }

  async function windows(active: Active): Promise<Probe> {
    const pid = active.info.pid
    const token = active.token
    if (!pid || !token) return "unknown"
    const query = `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { [Console]::Out.Write($p.CommandLine) }`
    const out = await Process.text(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", query], {
      nothrow: true,
      abort: AbortSignal.timeout(2_000),
      timeout: 2_000,
    })
    if (out.code !== 0) return "unknown"
    if (!out.text.trim()) return "gone"
    return out.text.includes(token) ? "owned" : "foreign"
  }

  async function probe(active: Active): Promise<Probe> {
    if (process.platform === "linux") return linux(active)
    if (process.platform === "win32") return windows(active)
    if (process.platform === "darwin" || process.platform === "freebsd") return unix(active)
    return "unknown"
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

  async function waitGone(active: Active) {
    const end = Date.now() + KILL_MS
    while (Date.now() < end) {
      const status = await probe(active)
      if (status === "gone" || status === "foreign") return
      await Bun.sleep(100)
    }
  }

  async function kill(active: Active) {
    const pid = active.info.pid
    if (!pid) return
    if (active.info.lifetime === "persistent") {
      const before = await probe(active)
      if (before === "gone" || before === "foreign") return
      if (before !== "owned") throw new Error(`Cannot verify ownership of persistent process: ${active.info.id}`)
      if (process.platform === "win32") {
        if (!active.control) throw new Error(`Persistent process control path is missing: ${active.info.id}`)
        await Filesystem.write(active.control, "stop", 0o600)
        await waitGone(active)
        const stopped = await probe(active)
        if (stopped === "gone" || stopped === "foreign") return
        throw new Error(`Persistent process runner did not stop safely: ${active.info.id}`)
      }
      try {
        process.kill(-pid, "SIGTERM")
      } catch (err) {
        if ((await probe(active)) === "owned") throw err
        return
      }
      await waitGone(active)
      const force = await probe(active)
      if (force === "owned") {
        try {
          process.kill(-pid, "SIGKILL")
        } catch (err) {
          if ((await probe(active)) === "owned") throw err
        }
      }
      if (force === "unknown") throw new Error(`Cannot reverify persistent process before SIGKILL: ${active.info.id}`)
      return
    }
    if (active.proc ? stopped(active.proc) : !alive(pid)) return
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
      try {
        process.kill(pid, "SIGTERM")
      } catch (err) {
        if (code(err) !== "ESRCH") throw err
      }
    }
    if (active.proc) await waitExit(active.proc, KILL_MS)
    if (!active.proc) await Bun.sleep(KILL_MS)
    if (!alive(pid) && !group(pid)) return
    try {
      process.kill(-pid, "SIGKILL")
    } catch (err) {
      log.warn("failed to kill process group", { err, pid })
      try {
        process.kill(pid, "SIGKILL")
      } catch (err) {
        if (code(err) !== "ESRCH") throw err
      }
    }
  }

  function owner(state: State, lifetime: Lifetime) {
    return lifetime === "persistent" ? state.shared.processes : state.processes
  }

  async function terminate(state: State, active: Active, opts?: { remove?: boolean; silent?: boolean }) {
    if (active.retry) clearTimeout(active.retry)
    active.retry = undefined
    if (!terminal(active.info.status)) {
      active.info.status = "stopping"
      active.info.time.updated = Date.now()
      if (!opts?.silent) publish(active)
      await kill(active)
      if (active.info.lifetime === "persistent") await output(active)
      if (!terminal(active.info.status)) exited(active, active.proc?.exitCode ?? null, active.proc?.signalCode ?? null)
      if (active.info.lifetime === "persistent") await forget(state.shared, active)
    }
    if (!opts?.remove) return
    active.disposed = true
    owner(state, active.info.lifetime).delete(active.info.id)
    if (active.notify) clearTimeout(active.notify)
    if (active.poll) clearTimeout(active.poll)
    if (active.watch) clearTimeout(active.watch)
    active.resolve?.(false)
    active.resolve = undefined
    if (active.info.lifetime === "persistent") await forget(state.shared, active)
    if (opts.silent) return
    await Instance.restore(active.ctx, () =>
      Bus.publish(active.ctx, Event.Deleted, {
        sessionID: active.info.sessionID,
        processID: active.info.id,
        scope: eventscope(active),
      }).catch((err) => {
        log.warn("failed to publish process deletion", { err, id: active.info.id })
      }),
    )
  }

  async function output(active: Active) {
    if (!active.log) return
    const meta = await stat(active.log).catch(() => undefined)
    if (!meta) return
    const key = `${meta.dev}:${meta.ino}`
    if (active.file && active.file !== key) {
      active.offset = 0
      active.info.output = ""
    }
    active.file = key
    const size = meta.size
    const offset = active.offset ?? 0
    const start = size < offset ? Math.max(0, size - MAX) : offset
    const next = await Bun.file(active.log).slice(start, size).text()
    active.offset = size
    if (next) append(active, next)
  }

  function watch(shared: Shared, active: Active) {
    if (active.disposed || terminal(active.info.status) || active.watch) return
    active.watch = setTimeout(() => {
      active.watch = undefined
      void output(active)
        .then(async () => {
          const status = await probe(active)
          if (status === "owned" || status === "unknown") {
            if (status === "unknown") log.warn("failed to verify persistent process", { id: active.info.id })
            watch(shared, active)
            return
          }
          exited(active, 0, null)
          await forget(shared, active)
        })
        .catch((err) => {
          log.warn("failed to watch persistent process", { err, id: active.info.id })
          watch(shared, active)
        })
    }, PUBLISH_MS)
  }

  async function verify(active: Active) {
    const end = Date.now() + 2_000
    while (Date.now() < end) {
      const status = await probe(active)
      if (status === "owned") return
      if (active.proc && stopped(active.proc)) break
      await Bun.sleep(50)
    }
    throw new Error(`Persistent process identity could not be verified: ${active.info.id}`)
  }

  async function rollback(active: Active) {
    const pid = active.info.pid
    if (!pid) return true
    const before = await probe(active)
    if (before === "gone" || before === "foreign") return true
    if (before === "unknown" && (!active.proc || stopped(active.proc))) return false
    if (process.platform === "win32") {
      if (active.control) {
        await Filesystem.write(active.control, "stop", 0o600)
      } else {
        const out = await Process.run(["taskkill", "/pid", String(pid), "/f", "/t"], { nothrow: true })
        if (out.code !== 0 && (await probe(active)) === "owned") return false
      }
    } else {
      try {
        process.kill(-pid, "SIGKILL")
      } catch (err) {
        if ((await probe(active)) === "owned") throw err
      }
    }
    const end = Date.now() + KILL_MS
    while (Date.now() < end) {
      const status = await probe(active)
      if (status === "gone" || status === "foreign") return true
      await Bun.sleep(100)
    }
    return false
  }

  async function launch(state: State, input: StartInput, id = ID.ascending()) {
    const sh = Shell.acceptable()
    const cwd = path.resolve(state.dir, input.cwd ?? state.dir)
    const readyPattern = pattern(input.ready?.pattern)
    if (input.ready?.port && (await connected(input.ready.port))) {
      throw new Error(`Ready port is already in use: ${input.ready.port}`)
    }
    const args = Shell.args(sh, input.command, cwd)
    const lifetime = input.lifetime ?? "session"
    const start = { ...input, cwd, lifetime }
    const token = lifetime === "persistent" ? randomUUID() : undefined
    const logpath = lifetime === "persistent" ? logfile(state.shared, id) : undefined
    const control = lifetime === "persistent" ? controlfile(state.shared, id) : undefined
    if (logpath) {
      await secure(state.shared)
      if (!(await claim(state.shared)))
        throw new Error("Persistent processes for this project are managed by another Kilo process")
      await Filesystem.write(logpath, "", 0o600)
    }
    const cmd =
      logpath && token && control
        ? BackgroundProcessRunner.command({ token, shell: sh, args, cwd, log: logpath, control })
        : [sh, ...args]
    const proc = await Promise.resolve()
      .then(() =>
        spawn(cmd[0], cmd.slice(1), {
          cwd,
          env: env(id, token),
          stdio: ["ignore", "pipe", "pipe"],
          detached: lifetime === "persistent" || process.platform !== "win32",
          windowsHide: true,
        }),
      )
      .catch(async (err) => {
        if (logpath) await rm(logpath, { force: true })
        if (control) await rm(control, { force: true })
        throw err
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
        lifetime,
        ready: false,
        output: "",
        time: {
          started: now,
          updated: now,
        },
      },
      proc,
      start,
      pattern: readyPattern,
      log: logpath,
      control,
      token,
      shared: lifetime === "persistent" ? state.shared : undefined,
      offset: 0,
    }
    const processes = owner(state, lifetime)
    processes.set(id, active)
    proc.stdout?.on("data", (chunk) => append(active, chunk.toString("utf-8")))
    proc.stderr?.on("data", (chunk) => append(active, chunk.toString("utf-8")))
    proc.once("error", (err) => failed(active, err))
    proc.once("exit", (code, signal) => {
      if (processes.get(id) !== active || active.disposed) return
      if (lifetime !== "persistent") {
        exited(active, code, signal)
        return
      }
      void output(active)
        .then(async () => {
          const status = await probe(active)
          if (status === "owned" || status === "unknown") {
            watch(state.shared, active)
            return
          }
          exited(active, code, signal)
          await forget(state.shared, active)
        })
        .catch((err) => log.warn("failed to finalize persistent process", { err, id }))
    })
    try {
      if (lifetime === "persistent") {
        await verify(active)
        await save(state.shared, active, { create: true })
        proc.unref()
        await output(active)
        watch(state.shared, active)
      }
      publish(active)
      poll(active, PORT_START_MS)
      if (input.ready) await wait(active, input.ready)
      return clone(active.info)
    } catch (err) {
      active.disposed = true
      processes.delete(id)
      if (active.notify) clearTimeout(active.notify)
      if (active.poll) clearTimeout(active.poll)
      if (active.watch) clearTimeout(active.watch)
      const stopped = await rollback(active).catch((cause) => {
        log.error("failed to roll back persistent process", { cause, id })
        return false
      })
      if (lifetime === "persistent" && !stopped) {
        active.disposed = false
        processes.set(id, active)
        const saved = await save(state.shared, active, { create: true })
          .then(() => true)
          .catch((cause) => {
            log.error("failed to preserve persistent process after rollback", { cause, id })
            return false
          })
        if (!saved) recover(state.shared, active)
        proc.unref()
        publish(active)
        watch(state.shared, active)
      }
      if (lifetime === "persistent" && stopped) await forget(state.shared, active)
      throw err
    }
  }

  async function cleanup(shared: Shared, file: string, name: string) {
    const id = name.endsWith(".json") ? name.slice(0, -5) : ""
    const files = [
      file,
      ...(id.startsWith("bgp") ? [path.join(logroot(shared), `${id}.log`), path.join(root(shared), `${id}.stop`)] : []),
    ]
    await Promise.all(files.map((item) => rm(item, { force: true })))
  }

  async function records(state: State) {
    const shared = state.shared
    await secure(shared)
    const dir = root(shared)
    const files = await readdir(dir).catch((err) => {
      if (code(err) === "ENOENT") return []
      throw err
    })
    const records = files.filter((item) => item.endsWith(".json"))
    if (records.length === 0 || !(await claim(shared))) return
    for (const name of records) {
      const file = path.join(dir, name)
      const record = await readFile(file, "utf8")
        .then((text) => Schema.decodeUnknownSync(Persisted)(JSON.parse(text)))
        .catch((err) => {
          log.warn("failed to read persistent process metadata", { err, file })
          return undefined
        })
      if (!record) {
        await cleanup(shared, file, name)
        continue
      }
      if (record.scope !== shared.key || record.info.lifetime !== "persistent" || name !== `${record.info.id}.json`) {
        await cleanup(shared, file, name)
        continue
      }
      if (shared.processes.has(record.info.id)) continue
      const active: Active = {
        ctx: state.ctx,
        info: record.info,
        start: record.start,
        pattern: pattern(record.start.ready?.pattern),
        log: logfile(shared, record.info.id),
        control: controlfile(shared, record.info.id),
        token: record.token,
        shared,
        offset: 0,
        saved: true,
      }
      active.info.output = ""
      active.info.ports = []
      const status = await probe(active)
      if (shared.processes.has(active.info.id)) continue
      if (status === "unknown") {
        log.warn("persistent process ownership is unknown", { id: active.info.id })
        continue
      }
      if (status !== "owned") {
        await cleanup(shared, file, name)
        continue
      }
      if (process.platform !== "win32") {
        await Promise.all([chmod(file, 0o600), chmod(logfile(shared, active.info.id), 0o600).catch(() => undefined)])
      }
      shared.processes.set(active.info.id, active)
      await output(active)
      watch(shared, active)
      poll(active, PORT_START_MS)
      publish(active)
    }
  }

  function adopt(state: State) {
    if (state.shared.adopt) return state.shared.adopt
    const pending = records(state).finally(() => {
      if (state.shared.adopt === pending) state.shared.adopt = undefined
    })
    state.shared.adopt = pending
    return pending
  }

  const stateLayer = Layer.effect(
    StateService,
    Effect.gen(function* () {
      const shared = new Map<string, Shared>()
      const ref = yield* InstanceState.make(
        Effect.fn("BackgroundProcess.state")(function* (ctx) {
          const scope = scoped(ctx)
          const current = shared.get(scope.key) ?? { ...scope, processes: new Map<ID, Active>() }
          shared.set(scope.key, current)
          const state: State = { ctx, dir: ctx.directory, processes: new Map(), shared: current }
          yield* Effect.promise(() => adopt(state))
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
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          for (const current of shared.values()) {
            await Promise.all(
              Array.from(current.processes.values()).map(async (active) => {
                active.disposed = true
                if (active.notify) clearTimeout(active.notify)
                if (active.poll) clearTimeout(active.poll)
                if (active.watch) clearTimeout(active.watch)
                if (active.retry) clearTimeout(active.retry)
                active.proc?.removeAllListeners()
                active.proc?.stdout?.destroy()
                active.proc?.stderr?.destroy()
                await save(current, active, { create: !terminal(active.info.status), disposed: true })
              }),
            )
            current.processes.clear()
            await current.lease
              ?.release()
              .catch((err) => log.warn("failed to release persistent process scope", { err, scope: current.key }))
          }
          shared.clear()
        }),
      )
      return StateService.of({ get: () => InstanceState.get(ref) })
    }),
  )

  const runtime = makeRuntime(StateService, stateLayer)
  KiloShutdown.register(() => runtime.dispose())

  function state() {
    return runtime.runPromise((svc) => svc.get())
  }

  function find(state: State, id: ID) {
    return state.processes.get(id) ?? state.shared.processes.get(id)
  }

  function values(state: State) {
    return [...state.processes.values(), ...state.shared.processes.values()]
  }

  export function shutdown() {
    return runtime.dispose()
  }

  export async function start(input: StartInput) {
    return launch(await state(), input)
  }

  export async function list(input?: { sessionID?: SessionID }) {
    const current = await state()
    await adopt(current)
    return values(current)
      .map((active) => clone(active.info))
      .filter((info) => !input?.sessionID || info.sessionID === input.sessionID || info.lifetime === "persistent")
      .toSorted((a, b) => a.time.started - b.time.started || a.id.localeCompare(b.id))
  }

  export async function get(id: ID) {
    const current = await state()
    if (!find(current, id)) await adopt(current)
    const active = find(current, id)
    return active ? clone(active.info) : undefined
  }

  export async function logs(id: ID): Promise<Logs | undefined> {
    const current = await state()
    if (!find(current, id)) await adopt(current)
    const active = find(current, id)
    if (!active) return
    return { id: active.info.id, sessionID: active.info.sessionID, output: active.info.output }
  }

  export async function stop(id: ID) {
    const current = await state()
    if (!find(current, id)) await adopt(current)
    const active = find(current, id)
    if (!active) return
    await terminate(current, active)
    return clone(active.info)
  }

  export async function restart(id: ID) {
    const current = await state()
    if (!find(current, id)) await adopt(current)
    const active = find(current, id)
    if (!active) return
    const input = active.start
    await terminate(current, active, { remove: true })
    return launch(current, input, id)
  }

  export async function stopSession(sessionID: SessionID) {
    const current = await state()
    const list = Array.from(current.processes.values()).filter((active) => active.info.sessionID === sessionID)
    await Promise.all(
      list.map(async (active) => {
        if (active.info.lifetime === "parent" && active.start.parentID) {
          active.info.sessionID = active.start.parentID
          active.info.lifetime = "session"
          active.start.sessionID = active.start.parentID
          active.start.lifetime = "session"
          delete active.start.parentID
          active.info.time.updated = Date.now()
          publish(active)
          return
        }
        await terminate(current, active, { remove: true })
      }),
    )
  }
}
