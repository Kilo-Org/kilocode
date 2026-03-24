import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { createKiloServer, type ServerResult } from "@kilocode/sdk/v2/server"

export interface ServerInstance {
  port: number
  password: string
  /** PID of the spawned CLI process, used for process-group cleanup. */
  pid: number | undefined
  /** Collected stderr output from CLI startup — surfaced to the user on failure. */
  stderr: string
  /** Kill the CLI server process via the SDK handle. */
  close(): void
}

const STARTUP_TIMEOUT_SECONDS = 30

export class ServerManager {
  private instance: ServerInstance | null = null
  private startupPromise: Promise<ServerInstance> | null = null

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Get or start the server instance
   */
  async getServer(): Promise<ServerInstance> {
    console.log("[Kilo New] ServerManager: 🔍 getServer called")
    if (this.instance) {
      console.log("[Kilo New] ServerManager: ♻️ Returning existing instance:", { port: this.instance.port })
      return this.instance
    }

    if (this.startupPromise) {
      console.log("[Kilo New] ServerManager: ⏳ Startup already in progress, waiting...")
      return this.startupPromise
    }

    console.log("[Kilo New] ServerManager: 🚀 Starting new server instance...")
    this.startupPromise = this.startServer()
    try {
      this.instance = await this.startupPromise
      console.log("[Kilo New] ServerManager: ✅ Server started successfully:", { port: this.instance.port })
      return this.instance
    } finally {
      this.startupPromise = null
    }
  }

