import path from "path"
import { existsSync } from "fs"
import { spawn } from "child_process"
import { createServer } from "net"
import { open, readFile, rm, mkdir } from "fs/promises"
import z from "zod"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

export namespace Daemon {
  const username = "kilo"
  const lock = "kilocode-daemon"
  export const PortRange = { start: 4097, end: 4116 } as const

  export const State = z.object({
    pid: z.number().int().positive(),
    hostname: z.string(),
    port: z.number().int().positive(),
    url: z.string(),
    username: z.string(),
    password: z.string(),
    token: z.string(),
    version: z.string(),
    startedAt: z.string(),
    log: z.string(),
  })
  export type State = z.infer<typeof State>

  export const Status = z.object({
    running: z.boolean(),
    stale: z.boolean(),
    state: State.optional(),
    health: z
      .object({
        healthy: z.boolean(),
        version: z.string(),
      })
      .optional(),
    reason: z.string().optional(),
    file: z.string(),
  })
  export type Status = z.infer<typeof Status>

  export type Options = {
    hostname: string
    port: number
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
    command?: string[]
    env?: NodeJS.ProcessEnv
    timeout?: number
  }

  export type Start = Status & {
    started: boolean
    reused: boolean
  }

  export type Stop = Status & {
    stopped: boolean
  }

  function root() {
    return process.env.KILO_TEST_DAEMON_STATE_DIR ?? Global.Path.state
  }

  function logs() {
    return process.env.KILO_TEST_DAEMON_LOG_DIR ?? Global.Path.log
  }

  export function file() {
    return path.join(root(), "daemon.json")
  }

  export function log() {
    return path.join(logs(), "daemon.log")
  }

  function auth(password: string) {
    return Buffer.from(`${username}:${password}`).toString("base64")
  }

  function host(input: string) {
    if (input === "0.0.0.0") return "127.0.0.1"
    return input
  }

  export async function read() {
    const data = await Filesystem.readJson(file()).catch((err) => {
      if (code(err) === "ENOENT") return undefined
      throw err
    })
    if (!data) return undefined
    return State.parse(data)
  }

  async function write(input: State) {
    await Filesystem.writeJson(file(), input, 0o600)
  }

  async function clear() {
    await rm(file(), { force: true })
  }

  function code(err: unknown) {
    if (!err || typeof err !== "object" || !("code" in err)) return undefined
    const value = err.code
    if (typeof value !== "string") return undefined
    return value
  }

