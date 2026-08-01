import { closeSync, constants, existsSync, openSync, readFileSync } from "node:fs"
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { getConfig } from "../config"
import type { Action, DaemonConfig, RunOptions, RunResult, WorldConfig } from "../types"
import { parseScript as parseScriptFn } from "../script-parser"
import { DaemonServer } from "./server"
import { isHandshake, isResponse, type DaemonRequest, type DaemonResponse } from "./protocol"
import { BUILD_TIMEOUT_MS, ENTRY, fingerprint, fresh, MANIFEST } from "./build"

const SCRIPT_HEAD_TIMEOUT_MS = 30_000
const BUILD_OUTPUT_MAX = 16_384
const BUILD_FAILURE_COOLDOWN_MS = 30_000
const starts = new Map<string, Promise<void>>()
let building: { key: string; task: Promise<void> } | null = null
let failed: { key: string; err: Error; at: number } | null = null

function root(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, "..", "..")
}

function paths(): string[] {
  const override = process.env["KILO_WORLD_DAEMON_PATH"]
  const argv = process.argv[1]
  return [
    override,
    join(dirname(process.execPath), ENTRY),
    argv ? join(dirname(argv), ENTRY) : undefined,
    join(root(), "dist", ENTRY),
  ].filter((item): item is string => Boolean(item))
}

async function entry(opts: DaemonClient.CallOptions): Promise<string> {
  const override = process.env["KILO_WORLD_DAEMON_PATH"]
  if (override && !existsSync(override)) throw new Error(`KILO_WORLD_DAEMON_PATH does not exist: ${override}`)
  const local = join(root(), "dist", ENTRY)
  const current = paths().find(existsSync)
  if (current && current !== local) return current
  const script = join(root(), "script", "build-daemon.ts")
  if (existsSync(script) && typeof Bun !== "undefined") {
    const key = await fingerprint(root())
    if (await fresh(dirname(local), key, ENTRY, MANIFEST)) return local
    if (failed?.key === key && Date.now() - failed.at < BUILD_FAILURE_COOLDOWN_MS) throw failed.err
    if (failed?.key === key) failed = null
    if (!building || building.key !== key) {
      const task = build(script)
        .then(() => {
          if (failed?.key === key) failed = null
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err))
          failed = { key, err: error, at: Date.now() }
          throw error
        })
        .finally(() => {
          if (building?.task === task) building = null
        })
      building = { key, task }
    }
    await wait(building.task, opts.signal)
  }
  const file = paths().find(existsSync)
  if (file) return file
  throw new Error(
    `kilo-world Node daemon not found; tried:\n${paths()
      .map((item) => `  - ${item}`)
      .join("\n")}`,
  )
}

async function build(script: string): Promise<void> {
  const bin = Bun.which("bun") ?? process.execPath
  const child = spawn(bin, [script], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  const state = { output: "", timeout: false }
  const append = (data: Buffer | string) => {
    state.output = `${state.output}${data.toString()}`.slice(-BUILD_OUTPUT_MAX)
  }
  child.stdout?.on("data", append)
  child.stderr?.on("data", append)
  const timer = setTimeout(() => {
    state.timeout = true
    kill(child)
  }, BUILD_TIMEOUT_MS)
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  }).finally(() => clearTimeout(timer))
  if (code === 0 && !state.timeout) return
  const reason = state.timeout ? `timed out after ${BUILD_TIMEOUT_MS}ms` : `exited ${code ?? "unknown"}`
  const details = state.output.trim()
  throw new Error(`failed to build kilo-world Node daemon: ${reason}${details ? `\n${details}` : ""}`)
}

