import { type ChildProcess } from "child_process"
import { spawn } from "../../util/process"
import * as crypto from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { t } from "./i18n"
import { ensureServerCwd, scanServerUrl } from "./server-utils"

export interface ServerInstance {
  url: string
  password: string
  /** Basic auth header for the v2 server. The v2 user name is `opencode`. */
  authorization: string
  process: ChildProcess
}

export type ServerCommand = { cmd: string; args: string[]; env: Record<string, string> }

const STARTUP_TIMEOUT_SECONDS = 60
const STARTUP_OUTPUT_LIMIT = 4096
const ARGS = ["serve", "--port", "0", "--stdio"]

/** Variables that only the v1 CLI reads. The v2 server ignores them or (KILO_PARENT_PID) has no watchdog. */
const V1_ONLY = [
  "KILO_PARENT_PID",
  "KILO_ENABLE_QUESTION_TOOL",
  "KILO_EXPERIMENTAL_DISABLE_FILEWATCHER",
  "KILO_EXPERIMENTAL_CLAUDE_MIGRATION",
  "KILO_DISABLE_CODEBASE_INDEXING",
  "KILO_TREE_SITTER_WASM_DIR",
  "KILO_BWRAP_PATH",
  "KILO_TELEMETRY_LEVEL",
  "KILO_APP_NAME",
  "KILO_EDITOR_NAME",
  "KILO_PLATFORM",
  "KILO_APP_VERSION",
  "KILO_VSCODE_VERSION",
]

type WorkspaceFolderLike = { uri: { fsPath: string } }
type ServerExitListener = (code: number | null, signal: NodeJS.Signals | null) => void

export function resolveServerCwd(folders: readonly WorkspaceFolderLike[] | undefined, storage: string): string {
  return folders?.[0]?.uri.fsPath ?? storage
}

/**
 * The Kilo v2 server command. A bundled `bin/kilo2` when it exists. Otherwise, in a repository checkout, the isolated
 * dev entry `script/dev-isolated.ts` with its own profile: `KILO_V2_PROFILE`, or `profile` in the extension storage.
 * The installed v1 CLI and its data are never used.
 */
export function resolveServerCommand(input: {
  extension: string
  storage: string
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): ServerCommand | undefined {
  const platform = input.platform ?? process.platform
  const bin = path.join(input.extension, "bin", platform === "win32" ? "kilo2.exe" : "kilo2")
  if (fs.existsSync(bin)) return { cmd: bin, args: ARGS, env: {} }
  const script = path.join(input.extension, "..", "..", "script", "dev-isolated.ts")
  if (!fs.existsSync(script)) return undefined
  return {
    cmd: bun(input.env, platform),
    args: [script, ...ARGS],
    env: { KILO_V2_PROFILE: input.env.KILO_V2_PROFILE ?? path.join(input.storage, "profile") },
  }
}

/** The server environment: the extension host environment without v1-only variables, plus Kilo client settings. */
export function resolveServerEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(base).filter(([key]) => !V1_ONLY.includes(key))),
    // The server trusts the OS certificate store, as VS Code does by default.
    NODE_USE_SYSTEM_CA: base.NODE_USE_SYSTEM_CA ?? "1",
    KILO_CLIENT: "vscode",
    ...extra,
  }
}

