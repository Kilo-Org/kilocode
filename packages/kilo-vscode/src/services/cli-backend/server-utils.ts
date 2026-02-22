import { spawn, type ChildProcess } from "child_process"

/**
 * Parse the port number from CLI server startup output.
 * Matches lines like: "kilo server listening on http://127.0.0.1:12345"
 * Returns the port number or null if not found.
 */
export function parseServerPort(output: string): number | null {
  const match = output.match(/listening on http:\/\/[\w.]+:(\d+)/)
  if (!match) return null
  return parseInt(match[1]!, 10)
}

export function buildKillTreeCommand(pid: number, platform = process.platform): { command: string; args: string[] } {
  if (platform === "win32") {
    return {
      command: "taskkill",
      args: ["/pid", String(pid), "/f", "/t"],
    }
  }
  return {
    command: "kill",
    args: ["-TERM", `-${pid}`],
  }
}

function spawnKillCommand(command: string, args: string[]): void {
  const child = spawn(command, args, { stdio: "ignore" })
  // Prevent unhandled "error" events if the kill utility is unavailable.
  child.once("error", () => {})
  child.unref()
}

export function killProcessTree(proc: ChildProcess): void {
  const pid = proc.pid
  if (!pid) return

  if (process.platform === "win32") {
    const command = buildKillTreeCommand(pid, "win32")
    spawnKillCommand(command.command, command.args)
    return
  }

  const termCommand = buildKillTreeCommand(pid, process.platform)
  spawnKillCommand(termCommand.command, termCommand.args)

  const timeout = setTimeout(() => {
    spawnKillCommand("kill", ["-KILL", `-${pid}`])
  }, 1000)
  timeout.unref()
}