function wait(task: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return task
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(new Error("daemon build aborted"))
    signal.addEventListener("abort", abort, { once: true })
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

function runtime(): string {
  const override = process.env["KILO_WORLD_NODE"]
  if (override) return override
  const name = process.platform === "win32" ? "node.exe" : "node"
  const dir = dirname(process.execPath)
  const bundled = [join(dir, "node-runtime", name), join(dir, name)].find(existsSync)
  if (bundled) return bundled
  if (process.versions.electron) return process.execPath
  if (typeof Bun !== "undefined") return Bun.which("node") ?? name
  if (process.release.name === "node") return process.execPath
  return name
}

export namespace DaemonClient {
  export type CallOptions = {
    timeoutMs?: number
    silent?: boolean
    signal?: AbortSignal
  }

  export function isRunning(sessionID: string): boolean {
    return DaemonServer.isRunning(sessionID)
  }

  export function handshake(sessionID: string): {
    pid: number
    startedAt: number
    url: string
    token: string
  } | null {
    const path = DaemonServer.handshakePath(sessionID)
    if (!existsSync(path)) return null
    try {
      const data: unknown = JSON.parse(readFileSync(path, "utf8"))
      if (!isHandshake(data)) return null
      return { pid: data.pid, startedAt: data.startedAt ?? 0, url: data.url, token: data.token }
    } catch {
      return null
    }
  }

  export async function ensureRunning(sessionID: string, opts: CallOptions & { idleMs?: number } = {}): Promise<void> {
    if (await ping(sessionID)) return
    const current = starts.get(sessionID)
    if (current) return current
    const pending = launch(sessionID, opts).finally(() => {
      if (starts.get(sessionID) === pending) starts.delete(sessionID)
    })
    starts.set(sessionID, pending)
    return pending
  }

  async function launch(sessionID: string, opts: CallOptions & { idleMs?: number }): Promise<void> {
    const file = await entry(opts)
    const bin = runtime()
    if (process.env["KILO_WORLD_NODE"] && /[\\/]/.test(bin) && !existsSync(bin)) {
      throw new Error(`KILO_WORLD_NODE does not exist: ${bin}`)
    }
    const logFd = openSync(
      DaemonServer.logPath(sessionID),
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY,
      0o600,
    )
    const cfg = getConfig()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      KILO_WORLD_DAEMON_SESSION: sessionID,
      KILO_WORLD_PARENT_PID: String(process.pid),
      KILO_WORLD_HOME: cfg.home,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      ...(cfg.browser.executablePath ? { KILO_WORLD_CHROMIUM: cfg.browser.executablePath } : {}),
      ...(opts.idleMs !== undefined ? { KILO_WORLD_DAEMON_IDLE_MS: String(opts.idleMs) } : {}),
    }
    const args = [file, `--session=${sessionID}`, ...(opts.idleMs !== undefined ? [`--idle=${opts.idleMs}`] : [])]
    const state: { err?: Error } = {}
    const child = (() => {
      try {
        return spawn(bin, args, {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env,
          windowsHide: true,
        })
      } finally {
        closeSync(logFd)
      }
    })()
    child.once("error", (err) => {
      state.err = err
    })
    child.unref()
    const start = Date.now()
    while (Date.now() - start < SCRIPT_HEAD_TIMEOUT_MS) {
      if (opts.signal?.aborted) {
        kill(child)
        throw new Error("daemon startup aborted")
      }
      if (state.err) {
        kill(child)
        throw new Error(
          `failed to start kilo-world daemon with ${bin}: ${state.err.message}. Install Node or set KILO_WORLD_NODE to its executable.`,
        )
      }
      if (await ping(sessionID)) return
      await new Promise((r) => setTimeout(r, 50))
    }
    kill(child)
    // Surface the daemon log path so the user can read why startup failed.
    // The log is appended (openSync with "a") so any stderr/stdout from the
    // dying daemon process is captured there even when windowsHide is on.
    throw new Error(
      `kilo-world daemon for session ${sessionID} failed to start within ${SCRIPT_HEAD_TIMEOUT_MS}ms. ` +
        `Inspect the daemon log for the failure cause: ${DaemonServer.logPath(sessionID)}`,
    )
  }

  async function ping(sessionID: string): Promise<boolean> {
    if (!isRunning(sessionID)) return false
    const hs = handshake(sessionID)
    if (!hs) return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 500)
    return fetch(`${hs.url}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: randomId(), verb: "__ping__", args: [], auth: hs.token }),
      signal: controller.signal,
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => clearTimeout(timer))
  }

  export async function call(sessionID: string, req: DaemonRequest, opts: CallOptions = {}): Promise<DaemonResponse> {
    await ensureRunning(sessionID, opts)
    return send(sessionID, req, opts)
  }

  export async function callScript(
    sessionID: string,
    script: string,
    opts: CallOptions = {},
  ): Promise<DaemonResponse[]> {
    const segments = parseScript(script)
    const out: DaemonResponse[] = []
    for (const seg of segments) {
      out.push(await call(sessionID, { id: randomId(), verb: seg.verb, args: seg.args }, opts))
      if (!out.at(-1)?.ok) break
    }
    return out
  }

  export async function stop(sessionID: string, opts: CallOptions = {}): Promise<boolean> {
    if (!isRunning(sessionID)) return false
    try {
      const resp = await call(
        sessionID,
        { id: randomId(), verb: "__shutdown__", args: [] },
        { ...opts, timeoutMs: opts.timeoutMs ?? 5000, silent: true },
      )
      return resp.ok
    } catch {
      return false
    }
  }

  export function parseScript(text: string): Action[] {
    return parseScriptFn(text)
  }

  function randomId(): string {
    return Math.random().toString(36).slice(2, 10)
  }

  function send(sessionID: string, req: DaemonRequest, opts: CallOptions): Promise<DaemonResponse> {
    const hs = DaemonServer.handshake(sessionID)
    if (!hs) throw new Error(`daemon handshake missing for session ${sessionID}`)
    // Tag every request with the daemon's auth token. The server returns 401
    // on mismatch so an unauthorized peer can't drive the browser.
    const authed: DaemonRequest = { ...req, paths: req.paths ?? [], auth: hs.token }
    const controller = new AbortController()
    const timeout = opts.timeoutMs ?? 60_000
    const state = { timeout: false }
    const abort = () => controller.abort()
    if (opts.signal?.aborted) controller.abort()
    opts.signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => {
      state.timeout = true
      controller.abort()
    }, timeout)
    return fetch(`${hs.url}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(authed),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) throw new Error(`daemon rejected request: unauthorized`)
          const text = await res.text().catch(() => "")
          throw new Error(`daemon HTTP ${res.status}: ${text.slice(0, 200)}`)
        }
        const data: unknown = await res.json()
        if (!isResponse(data)) throw new Error("daemon returned an invalid response")
        return data
      })
      .finally(() => {
        clearTimeout(timer)
        opts.signal?.removeEventListener("abort", abort)
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") {
          if (state.timeout) throw new Error(`daemon call timed out after ${timeout}ms`)
          throw new Error("daemon call aborted")
        }
        throw err
      })
  }

  export type StartResult = {
    started: boolean
    idleMs: number
    idleMsRemaining: number
    pid?: number
  }

  /**
   * Manually start (or re-configure) the per-session browser daemon.
   * `idleMs` of 0 means "never time out" — the daemon stays alive until
   * explicitly stopped via `stop()` or a `daemon.stop` verb.
   */
  export async function startDaemon(sessionID: string, opts: { idleMs?: number } = {}): Promise<StartResult> {
    const idleMs = normalizeIdleMs(opts.idleMs)
    const wasRunning = isRunning(sessionID)
    if (wasRunning) {
      const resp = await call(
        sessionID,
        { id: randomId(), verb: "__set_idle__", args: [String(idleMs)] },
        { silent: true, timeoutMs: 5000 },
      )
      const data = (resp.envelope ?? {}) as {
        idleTimeoutMs?: number
        idleTimeoutRemainingMs?: number
      }
      const hs = handshake(sessionID)
      return {
        started: false,
        idleMs: data.idleTimeoutMs ?? idleMs,
        idleMsRemaining: data.idleTimeoutRemainingMs ?? idleMs,
        ...(hs ? { pid: hs.pid } : {}),
      }
    }
    await ensureRunning(sessionID, { idleMs, silent: true })
    const status = await statusOf(sessionID)
    return {
      started: true,
      idleMs: status.idleMs,
      idleMsRemaining: status.idleMsRemaining,
      ...(status.pid !== undefined ? { pid: status.pid } : {}),
    }
  }

  export type Status = {
    running: boolean
    pid?: number
    sessionID?: string
    runtime?: "node" | "bun"
    runtimeVersion?: string
    idleMs: number
    idleMsRemaining: number
  }

  export async function statusOf(sessionID: string): Promise<Status> {
    if (!isRunning(sessionID)) {
      return { running: false, idleMs: 0, idleMsRemaining: 0 }
    }
    try {
      const resp = await call(
        sessionID,
        { id: randomId(), verb: "__status__", args: [] },
        { silent: true, timeoutMs: 5000 },
      )
      const data = (resp.envelope ?? {}) as {
        pid?: number
        sessionID?: string
        runtime?: "node" | "bun"
        runtimeVersion?: string
        idleTimeoutMs?: number
        idleTimeoutRemainingMs?: number
      }
      return {
        running: true,
        ...(data.pid !== undefined ? { pid: data.pid } : {}),
        ...(data.sessionID ? { sessionID: data.sessionID } : {}),
        ...(data.runtime ? { runtime: data.runtime } : {}),
        ...(data.runtimeVersion ? { runtimeVersion: data.runtimeVersion } : {}),
        idleMs: data.idleTimeoutMs ?? 0,
        idleMsRemaining: data.idleTimeoutRemainingMs ?? 0,
      }
    } catch {
      return {
        running: false,
        idleMs: 0,
        idleMsRemaining: 0,
      }
    }
  }

  function normalizeIdleMs(value: number | undefined): number {
    if (value === undefined) return 5 * 60_000
    const n = Math.floor(value)
    if (!Number.isFinite(n)) throw new Error("idle timeout must be a finite number")
    if (n < 0) throw new Error("idle timeout cannot be negative")
    if (n === 0) return 0
    return n
  }

  export async function setIdle(sessionID: string, idleMs: number): Promise<StartResult> {
    return startDaemon(sessionID, { idleMs: normalizeIdleMs(idleMs) })
  }

  export async function runViaSession(sessionID: string, script: string, opts: RunOptions = {}): Promise<RunResult> {
    const segments = parseScript(script)
    const startedAt = Date.now()
    const results: RunResult["results"] = []

    for (const seg of segments) {
      if (opts.signal?.aborted) throw new Error("world script aborted")
      if (seg.verb === "daemon.start") {
        const idle = flagString(seg, "--idle")
        const data = await startDaemon(sessionID, { idleMs: idle === undefined ? 5 * 60_000 : Number(idle) })
        results.push({ ok: true, verb: seg.verb, args: seg.args, data, durationMs: 0 })
        continue
      }
      const response = await call(
        sessionID,
        {
          id: randomId(),
          verb: seg.verb,
          args: seg.args,
          ...(opts.directory ? { directory: opts.directory } : {}),
          ...(opts.paths ? { paths: opts.paths } : {}),
          ...(opts.config ? { config: daemonConfig(opts.config) } : {}),
        },
        { silent: true, timeoutMs: opts.timeoutMs, signal: opts.signal },
      )
      const result = responseResult(response, seg)
      results.push(result)
      if (!result.ok) break
    }

    return { ok: results.every((r) => r.ok), durationMs: Date.now() - startedAt, results }
  }
}

