import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import type { ChildProcess } from "node:child_process"
import { spawn } from "../../util/process"

export interface CaffeinationDriver {
  readonly available: boolean
  readonly reason?: string
  start(parentPid: number, onExit: () => void): Promise<void>
  stop(): Promise<void>
}

const STOP_TIMEOUT = 1_000

function locate(name: string): string | undefined {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    ...(process.platform === "win32" ? [] : ["/usr/bin", "/bin"]),
  ]
  return dirs.map((dir) => join(dir, name)).find((path) => existsSync(path))
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()

  return new Promise((resolve) => {
    let done = false
    const kill = (signal: NodeJS.Signals) => {
      try {
        return child.kill(signal)
      } catch (error) {
        console.warn("[Kilo New] Failed to stop caffeination process:", error)
        return false
      }
    }
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) kill("SIGKILL")
      finish()
    }, STOP_TIMEOUT)

    child.once("exit", finish)
    child.once("error", finish)
    if (!kill("SIGTERM")) finish()
  })
}

class ProcessDriver implements CaffeinationDriver {
  private child: ChildProcess | undefined
  private readonly stopping = new WeakSet<ChildProcess>()

  constructor(
    private readonly command: string,
    private readonly args: (parentPid: number) => string[],
    public readonly available: boolean,
    public readonly reason?: string,
  ) {}

  start(parentPid: number, onExit: () => void): Promise<void> {
    if (this.child) return Promise.resolve()
    if (!this.available) return Promise.reject(new Error(this.reason ?? "Caffeination is unavailable"))

    const child = spawn(this.command, this.args(parentPid), { stdio: "ignore" })
    this.child = child

    return new Promise((resolve, reject) => {
      let ready = false
      let closed = false
      let settled = false
      const clear = () => {
        if (this.child === child) this.child = undefined
      }
      const close = (error?: Error) => {
        if (closed) return
        closed = true
        clear()
        if (!ready) {
          if (!settled) {
            settled = true
            reject(error ?? new Error("Caffeination process exited before starting"))
          }
          return
        }
        if (!this.stopping.has(child)) onExit()
      }

      child.once("spawn", () => {
        ready = true
        if (settled) return
        settled = true
        resolve()
      })
      child.once("error", (error) => close(error instanceof Error ? error : new Error(String(error))))
      child.once("exit", (code, signal) => {
        const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
        close(new Error(`Caffeination process exited with ${detail}`))
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.stopping.add(child)
    this.child = undefined
    await stopChild(child)
    this.stopping.delete(child)
  }
}

function powershell(parentPid: number): string {
  return [
    "$signature = '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint flags);';",
    "$type = Add-Type -MemberDefinition $signature -Name 'KiloCaffeination' -Namespace 'Kilo' -PassThru;",
    "$flags = 0x80000000 -bor 0x00000001;",
    "$result = $type::SetThreadExecutionState($flags);",
    "if ($result -eq 0) { exit 1 };",
    `$parent = ${parentPid};`,
    "while (Get-Process -Id $parent -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }",
  ].join(" ")
}

function mac(): CaffeinationDriver {
  const command = "/usr/bin/caffeinate"
  return new ProcessDriver(
    command,
    (parentPid) => ["-i", "-w", String(parentPid)],
    existsSync(command),
    `The ${command} command is not available`,
  )
}

function linux(): CaffeinationDriver {
  const command = locate("systemd-inhibit")
  const shell = locate("sh")
  return new ProcessDriver(
    command ?? "systemd-inhibit",
    (parentPid) => [
      "--what=idle:sleep",
      "--who=Kilo Code",
      "--why=Kilo agent running",
      "--mode=block",
      shell ?? "/bin/sh",
      "-c",
      `while kill -0 ${parentPid} 2>/dev/null; do sleep 1; done`,
    ],
    command !== undefined && shell !== undefined,
    command === undefined ? "The systemd-inhibit command is not available" : "The sh command is not available",
  )
}

function windows(): CaffeinationDriver {
  const root = process.env.SystemRoot
  const system = root ? join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : undefined
  const command = system && existsSync(system) ? system : locate("powershell.exe")
  return new ProcessDriver(
    command ?? "powershell.exe",
    (parentPid) => [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      powershell(parentPid),
    ],
    command !== undefined,
    "PowerShell is not available",
  )
}

class UnsupportedDriver implements CaffeinationDriver {
  readonly available = false
  readonly reason = `Caffeination is not supported on ${process.platform}`

  start(): Promise<void> {
    return Promise.reject(new Error(this.reason))
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }
}

export function createCaffeinationDriver(): CaffeinationDriver {
  if (process.platform === "darwin") return mac()
  if (process.platform === "linux") return linux()
  if (process.platform === "win32") return windows()
  return new UnsupportedDriver()
}
