import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { join } from "node:path"
import { ensureHome, getConfig } from "../config"
import type { RunOptions } from "../types"
import { isHandshake, isRequest, type DaemonHandshake, type DaemonRequest, type DaemonResponse } from "./protocol"

export type DispatchFn = (req: DaemonRequest, opts?: RunOptions) => Promise<Record<string, unknown>>

let installedDispatch: DispatchFn | null = null
let installedShutdown: (() => Promise<void>) | null = null
let currentServer: Server | null = null

export function setDispatch(fn: DispatchFn): void {
  installedDispatch = fn
}

export function setShutdown(fn: () => Promise<void>): void {
  installedShutdown = fn
}

const IDLE_TIMEOUT_MS_DEFAULT = 5 * 60_000
const SERVER_CLOSE_TIMEOUT_MS = 2000
const BROWSER_CLOSE_TIMEOUT_MS = 5000

const NEVER_TIMEOUT = 0

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function authorized(input: string, expected: string): boolean {
  const left = Buffer.from(input)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function remove(file: string): void {
  try {
    unlinkSync(file)
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return
    throw err
  }
}

export namespace DaemonServer {
  export type Options = {
    sessionID: string
    idleTimeoutMs?: number
    silent?: boolean
  }

  function safeSession(id: string): string {
    return id.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 96) || "default"
  }

  export function pidPath(sessionID: string): string {
    return join(ensureHome(getConfig().home), `daemon-${safeSession(sessionID)}.pid`)
  }

  export function handshakePath(sessionID: string): string {
    return join(ensureHome(getConfig().home), `daemon-${safeSession(sessionID)}.json`)
  }

  export function logPath(sessionID: string): string {
    return join(ensureHome(getConfig().home), `daemon-${safeSession(sessionID)}.log`)
  }

  export function handshake(sessionID: string): {
    pid: number
    startedAt: number
    sessionID?: string
    url: string
    token: string
  } | null {
    const path = handshakePath(sessionID)
    if (!existsSync(path)) return null
    try {
      const data: unknown = JSON.parse(readFileSync(path, "utf8"))
      if (!isHandshake(data)) return null
      return {
        pid: data.pid,
        startedAt: data.startedAt ?? 0,
        ...(data.sessionID ? { sessionID: data.sessionID } : {}),
        url: data.url,
        token: data.token,
      }
    } catch {
      return null
    }
  }

  function log(line: string, silent: boolean): void {
    if (!silent) process.stderr.write(`[kilo-world daemon] ${line}\n`)
  }

  export function isRunning(sessionID: string): boolean {
    const pidFile = pidPath(sessionID)
    if (!existsSync(pidFile)) return false
    const pid = (() => {
      try {
        return Number(readFileSync(pidFile, "utf8").trim())
      } catch {
        return Number.NaN
      }
    })()
    if (!Number.isFinite(pid)) return false
    const data = handshake(sessionID)
    if (!data || data.pid !== pid) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "EPERM") return true
      return false
    }
  }

  export function clear(sessionID: string, owner?: number): void {
    if (owner !== undefined) {
      const handshake = DaemonServer.handshake(sessionID)
      if (handshake && handshake.pid !== owner) return
    }
    for (const path of [pidPath(sessionID), handshakePath(sessionID)]) {
      remove(path)
    }
  }

  function claim(sessionID: string): void {
    const file = pidPath(sessionID)
    try {
      writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 })
    } catch (err) {
      if (!(err instanceof Error) || !("code" in err) || err.code !== "EEXIST") throw err
      const pid = (() => {
        try {
          return Number(readFileSync(file, "utf8").trim())
        } catch {
          return Number.NaN
        }
      })()
      if (Number.isFinite(pid)) {
        try {
          process.kill(pid, 0)
          throw new Error(`kilo-world daemon for session ${sessionID} is already starting (pid ${pid})`)
        } catch (cause) {
          if (!(cause instanceof Error) || !("code" in cause)) throw cause
          if (cause.code === "EPERM") {
            throw new Error(`kilo-world daemon for session ${sessionID} is already starting (pid ${pid})`)
          }
          if (cause.code !== "ESRCH") throw cause
        }
      }
      remove(file)
      writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 })
    }
    remove(handshakePath(sessionID))
  }

  let shutdownTimer: NodeJS.Timeout | null = null
  let lastActivityAt = Date.now()
  let currentIdleTimeoutMs = IDLE_TIMEOUT_MS_DEFAULT
  let activeRequests = 0
  let stopping: Promise<void> | null = null
  let watcher: NodeJS.Timeout | null = null

  function currentRemainingMs(): number {
    if (currentIdleTimeoutMs === NEVER_TIMEOUT) return 0
    if (activeRequests > 0) return currentIdleTimeoutMs
    return Math.max(0, currentIdleTimeoutMs - (Date.now() - lastActivityAt))
  }

  export function status() {
    return {
      running: true,
      pid: process.pid,
      runtime: typeof Bun === "undefined" ? "node" : "bun",
      runtimeVersion: process.version,
      sessionID: process.env["KILO_WORLD_DAEMON_SESSION"] ?? currentSessionIDForActivity,
      uptimeMs: process.uptime() * 1000,
      idleTimeoutMs: currentIdleTimeoutMs,
      idleTimeoutRemainingMs: currentRemainingMs(),
    }
  }

  async function shutdown(sessionID: string, silent: boolean): Promise<void> {
    if (stopping) return stopping
    stopping = (async () => {
      try {
        if (shutdownTimer) clearTimeout(shutdownTimer)
        if (watcher) clearInterval(watcher)
        const server = currentServer
        currentServer = null
        if (server) {
          server.closeAllConnections()
          await Promise.race([
            new Promise<void>((resolve) => server.close(() => resolve())),
            delay(SERVER_CLOSE_TIMEOUT_MS),
          ])
        }
        await Promise.race([
          installedShutdown?.().catch((err) => log(`browser shutdown failed: ${String(err)}`, silent)) ??
            Promise.resolve(),
          delay(BROWSER_CLOSE_TIMEOUT_MS),
        ])
      } finally {
        try {
          clear(sessionID, process.pid)
        } catch (err) {
          log(`state cleanup failed: ${String(err)}`, silent)
        }
        process.exit(0)
      }
    })()
    return stopping
  }

  function scheduleShutdown(sessionID: string, delayMs: number, silent: boolean): void {
    if (shutdownTimer) clearTimeout(shutdownTimer)
    if (delayMs === NEVER_TIMEOUT) {
      log(`idle timer disabled for session ${sessionID} (never times out)`, silent)
      return
    }
    log(`idle timer reset for session ${sessionID}: ${delayMs}ms`, silent)
    lastActivityAt = Date.now()
    shutdownTimer = setTimeout(() => {
      log(`idle timeout for session ${sessionID}, shutting down`, silent)
      void shutdown(sessionID, silent)
    }, delayMs)
  }

  function beginActivity(): void {
    activeRequests++
    if (shutdownTimer) clearTimeout(shutdownTimer)
  }

  function endActivity(): void {
    activeRequests = Math.max(0, activeRequests - 1)
    lastActivityAt = Date.now()
    if (activeRequests > 0 || currentIdleTimeoutMs === NEVER_TIMEOUT || stopping) return
    scheduleShutdown(currentSessionIDForActivity, currentIdleTimeoutMs, true)
  }

  let currentSessionIDForActivity = "default"

  function applyIdleMs(
    sessionID: string,
    idleMs: number,
    silent: boolean,
  ): { idleTimeoutMs: number; idleTimeoutRemainingMs: number } {
    if (!Number.isFinite(idleMs)) throw new Error("idle timeout must be a finite number")
    if (idleMs < 0) throw new Error("idle timeout cannot be negative")
    const normalized = Math.floor(idleMs)
    if (normalized === NEVER_TIMEOUT) {
      currentIdleTimeoutMs = NEVER_TIMEOUT
      if (shutdownTimer) clearTimeout(shutdownTimer)
      log(`idle timeout for session ${sessionID} set to never`, silent)
    } else {
      currentIdleTimeoutMs = normalized
      scheduleShutdown(sessionID, normalized, silent)
    }
    return { idleTimeoutMs: currentIdleTimeoutMs, idleTimeoutRemainingMs: currentRemainingMs() }
  }

  // Per-daemon auth token. Generated at `start()` and written to the handshake
  // file. Every inbound request must include it; otherwise the daemon returns
  // 401. This stops any other local process on a multi-user machine (or any
  // process running as the same user) from driving the browser by POSTing to
  // the daemon's HTTP endpoint.
  let currentAuthToken: string | null = null

  function readJsonBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let total = 0
      const limit = 16 * 1024 * 1024
      req.on("data", (chunk: Buffer) => {
        total += chunk.length
        if (total > limit) {
          reject(new Error(`request body exceeds ${limit} bytes`))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      req.on("error", reject)
    })
  }

  function writeJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = `${JSON.stringify(body)}\n`
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    })
    res.end(payload)
  }

  async function handleCall(req: IncomingMessage, res: ServerResponse, sessionID: string): Promise<void> {
    let raw: string
    try {
      raw = await readJsonBody(req)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const resp: DaemonResponse = { id: "parse", ok: false, envelope: {}, message: `bad body: ${message}` }
      writeJson(res, 400, resp)
      return
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const resp: DaemonResponse = { id: "parse", ok: false, envelope: {}, message: `bad json: ${message}` }
      writeJson(res, 400, resp)
      return
    }
    if (!isRequest(value)) {
      writeJson(res, 400, { id: "parse", ok: false, envelope: {}, message: "invalid request" })
      return
    }
    const action = value
    if (!currentAuthToken || !action.auth || !authorized(action.auth, currentAuthToken)) {
      writeJson(res, 401, { id: action.id ?? "auth", ok: false, envelope: {}, message: "unauthorized" })
      return
    }

    beginActivity()
    const controller = new AbortController()
    req.once("aborted", () => controller.abort())
    res.once("finish", endActivity)
    res.once("close", () => {
      if (res.writableFinished) return
      controller.abort()
      endActivity()
    })

    if (action.verb === "__ping__") {
      writeJson(res, 200, { id: action.id, ok: true, envelope: {}, message: "pong" })
      return
    }
    if (action.verb === "__shutdown__") {
      const resp: DaemonResponse = { id: action.id, ok: true, envelope: {}, message: "shutting down" }
      writeJson(res, 200, resp)
      setImmediate(() => {
        void shutdown(sessionID, true)
      })
      return
    }
    if (action.verb === "__status__") {
      const resp: DaemonResponse = {
        id: action.id,
        ok: true,
        envelope: {
          ok: true,
          ...status(),
        },
      }
      writeJson(res, 200, resp)
      return
    }
    if (action.verb === "__set_idle__") {
      const idleMs = Number(action.args[0] ?? IDLE_TIMEOUT_MS_DEFAULT)
      const out = applyIdleMs(sessionID, idleMs, true)
      writeJson(res, 200, { id: action.id, ok: true, envelope: { ok: true, ...out } })
      return
    }
    try {
      if (!installedDispatch)
        throw new Error("kilo-world daemon: dispatch not installed (entry.ts forgot to call setDispatch)")
      const envelope = await installedDispatch(action, { signal: controller.signal })
      const resp: DaemonResponse = {
        id: action.id,
        ok: envelope.ok !== false,
        envelope,
      }
      writeJson(res, 200, resp)
      if (action.verb === "daemon.stop") setImmediate(() => void shutdown(sessionID, true))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const resp: DaemonResponse = {
        id: action.id,
        ok: false,
        envelope: {
          ok: false,
          tool: "browser",
          verb: action.verb,
          duration_ms: 0,
          warnings: [],
          errors: [message],
          reason: message.length > 80 ? message.slice(0, 77) + "..." : message,
        },
      }
      writeJson(res, 200, resp)
    }
  }

  export async function start(opts: Options): Promise<Server> {
    const rawIdle = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS_DEFAULT
    if (!Number.isFinite(rawIdle)) throw new Error("idle timeout must be a finite number")
    if (rawIdle < 0) throw new Error("idle timeout cannot be negative")
    const idleTimeoutMs = Math.floor(rawIdle)
    const silent = opts.silent ?? false
    const sessionID = opts.sessionID
    currentSessionIDForActivity = sessionID
    currentIdleTimeoutMs = idleTimeoutMs
    lastActivityAt = Date.now()
    mkdirSync(ensureHome(getConfig().home), { recursive: true })
    if (isRunning(sessionID)) {
      throw new Error(`kilo-world daemon for session ${sessionID} is already running`)
    }
    claim(sessionID)
    currentAuthToken = randomBytes(32).toString("hex")
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/call") {
        void handleCall(req, res, sessionID).catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          try {
            writeJson(res, 500, { id: "internal", ok: false, envelope: {}, message })
          } catch (writeErr) {
            res.destroy(writeErr instanceof Error ? writeErr : undefined)
          }
        })
        return
      }
      writeJson(res, 404, {
        id: "not-found",
        ok: false,
        envelope: {},
        message: `no route for ${req.method} ${req.url}`,
      })
    })
    currentServer = server
    const host = "127.0.0.1"
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject)
      server.listen({ host, port: 0, exclusive: false }, () => {
        server.off("error", reject)
        const addr = server.address()
        if (addr && typeof addr === "object") resolve(addr.port)
        else reject(new Error("server bound but no address returned"))
      })
    }).catch((err) => {
      currentServer = null
      clear(sessionID, process.pid)
      throw err
    })
    const url = `http://${host}:${port}`
    const handshake: DaemonHandshake = {
      pid: process.pid,
      version: "0.1.0",
      startedAt: Date.now(),
      idleTimeoutMs,
      sessionID,
      url,
      token: currentAuthToken,
    }
    writeFileSync(handshakePath(sessionID), JSON.stringify(handshake, null, 2), { mode: 0o600 })
    log(
      `listening for session ${sessionID} at ${url} (pid=${process.pid}, idle=${
        idleTimeoutMs === NEVER_TIMEOUT ? "never" : `${idleTimeoutMs}ms`
      })`,
      silent,
    )
    if (idleTimeoutMs !== NEVER_TIMEOUT) {
      scheduleShutdown(sessionID, idleTimeoutMs, silent)
    }
    process.on("SIGTERM", () => {
      log("SIGTERM, shutting down", silent)
      void shutdown(sessionID, silent)
    })
    process.on("SIGINT", () => {
      log("SIGINT, shutting down", silent)
      void shutdown(sessionID, silent)
    })
    process.on("exit", () => clear(sessionID, process.pid))
    const parent = Number(process.env["KILO_WORLD_PARENT_PID"])
    if (Number.isFinite(parent) && parent > 0) {
      watcher = setInterval(() => {
        try {
          process.kill(parent, 0)
        } catch {
          void shutdown(sessionID, silent)
        }
      }, 1000)
      watcher.unref()
    }
    return server
  }
}