function kill(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  if (process.platform === "win32") {
    child.kill()
    return
  }
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch (err) {
    if (!child.kill() && err instanceof Error) process.stderr.write(`failed to stop world daemon: ${err.message}\n`)
  }
}

function daemonConfig(cfg: WorldConfig): DaemonConfig {
  return {
    browser: {
      headless: cfg.browser.headless,
      antiDetect: cfg.browser.antiDetect,
      timeoutMs: cfg.browser.timeoutMs,
      viewport: cfg.browser.viewport,
      executablePath: cfg.browser.executablePath,
      useSystemChrome: cfg.browser.useSystemChrome ?? false,
      args: [...cfg.browser.args],
    },
  }
}

function responseResult(response: DaemonResponse, action: Action): RunResult["results"][number] {
  const env = response.envelope
  const ok = response.ok && env.ok !== false
  const data = record(env.data) ? env.data : undefined
  const errors = Array.isArray(env.errors) ? env.errors.filter((item): item is string => typeof item === "string") : []
  const shot = screenshot(env.screenshot)
  const refs = Array.isArray(data?.refs) ? data.refs.filter(isRef) : []
  return {
    ok,
    verb: typeof env.verb === "string" ? env.verb : action.verb,
    args: action.args,
    data: env.data,
    ...(!ok ? { error: errors[0] ?? (typeof env.error === "string" ? env.error : response.message) ?? "unknown" } : {}),
    durationMs: typeof env.durationMs === "number" ? env.durationMs : 0,
    ...(shot
      ? {
          screenshot: {
            path: shot.path,
            bytes: shot.bytes,
            mime: shot.mime ?? "image/png",
          },
        }
      : {}),
    ...(env.verb === "snapshot" && refs.length > 0 ? { refs } : {}),
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function screenshot(value: unknown): { path: string; bytes: number; mime?: string } | undefined {
  if (!record(value) || typeof value.path !== "string" || typeof value.bytes !== "number") return undefined
  if (value.mime !== undefined && typeof value.mime !== "string") return undefined
  return { path: value.path, bytes: value.bytes, ...(value.mime ? { mime: value.mime } : {}) }
}

function isRef(value: unknown): value is { ref: string; role: string; name: string; selector?: string } {
  if (!record(value)) return false
  if (typeof value.ref !== "string" || typeof value.role !== "string" || typeof value.name !== "string") return false
  return value.selector === undefined || typeof value.selector === "string"
}

function flagString(action: { verb: string; args: string[] }, name: string): string | undefined {
  for (let i = 0; i < action.args.length; i++) {
    const t = action.args[i]
    if (t === name) return action.args[i + 1]
    if (t?.startsWith(`${name}=`)) return t.slice(name.length + 1)
  }
  return undefined
}
