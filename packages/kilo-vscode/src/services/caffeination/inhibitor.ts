import { existsSync } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"
import type { ChildProcess } from "node:child_process"
import { spawn } from "../../util/process"

export interface CaffeinationDriver {
  readonly available: boolean
  readonly reason?: string
  start(pid: number, onExit: (err?: Error) => void): Promise<void>
  stop(): Promise<void>
}

const START_TIMEOUT = 10_000
const STOP_TIMEOUT = 1_000
const LIMIT = 4_096
const READY = "KILO_CAFFEINATION_READY"

type Inhibitor = {
  child: ChildProcess
  ready: Promise<void>
  closed: Promise<void>
  cancel: () => void
  stopped: boolean
  finished: boolean
  cleanup?: Promise<void>
}

function locate(name: string): string | undefined {
  if (isAbsolute(name)) return existsSync(name) ? name : undefined
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    ...(process.platform === "win32" ? [] : ["/usr/bin", "/bin"]),
  ]
  return dirs.map((dir) => join(dir, name)).find((path) => existsSync(path))
}

async function stopChild(state: Inhibitor, group: boolean): Promise<void> {
  const child = state.child
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return
    try {
      if (group) {
        process.kill(-child.pid, signal)
        return
      }
      if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ESRCH") return
      throw err
    }
  }
  const wait = () => {
    const timeout = Promise.withResolvers<boolean>()
    const timer = setTimeout(() => timeout.resolve(false), STOP_TIMEOUT)
    return Promise.race([state.closed.then(() => true), timeout.promise]).finally(() => clearTimeout(timer))
  }

  kill("SIGTERM")
  if (await wait()) {
    if (group) kill("SIGKILL")
    return
  }
  kill("SIGKILL")
  if (!(await wait())) throw new Error("The keep-awake process did not exit after SIGKILL")
}

function args(platform: NodeJS.Platform, pid: number, shell?: string): string[] {
  if (platform === "darwin") return ["-i", "-w", String(pid)]
  if (platform === "linux")
    return [
      "--what=sleep",
      "--who=Kilo Code",
      "--why=Kilo agent running",
      "--mode=block",
      shell ?? "/bin/sh",
      "-c",
      `printf '%s\\n' '${READY}'; while kill -0 "$1" 2>/dev/null; do sleep 1 || exit; done`,
      "kilo-caffeination",
      String(pid),
    ]
  const script = `$ErrorActionPreference = 'Stop'
try {
  $type = Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);' -Name 'KiloCaffeination' -Namespace 'Kilo' -PassThru
  if ($type::SetThreadExecutionState([uint32]2147483649) -eq 0) { throw 'SetThreadExecutionState failed' }
  [Console]::Out.WriteLine('${READY}'); [Console]::Out.Flush()
  while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script]
}

export function createCaffeinationDriver(
  opts: { reason?: string; platform?: NodeJS.Platform; locate?: typeof locate; spawn?: typeof spawn } = {},
): CaffeinationDriver {
  const platform = opts.platform ?? process.platform
  const find = opts.locate ?? locate
  const unsupported =
    opts.reason ||
    (!["darwin", "linux", "win32"].includes(platform) ? `Caffeination is not supported on ${platform}` : undefined)
  const name =
    platform === "darwin" ? "/usr/bin/caffeinate" : platform === "win32" ? "powershell.exe" : "systemd-inhibit"
  const root = process.env.SystemRoot
  const command = unsupported
    ? undefined
    : ((platform === "win32" && root
        ? find(join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))
        : undefined) ?? find(name))
  const shell = !unsupported && platform === "linux" ? find("sh") : undefined
  const reason =
    unsupported ??
    (!command
      ? `The ${name} command is not available`
      : platform === "linux" && !shell
        ? "The sh command is not available"
        : undefined)
  let current: Inhibitor | undefined

  function release(state: Inhibitor): Promise<void> {
    return (state.cleanup ??= stopChild(state, platform === "linux").then(
      () => {
        if (current === state) current = undefined
      },
      (err: unknown) => {
        state.cleanup = undefined
        throw err
      },
    ))
  }

  const driver: CaffeinationDriver = {
    available: !reason,
    reason,
    async start(pid, onExit) {
      if (!Number.isInteger(pid) || pid <= 0 || pid > 2_147_483_647) throw new Error("Invalid parent process ID")
      if (reason) throw new Error(reason)
      if (current && (current.stopped || current.finished)) {
        await release(current)
        return driver.start(pid, onExit)
      }
      if (current) return current.ready

      const child = (opts.spawn ?? spawn)(command!, args(platform, pid, shell), {
        stdio: ["ignore", "pipe", "pipe"],
        detached: platform === "linux",
      })
      const ready = Promise.withResolvers<void>()
      const closed = Promise.withResolvers<void>()
      const state: Inhibitor = {
        child,
        ready: ready.promise,
        closed: closed.promise,
        stopped: false,
        finished: false,
        cancel: () => {
          clearTimeout(timer)
          ready.reject(new Error("The keep-awake process was stopped before starting"))
        },
      }
      current = state
      let acquired = false
      let output = ""
      let stderr = ""
      const confirm = () => {
        if (state.finished || state.stopped) return
        acquired = true
        clearTimeout(timer)
        ready.resolve()
      }
      const finish = async (err: Error) => {
        if (state.finished) return
        state.finished = true
        clearTimeout(timer)
        const failure = await release(state).catch((err: unknown) => (err instanceof Error ? err.message : String(err)))
        const error = new Error([err.message, stderr.trim(), failure].filter(Boolean).join(": "))
        if (!acquired) return ready.reject(error)
        if (!state.stopped) onExit(error)
      }
      const timer = setTimeout(
        () => void finish(new Error("Timed out while starting the keep-awake process")),
        START_TIMEOUT,
      )

      child.stdout?.setEncoding("utf8")
      child.stdout?.on("data", (chunk: string) => {
        if (acquired || platform === "darwin") return
        const lines = (output + chunk).split(/\r?\n/)
        output = (lines.pop() ?? "").slice(-LIMIT)
        if (lines.includes(READY)) confirm()
      })
      child.stderr?.setEncoding("utf8")
      child.stderr?.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-LIMIT)
      })
      child.once("spawn", () => {
        if (platform === "darwin") confirm()
      })
      child.once("close", () => closed.resolve())
      child.once("error", finish)
      child.once("exit", (code, signal) => {
        const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
        void finish(new Error(`Caffeination process exited with ${detail}`))
      })
      return ready.promise
    },
    stop() {
      if (!current) return Promise.resolve()
      current.stopped = true
      current.cancel()
      return release(current)
    },
  }
  return driver
}