  function alive(pid: number) {
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      if (code(err) === "EPERM") return true
      return false
    }
  }

  async function health(input: State) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 2_000)
    try {
      const res = await fetch(`${input.url}/global/health`, {
        signal: ctl.signal,
        headers: {
          authorization: `Basic ${input.token}`,
        },
      })
      if (!res.ok) return undefined
      return z.object({ healthy: z.boolean(), version: z.string() }).parse(await res.json())
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  export async function status(): Promise<Status> {
    const state = await read().catch((err) => {
      if (err instanceof z.ZodError || err instanceof SyntaxError) return undefined
      throw err
    })
    if (!state) return { running: false, stale: false, file: file(), reason: "not running" }
    if (!alive(state.pid)) return { running: false, stale: true, state, file: file(), reason: "process is not running" }
    const probe = await health(state)
    if (!probe) return { running: false, stale: true, state, file: file(), reason: "health check failed" }
    if (probe.version !== InstallationVersion) {
      return { running: false, stale: true, state, health: probe, file: file(), reason: "version mismatch" }
    }
    return { running: true, stale: false, state, health: probe, file: file() }
  }

  export async function start(input: Options): Promise<Start> {
    return await Flock.withLock(
      lock,
      async () => {
        const current = await status()
        if (current.running) return { ...current, started: false, reused: true }
        if (current.stale && current.state) await terminate(current.state.pid, true)
        await clear()
        const password = "kilo"
        const token = auth(password)
        const out = log()
        await mkdir(path.dirname(out), { recursive: true })
        await Filesystem.write(out, "", 0o600)
        const ready = await launch({ ...input, port: await port(input) }, password, out)
        const state = {
          pid: ready.pid,
          hostname: ready.hostname,
          port: ready.port,
          url: `http://${host(ready.hostname)}:${ready.port}`,
          username,
          password,
          token,
          version: InstallationVersion,
          startedAt: new Date().toISOString(),
          log: out,
        }
        await write(state)
        const next = await status()
        return { ...next, started: true, reused: false, state }
      },
      { dir: path.join(root(), "locks"), timeoutMs: 15_000, staleMs: 30_000 },
    )
  }

  export async function stop(): Promise<Stop> {
    return await Flock.withLock(
      lock,
      async () => {
        const current = await status()
        if (!current.state) return { ...current, stopped: false }
        if (alive(current.state.pid)) {
          await terminate(current.state.pid, false)
          if (alive(current.state.pid)) await terminate(current.state.pid, true)
        }
        await clear()
        return { ...current, running: false, stale: false, stopped: true }
      },
      { dir: path.join(root(), "locks"), timeoutMs: 15_000, staleMs: 30_000 },
    )
  }

  export async function restart(input: Options): Promise<Start> {
    await stop()
    return await start(input)
  }

  export function command(
    input?: string[],
    proc = { argv: process.argv, execArgv: process.execArgv, execPath: process.execPath },
  ) {
    if (input?.length) return input
    const script = proc.argv[1]
    const bundled = script?.startsWith("/$bunfs/") || (script ? /^[A-Za-z]:[\\/]~BUN[\\/]/.test(script) : false)
    if (script && !bundled && /\.(ts|js|mjs|cjs)$/.test(script)) return [proc.execPath, ...clean(proc.execArgv), script]
    return [proc.execPath]
  }

  export function clean(input: string[]) {
    return input.filter((arg, index) => {
      if (arg === "--cwd") return false
      if (input[index - 1] === "--cwd") return false
      if (arg.startsWith("--cwd=")) return false
      return true
    })
  }

  function args(input: Options) {
    return [
      "serve",
      "--hostname",
      input.hostname,
      "--port",
      String(input.port),
      ...(input.mdns ? ["--mdns"] : []),
      ...(input.mdnsDomain ? ["--mdns-domain", input.mdnsDomain] : []),
      ...(input.cors ?? []).flatMap((item) => ["--cors", item]),
    ]
  }

  async function port(input: Options) {
    if (input.port !== 0) return input.port
    const ports = Array.from({ length: PortRange.end - PortRange.start + 1 }, (_, index) => PortRange.start + index)
    const free = await Promise.any(
      ports.map((item) =>
        available(input.hostname, item).then((value) => {
          if (value) return item
          throw new Error(`port ${item} unavailable`)
        }),
      ),
    ).catch(() => undefined)
    if (!free) throw new Error(`No available daemon ports in ${PortRange.start}-${PortRange.end}`)
    return free
  }

  async function available(hostname: string, port: number) {
    return await new Promise<boolean>((resolve) => {
      const server = createServer()
      server.once("error", () => resolve(false))
      server.listen(port, hostname, () => server.close(() => resolve(true)))
    })
  }

  async function launch(input: Options, password: string, out: string) {
    const cmd = command(input.command)
    const stdout = await open(out, "a")
    const stderr = await open(out, "a")
    try {
      const child = spawn(cmd[0], [...cmd.slice(1), ...args(input)], {
        cwd: cwd(cmd),
        detached: true,
        env: {
          ...process.env,
          ...input.env,
          KILO_SERVER_USERNAME: username,
          KILO_SERVER_PASSWORD: password,
          KILOCODE_FEATURE: "daemon",
        },
        stdio: ["ignore", stdout.fd, stderr.fd],
        windowsHide: process.platform === "win32",
      })
      const failure = new Promise<never>((_, reject) => child.once("error", reject))
      child.unref()
      return await Promise.race([wait(out, child.pid, input.timeout ?? 10_000), failure])
    } finally {
      await Promise.all([stdout.close(), stderr.close()])
    }
  }

  function cwd(cmd: string[]) {
    const script = cmd.find((arg) => /\.(ts|js|mjs|cjs)$/.test(arg))
    if (!script) return Global.Path.home
    return packageRoot(path.dirname(script)) ?? Global.Path.home
  }

  function packageRoot(dir: string): string | undefined {
    if (existsSync(path.join(dir, "package.json"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    return packageRoot(parent)
  }

  async function wait(out: string, pid: number | undefined, timeout: number) {
    if (!pid) throw new Error("Daemon process did not provide a pid")
    const started = Date.now()
    while (true) {
      const match = await line(out)
      if (match) return { pid, hostname: match.hostname, port: match.port }
      if (!alive(pid)) throw new Error(`Daemon exited before listening. Log: ${out}`)
      if (Date.now() - started > timeout) throw new Error(`Timed out waiting for daemon. Log: ${out}`)
      await sleep(100)
    }
  }

  async function line(out: string) {
    const text = await readFile(out, "utf8").catch((err) => {
      if (code(err) === "ENOENT") return ""
      throw err
    })
    const match = text.match(/kilo server listening on http:\/\/([^:\s]+):(\d+)/)
    if (!match) return undefined
    return { hostname: match[1], port: Number(match[2]) }
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function terminate(pid: number, force: boolean) {
    if (pid === process.pid) return
    if (process.platform === "win32") {
      await Process.run(["taskkill", "/pid", String(pid), "/T", force ? "/F" : ""].filter(Boolean), { nothrow: true })
      return
    }
    try {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM")
    } catch (err) {
      if (code(err) !== "ESRCH") process.kill(pid, force ? "SIGKILL" : "SIGTERM")
    }
    await waitDead(pid, force ? 1_000 : 5_000)
  }

  async function waitDead(pid: number, timeout: number) {
    const started = Date.now()
    while (true) {
      if (!alive(pid)) return
      if (Date.now() - started > timeout) return
      await sleep(100)
    }
  }
}
