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
  const wait = async () => {
    const timeout = Promise.withResolvers<boolean>()
    const timer = setTimeout(() => timeout.resolve(false), STOP_TIMEOUT)
    try {
      return await Promise.race([state.closed.then(() => true), timeout.promise])
    } finally {
      clearTimeout(timer)
    }
  }

  kill("SIGTERM")
  if (await wait()) {
    if (group) kill("SIGKILL")
    return
  }
  kill("SIGKILL")
  if (!(await wait())) throw new Error("The keep-awake process did not exit after SIGKILL")
}

class ProcessDriver implements CaffeinationDriver {
  private state: Inhibitor | undefined

  constructor(
    private readonly command: string,
    private readonly args: (pid: number) => string[],
    public readonly available: boolean,
    public readonly reason: string,
    private readonly opts: { ready?: boolean; group?: boolean; spawn: typeof spawn },
  ) {}

  async start(pid: number, onExit: (err?: Error) => void): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0 || pid > 2_147_483_647) throw new Error("Invalid parent process ID")
    if (!this.available) throw new Error(this.reason)
    if (this.state && (this.state.stopped || this.state.finished)) {
      await this.release(this.state)
      return this.start(pid, onExit)
    }
    if (this.state) return this.state.ready

    const child = this.opts.spawn(this.command, this.args(pid), {
      stdio: ["ignore", "pipe", "pipe"],
      detached: this.opts.group === true,
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
    this.state = state
    let acquired = false
    let output = ""
    let stderr = ""
    const confirm = () => {
      if (state.finished || state.stopped) return
      acquired = true
      clearTimeout(timer)
      ready.resolve()
    }
    const finish = (err: Error) => {
      if (state.finished) return
      state.finished = true
      clearTimeout(timer)
      const report = (failure?: unknown) => {
        const detail = failure instanceof Error ? failure.message : failure === undefined ? "" : String(failure)
        const error = new Error([err.message, stderr.trim(), detail].filter(Boolean).join(": "))
        if (!acquired) {
          ready.reject(error)
          return
        }
        if (!state.stopped) onExit(error)
      }
      void this.release(state).then(() => report(), report)
    }
    const timer = setTimeout(() => finish(new Error("Timed out while starting the keep-awake process")), START_TIMEOUT)

    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      if (acquired || !this.opts.ready) return
      const lines = (output + chunk).split(/\r?\n/)
      output = (lines.pop() ?? "").slice(-LIMIT)
      if (lines.includes(READY)) confirm()
    })
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-LIMIT)
    })
    child.once("spawn", () => {
      if (!this.opts.ready) confirm()
    })
    child.once("close", () => closed.resolve())
    child.once("error", finish)
    child.once("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
      finish(new Error(`Caffeination process exited with ${detail}`))
    })
    return ready.promise
  }

  stop(): Promise<void> {
    const state = this.state
    if (!state) return Promise.resolve()
    state.stopped = true
    state.cancel()
    return this.release(state)
  }

  private release(state: Inhibitor): Promise<void> {
    if (state.cleanup) return state.cleanup
    state.cleanup = stopChild(state, this.opts.group === true).then(
      () => {
        if (this.state === state) this.state = undefined
      },
      (err: unknown) => {
        state.cleanup = undefined
        throw err
      },
    )
    return state.cleanup
  }
}

function powershell(pid: number): string {
  return [
    "$ErrorActionPreference = 'Stop';",
    "try {",
    "$signature = '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint flags);';",
    "$type = Add-Type -MemberDefinition $signature -Name 'KiloCaffeination' -Namespace 'Kilo' -PassThru;",
    "$flags = [uint32]2147483649;",
    "$result = $type::SetThreadExecutionState($flags);",
    "if ($result -eq 0) { throw 'SetThreadExecutionState failed' };",
    `[Console]::Out.WriteLine('${READY}'); [Console]::Out.Flush();`,
    `$parent = ${pid};`,
    "while (Get-Process -Id $parent -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }",
    "} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
  ].join(" ")
}

function mac(find: typeof locate, run: typeof spawn): CaffeinationDriver {
  const command = find("/usr/bin/caffeinate")
  return new ProcessDriver(
    command ?? "/usr/bin/caffeinate",
    (pid) => ["-i", "-w", String(pid)],
    command !== undefined,
    "The /usr/bin/caffeinate command is not available",
    { spawn: run },
  )
}

function linux(find: typeof locate, run: typeof spawn): CaffeinationDriver {
  const command = find("systemd-inhibit")
  const shell = find("sh")
  return new ProcessDriver(
    command ?? "systemd-inhibit",
    (pid) => [
      "--what=sleep",
      "--who=Kilo Code",
      "--why=Kilo agent running",
      "--mode=block",
      shell ?? "/bin/sh",
      "-c",
      `printf '%s\\n' '${READY}'; while kill -0 "$1" 2>/dev/null; do sleep 1 || exit; done`,
      "kilo-caffeination",
      String(pid),
    ],
    command !== undefined && shell !== undefined,
    command === undefined ? "The systemd-inhibit command is not available" : "The sh command is not available",
    { ready: true, group: true, spawn: run },
  )
}

function windows(find: typeof locate, run: typeof spawn): CaffeinationDriver {
  const root = process.env.SystemRoot
  const system = root ? find(join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")) : undefined
  const command = system ?? find("powershell.exe")
  return new ProcessDriver(
    command ?? "powershell.exe",
    (pid) => ["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", powershell(pid)],
    command !== undefined,
    "PowerShell is not available",
    { ready: true, spawn: run },
  )
}

class UnsupportedDriver implements CaffeinationDriver {
  readonly available = false

  constructor(readonly reason: string) {}

  start(): Promise<void> {
    return Promise.reject(new Error(this.reason))
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }
}

export function createCaffeinationDriver(
  opts: { reason?: string; platform?: NodeJS.Platform; locate?: typeof locate; spawn?: typeof spawn } = {},
): CaffeinationDriver {
  if (opts.reason) return new UnsupportedDriver(opts.reason)
  const platform = opts.platform ?? process.platform
  const find = opts.locate ?? locate
  const run = opts.spawn ?? spawn
  if (platform === "darwin") return mac(find, run)
  if (platform === "linux") return linux(find, run)
  if (platform === "win32") return windows(find, run)
  return new UnsupportedDriver(`Caffeination is not supported on ${platform}`)
}
