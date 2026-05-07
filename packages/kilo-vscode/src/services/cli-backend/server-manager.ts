import { type ChildProcess } from "child_process"
import { spawn } from "../../util/process"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { t } from "./i18n"
import { parseServerPort } from "./server-utils"

export interface ServerInstance {
  port: number
  password: string
  process: ChildProcess
}

const STARTUP_TIMEOUT_SECONDS = 30

type WorkspaceFolderLike = { uri: { fsPath: string } }

export function resolveServerCwd(folders: readonly WorkspaceFolderLike[] | undefined, storage: string): string {
  return folders?.[0]?.uri.fsPath ?? storage
}

export function resolveIndexingEnv(folders: readonly WorkspaceFolderLike[] | undefined): Record<string, string> {
  if (folders && folders.length > 0) return {}
  return { KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" }
}

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

    return new Promise((resolve, reject) => {
      console.log("[Kilo New] ServerManager: 🎬 Spawning CLI process:", cliPath, ["serve", "--port", "0"])
      const cfg = vscode.workspace.getConfiguration("kilo-code.new")
      const claudeCompat = cfg.get<boolean>("claudeCodeCompat", false)
      // Pin cwd so the CLI doesn't inherit the extension host's cwd ("/" under F5 debug)
      // or "$HOME" in empty VS Code windows.
      const folders = vscode.workspace.workspaceFolders
      const spawnCwd = resolveServerCwd(folders, this.context.globalStorageUri.fsPath)
      fs.mkdirSync(spawnCwd, { recursive: true })
      const indexingEnv = resolveIndexingEnv(folders)
      // TLS / corporate-proxy support:
      //   - Default NODE_USE_SYSTEM_CA=1 so the bundled Bun CLI trusts the OS
      //     trust store (Windows cert store, macOS keychain, Linux /etc/ssl).
      //     Mirrors VS Code's `http.systemCertificates` default (true).
      //   - Allow users behind MITM proxies to point at a custom CA bundle via
      //     `kilo-code.new.extraCaCerts` (NODE_EXTRA_CA_CERTS).
      //   - Honor VS Code's `http.proxyStrictSSL=false` as an explicit opt-out
      //     from verification, matching what VS Code already does for its own
      //     requests. Users explicitly set that; we don't flip it ourselves.
      // All three are overridable by the user's environment.
      const extraCaCerts = cfg.get<string>("extraCaCerts", "").trim()
      const proxyStrictSSL = vscode.workspace.getConfiguration("http").get<boolean>("proxyStrictSSL", true)
      const serverProcess = spawn(cliPath, ["serve", "--port", "0"], {
        cwd: spawnCwd,
        env: {
          NODE_USE_SYSTEM_CA: "1",
          ...(extraCaCerts && { NODE_EXTRA_CA_CERTS: extraCaCerts }),
          ...(!proxyStrictSSL && { NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
          ...process.env,
          // VS Code's http.proxy / http.noProxy settings are not reflected in
          // process.env, so spawned children bypass the user's configured proxy
          // and fail behind corporate firewalls. Forward them as the standard
          // HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars that Bun's fetch and
          // most HTTP clients already respect.
          ...buildProxyEnv(),
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
          ...indexingEnv,
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
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      })
      console.log("[Kilo New] ServerManager: 📦 Process spawned with PID:", serverProcess.pid)

      let resolved = false
      const stderrLines: string[] = []

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        console.log("[Kilo New] ServerManager: 📥 CLI Server stdout:", output)

        const port = parseServerPort(output)
        if (port !== null && !resolved) {
          resolved = true
          console.log("[Kilo New] ServerManager: 🎯 Port detected:", port)
          resolve({ port, password, process: serverProcess })
        }
      })

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const errorOutput = data.toString()
        console.error("[Kilo New] ServerManager: ⚠️ CLI Server stderr:", errorOutput)
        stderrLines.push(errorOutput)
      })

      serverProcess.on("error", (error) => {
        console.error("[Kilo New] ServerManager: ❌ Process error:", error)
        if (!resolved) {
          reject(error)
        }
      })

      serverProcess.on("exit", (code) => {
        console.log("[Kilo New] ServerManager: 🛑 Process exited with code:", code)
        if (this.instance?.process === serverProcess) {
          this.instance = null
        }
        if (!resolved) {
          const { userMessage, userDetails } = toErrorMessage(
            t("server.processExited", { code: code ?? "null" }),
            stderrLines,
            cliPath,
          )
          reject(new ServerStartupError(userMessage, userDetails))
        }
      })

      setTimeout(() => {
        if (!resolved) {
          console.error(`[Kilo New] ServerManager: ⏰ Server startup timeout (${STARTUP_TIMEOUT_SECONDS}s)`)
          ServerManager.killProcess(serverProcess)
          const { userMessage, userDetails } = toErrorMessage(
            t("server.startupTimeout", { seconds: STARTUP_TIMEOUT_SECONDS }),
            stderrLines,
            cliPath,
          )
          reject(new ServerStartupError(userMessage, userDetails))
        }
      }, STARTUP_TIMEOUT_SECONDS * 1000)
    })
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const binName = process.platform === "win32" ? "kilo.exe" : "kilo"
    const cliPath = path.join(this.context.extensionPath, "bin", binName)
    console.log("[Kilo New] ServerManager: 📦 Using CLI path:", cliPath)
    return cliPath
  }

  /**
   * Kill a process and its entire process group.
   * On Unix, we send the signal to -pid (negative) to reach the whole group.
   * On Windows, process.kill() on the child handle is sufficient.
   */
  private static killProcess(proc: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
    if (proc.pid === undefined) {
      return
    }
    try {
      if (process.platform !== "win32") {
        // Negative PID targets the entire process group
        process.kill(-proc.pid, signal)
      } else {
        proc.kill(signal)
      }
    } catch {
      // Process already gone — ignore
    }
  }

  dispose(): void {
    if (!this.instance) {
      return
    }
    const proc = this.instance.process
    this.instance = null

    console.log("[Kilo New] ServerManager: 🔴 Disposing — sending SIGTERM to process group, PID:", proc.pid)
    ServerManager.killProcess(proc, "SIGTERM")

    // SIGKILL fallback after 5s. Ensures the process tree dies even if SIGTERM is ignored
    // or Instance.disposeAll() hangs past the serve.ts shutdown timeout.
    const timer = setTimeout(() => {
      if (proc.exitCode === null) {
        console.warn("[Kilo New] ServerManager: ⚠️ Process did not exit after SIGTERM, sending SIGKILL")
        ServerManager.killProcess(proc, "SIGKILL")
      }
    }, 5000)
    // unref so this timer doesn't prevent the extension host from exiting
    timer.unref()
    proc.on("exit", () => clearTimeout(timer))
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

/**
 * Translate VS Code's `http.proxy` / `http.noProxy` / `http.proxySupport`
 * settings into the standard proxy env vars, so the spawned CLI honors the
 * user's proxy configuration. Returns an empty object when no override is
 * needed, so callers can spread unconditionally.
 *
 * `http.proxySupport: "off"` is VS Code's opt-in way to disable proxy support
 * entirely; when set, we explicitly clear the env vars so ambient shell
 * HTTP_PROXY/http_proxy doesn't leak into the spawned child.
 */
export function buildProxyEnv(): Record<string, string> {
  const httpConfig = vscode.workspace.getConfiguration("http")
  const proxyInfo = httpConfig.inspect<string>("proxy")
  const noProxyInfo = httpConfig.inspect<string[]>("noProxy")
  const proxySupport = httpConfig.get<string>("proxySupport")

  if (proxySupport === "off") {
    return { HTTP_PROXY: "", HTTPS_PROXY: "", NO_PROXY: "", http_proxy: "", https_proxy: "", no_proxy: "" }
  }

  const proxy = httpConfig.get<string>("proxy")
  const noProxy = httpConfig.get<string[]>("noProxy")
  const proxySet =
    proxyInfo !== undefined &&
    [
      proxyInfo.globalValue,
      proxyInfo.workspaceValue,
      proxyInfo.workspaceFolderValue,
      proxyInfo.globalLanguageValue,
      proxyInfo.workspaceLanguageValue,
      proxyInfo.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined)
  const noProxySet =
    noProxyInfo !== undefined &&
    [
      noProxyInfo.globalValue,
      noProxyInfo.workspaceValue,
      noProxyInfo.workspaceFolderValue,
      noProxyInfo.globalLanguageValue,
      noProxyInfo.workspaceLanguageValue,
      noProxyInfo.workspaceFolderLanguageValue,
    ].some((value) => value !== undefined)
  const env: Record<string, string> = {}
  if (proxy && proxy.trim() !== "") {
    env.HTTP_PROXY = proxy
    env.HTTPS_PROXY = proxy
    env.http_proxy = proxy
    env.https_proxy = proxy
  }
  if (proxySet && proxy !== undefined && proxy.trim() === "") {
    env.HTTP_PROXY = ""
    env.HTTPS_PROXY = ""
    env.http_proxy = ""
    env.https_proxy = ""
  }
  if (Array.isArray(noProxy) && noProxy.length > 0) {
    env.NO_PROXY = noProxy.join(",")
    env.no_proxy = noProxy.join(",")
  }
  if (noProxySet && Array.isArray(noProxy) && noProxy.length === 0) {
    env.NO_PROXY = ""
    env.no_proxy = ""
  }
  return env
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
    ? errorLine.match(/Error:\s+(.+)/)![1].trim()
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