export class ServerManager {
  private instance: ServerInstance | null = null
  private startupPromise: Promise<ServerInstance> | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onExit?: ServerExitListener,
    private readonly env?: () => Promise<Record<string, string>>,
  ) {}

  /**
   * Get or start the server instance
   */
  async getServer(): Promise<ServerInstance> {
    if (this.instance) return this.instance
    if (this.startupPromise) return this.startupPromise
    console.log("[Kilo New] ServerManager: Starting the Kilo v2 server")
    this.startupPromise = this.startServer()
    try {
      this.instance = await this.startupPromise
      console.log("[Kilo New] ServerManager: Server started:", { url: this.instance.url })
      return this.instance
    } finally {
      this.startupPromise = null
    }
  }

  private async startServer(): Promise<ServerInstance> {
    const password = crypto.randomBytes(32).toString("hex")
    const found = resolveServerCommand({
      extension: this.context.extensionPath,
      storage: this.context.globalStorageUri.fsPath,
      env: process.env,
    })
    if (!found) {
      throw new ServerStartupError(
        "No Kilo v2 server found.",
        "Put a kilo2 binary in bin/ or run the extension from a Kilo v2 repository checkout.",
      )
    }
    const extraEnv = await this.env?.()
    const cfg = vscode.workspace.getConfiguration("kilo-code.new")
    const claudeCompat = cfg.get<boolean>("claudeCodeCompat", false)
    // Pin cwd so the server doesn't inherit the extension host's cwd ("/" under F5 debug)
    // or "$HOME" in empty VS Code windows.
    const cwd = resolveServerCwd(vscode.workspace.workspaceFolders, this.context.globalStorageUri.fsPath)
    ensureServerCwd(cwd)
    // TLS / corporate-proxy support, as on v1: `kilo-code.new.extraCaCerts` (NODE_EXTRA_CA_CERTS) and
    // `http.proxyStrictSSL=false`. Both are overridable by the user's environment.
    const extraCaCerts = cfg.get<string>("extraCaCerts", "").trim()
    const proxyStrictSSL = vscode.workspace.getConfiguration("http").get<boolean>("proxyStrictSSL", true)
    const env = resolveServerEnv(process.env, {
      ...(extraCaCerts ? { NODE_EXTRA_CA_CERTS: extraCaCerts } : {}),
      ...(proxyStrictSSL ? {} : { NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
      // VS Code's http.proxy / http.noProxy settings are not reflected in process.env.
      ...buildProxyEnv(),
      // See oven-sh/bun#18265: return freed pages to the OS (Windows RSS growth with piped stdio).
      MIMALLOC_PURGE_DELAY: "0",
      KILOCODE_FEATURE: "vscode-extension",
      KILO_MACHINE_ID: vscode.env.machineId,
      KILOCODE_VERSION: this.context.extension.packageJSON.version,
      KILOCODE_EDITOR_NAME: `${vscode.env.appName} ${vscode.version}`,
      ...(claudeCompat ? {} : { KILO_DISABLE_CLAUDE_CODE: "true" }),
      ...found.env,
      ...extraEnv,
      KILO_SERVER_PASSWORD: password,
    })
    return launch({
      command: found,
      cwd,
      password,
      env,
      onExit: (proc, code, signal) => {
        if (this.instance?.process !== proc) return
        this.instance = null
        this.onExit?.(code, signal)
      },
    })
  }

  dispose(): void {
    if (!this.instance) return
    const proc = this.instance.process
    this.instance = null
    console.log("[Kilo New] ServerManager: Disposing, closing server stdin, PID:", proc.pid)
    stopServer(proc)
  }
}

/**
 * Spawns `serve --stdio` and resolves with the URL from its first JSON line. The open stdin pipe is the process
 * lifetime: the v2 server exits when stdin closes, so there is no parent PID watchdog on v2.
 */
export function launch(input: {
  command: ServerCommand
  cwd: string
  password: string
  env: NodeJS.ProcessEnv
  onExit?: (proc: ChildProcess, code: number | null, signal: NodeJS.Signals | null) => void
}): Promise<ServerInstance> {
  const found = input.command
  const password = input.password
  console.log("[Kilo New] ServerManager: Spawning:", found.cmd, found.args)
  const serverProcess = spawn(found.cmd, found.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })
  console.log("[Kilo New] ServerManager: Process spawned with PID:", serverProcess.pid)

  const ready = Promise.withResolvers<ServerInstance>()
  const state = { resolved: false, output: "", errors: [] as string[] }
  const fail = (message: string) => {
    if (state.resolved) return
    state.resolved = true
    clearTimeout(timer)
    const { userMessage, userDetails } = toErrorMessage(message, state.errors, found.cmd)
    ready.reject(new ServerStartupError(userMessage, userDetails))
  }
  const timer = setTimeout(() => {
    fail(t("server.startupTimeout", { seconds: STARTUP_TIMEOUT_SECONDS }))
    stopServer(serverProcess)
  }, STARTUP_TIMEOUT_SECONDS * 1000)

  serverProcess.stdout?.on("data", (data: Buffer) => {
    const scan = scanServerUrl(state.output, data.toString(), STARTUP_OUTPUT_LIMIT)
    state.output = scan.output
    if (!scan.url || state.resolved) return
    state.resolved = true
    clearTimeout(timer)
    ready.resolve({
      url: scan.url,
      password,
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      process: serverProcess,
    })
  })
  serverProcess.stderr?.on("data", (data: Buffer) => {
    const text = data.toString()
    console.error("[Kilo New] ServerManager: server stderr:", text)
    state.errors.push(text)
    if (state.errors.length > 50) state.errors.shift()
  })
  serverProcess.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[Kilo New] ServerManager: Process error:", err)
    fail(`${t("server.spawnFailed", { code: err.code || err.name || "UNKNOWN" })}\nError: ${err.message}`)
  })
  serverProcess.on("exit", (code, signal) => {
    console.warn("[Kilo New] ServerManager: Process exited:", { code, signal })
    input.onExit?.(serverProcess, code, signal)
    fail(signal ? t("server.processSignaled", { signal }) : t("server.processExited", { code: code ?? "unknown" }))
  })
  return ready.promise
}

/** Closes stdin, which stops the v2 server. Signals the process group only when it does not exit in time. */
export function stopServer(proc: ChildProcess): void {
  proc.stdin?.end()
  if (proc.exitCode !== null || proc.signalCode !== null) return
  const term = setTimeout(() => killProcess(proc, "SIGTERM"), 2_000)
  const force = setTimeout(() => killProcess(proc, "SIGKILL"), 7_000)
  term.unref()
  force.unref()
  proc.once("exit", () => {
    clearTimeout(term)
    clearTimeout(force)
  })
}

/**
 * Kill a process and its entire process group.
 * On Unix, we send the signal to -pid (negative) to reach the whole group.
 * On Windows, process.kill() on the child handle is sufficient.
 */
function killProcess(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return
  if (process.platform === "win32") {
    proc.kill(signal)
    return
  }
  try {
    process.kill(-proc.pid, signal)
  } catch (err) {
    console.warn("[Kilo New] ServerManager: process group already gone:", err)
  }
}

function bun(env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  const file = path.join(env.BUN_INSTALL ?? path.join(os.homedir(), ".bun"), "bin", platform === "win32" ? "bun.exe" : "bun")
  return fs.existsSync(file) ? file : "bun"
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