  private async startServer(): Promise<ServerInstance> {
    const password = crypto.randomBytes(32).toString("hex")
    const cliPath = this.getCliPath()
    console.log("[Kilo New] ServerManager: 📍 CLI path:", cliPath)
    console.log("[Kilo New] ServerManager: 🔐 Generated password (length):", password.length)

    // Verify the CLI binary exists
    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `CLI binary not found at expected path: ${cliPath}. Please ensure the CLI is built and bundled with the extension.`,
      )
    }

    const stat = fs.statSync(cliPath)
    console.log("[Kilo New] ServerManager: 📄 CLI isFile:", stat.isFile())
    console.log("[Kilo New] ServerManager: 📄 CLI mode (octal):", (stat.mode & 0o777).toString(8))

    console.log("[Kilo New] ServerManager: 🎬 Starting CLI server via SDK:", cliPath)
    const claudeCompat = vscode.workspace.getConfiguration("kilo-code.new").get<boolean>("claudeCodeCompat", false)
    // Pin cwd so the CLI doesn't inherit the extension host's cwd ("/" under F5 debug)
    const spawnCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME ?? require("os").homedir()

    let result: ServerResult
    try {
      result = await createKiloServer({
        command: cliPath,
        port: 0,
        timeout: STARTUP_TIMEOUT_SECONDS * 1000,
        env: {
          // Force mimalloc (the allocator Bun ships with) to return freed pages
          // to the OS immediately instead of retaining them in its arenas.
          // Without this, Bun.spawn's piped stdio accumulates ~2 MB of native
          // RSS per call on Windows, causing the Agent Manager (which polls git
          // once per second per worktree) to reach multi-GB RSS in minutes.
          // See oven-sh/bun#18265 and Jarred's workaround note in #21560.
          MIMALLOC_PURGE_DELAY: "0",
          KILO_SERVER_PASSWORD: password,
          KILO_CLIENT: "vscode",
          KILO_ENABLE_QUESTION_TOOL: "true",
          KILOCODE_FEATURE: "vscode-extension",
          KILO_TELEMETRY_LEVEL: vscode.env.isTelemetryEnabled ? "all" : "off",
          KILO_APP_NAME: "kilo-code",
          KILO_EDITOR_NAME: vscode.env.appName,
          KILO_PLATFORM: "vscode",
          KILO_MACHINE_ID: vscode.env.machineId,
          KILO_APP_VERSION: this.context.extension.packageJSON.version,
          KILO_VSCODE_VERSION: vscode.version,
          KILOCODE_EDITOR_NAME: `${vscode.env.appName} ${vscode.version}`,
          ...(!claudeCompat && { KILO_DISABLE_CLAUDE_CODE: "true" }),
        },
        spawnOptions: {
          cwd: spawnCwd,
          detached: true,
          windowsHide: true,
        },
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // The SDK error may contain stderr; split it into lines for toErrorMessage
      const lines = msg.includes("\n") ? msg.split("\n") : [msg]
      const { userMessage, userDetails } = toErrorMessage(lines[0] ?? msg, lines, cliPath)
      throw new ServerStartupError(userMessage, userDetails)
    }

    console.log("[Kilo New] ServerManager: 📦 Process spawned with PID:", result.pid)
    console.log("[Kilo New] ServerManager: 🎯 Port detected:", result.port)

    return {
      port: result.port,
      password,
      pid: result.pid,
      stderr: result.stderr,
      close: result.close,
    }
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const binName = process.platform === "win32" ? "kilo.exe" : "kilo"
    const cliPath = path.join(this.context.extensionPath, "bin", binName)
    console.log("[Kilo New] ServerManager: 📦 Using CLI path:", cliPath)
    return cliPath
  }

  /**
   * Kill a process and its entire process group by PID.
   * On Unix, we send the signal to -pid (negative) to reach the whole group,
   * mirroring the desktop app's ProcessGroup::leader() + start_kill() pattern.
   * On Windows, process.kill() on the PID is sufficient.
   */
  private static killByPid(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
    try {
      if (process.platform !== "win32") {
        // Negative PID targets the entire process group
        process.kill(-pid, signal)
      } else {
        process.kill(pid, signal)
      }
    } catch {
      // Process already gone — ignore
    }
  }

  /**
   * Check whether the process is still running.
   */
  private static isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  dispose(): void {
    if (!this.instance) {
      return
    }
    const { pid, close } = this.instance
    this.instance = null

    console.log("[Kilo New] ServerManager: 🔴 Disposing — sending SIGTERM to process group, PID:", pid)

    if (pid !== undefined) {
      ServerManager.killByPid(pid, "SIGTERM")
    } else {
      // Fallback: use the SDK close() if PID is unavailable
      close()
    }

    // SIGKILL fallback after 5s: mirrors the desktop app going straight to
    // start_kill(). Ensures the process tree dies even if SIGTERM is ignored
    // or Instance.disposeAll() hangs past the serve.ts shutdown timeout.
    if (pid !== undefined) {
      const timer = setTimeout(() => {
        if (ServerManager.isAlive(pid)) {
          console.warn("[Kilo New] ServerManager: ⚠️ Process did not exit after SIGTERM, sending SIGKILL")
          ServerManager.killByPid(pid, "SIGKILL")
        }
      }, 5000)
      // unref so this timer doesn't prevent the extension host from exiting
      timer.unref()
    }
  }
}

export class ServerStartupError extends Error {
  readonly userMessage: string
  readonly userDetails: string
  constructor(userMessage: string, userDetails: string) {
    super(userDetails)
    this.name = "ServerStartupError"
    this.userMessage = userMessage
    this.userDetails = userDetails
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

export function toErrorMessage(
  error: string,
  stderrLines: string[],
  cliPath?: string,
): {
  userMessage: string
  userDetails: string
  error: string
} {
  let lines = stderrLines.flatMap((line) => line.split("\n"))

  const errorLine = lines.map(stripAnsi).find((line) => /Error:\s+/.test(line))
  const userMessage = errorLine
    ? (errorLine.match(/Error:\s+(.+)/)?.[1]?.trim() ?? errorLine.trim())
    : stripAnsi([...lines].reverse().find((line) => line.trim() !== "") ?? error).trim()

  lines = [error, ...lines]
  if (cliPath && cliPath.trim() !== "") {
    lines = [`CLI path: ${cliPath}`, ...lines]
  }

  const detailsText = lines.map(stripAnsi).join("\n").trim()

  return {
    userMessage,
    userDetails: detailsText,
    error,
  }
}
