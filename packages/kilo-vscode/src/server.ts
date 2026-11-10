// Starts and stops the Kilo v2 server. `serve --stdio` prints one JSON line with the URL and exits when its stdin
// closes, so the open stdin pipe is the process lifetime. There is no parent PID watchdog on v2.
import type { ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { launch } from "./process"

export type Command = { cmd: string; args: string[]; env: Record<string, string> }
export type Server = { url: string; authorization: string; process: ChildProcess }

const ARGS = ["serve", "--port", "0", "--stdio"]
const TIMEOUT = 60_000
/** The longest first start while the server reports Kilo v1 import progress. */
const IMPORT_LIMIT = 30 * 60_000
const OUTPUT_LIMIT = 4096
const RETRY = 10_000

/** Variables that only the v1 CLI reads. */
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

/**
 * Inherited server passwords. `OPENCODE_PASSWORD` outranks the generated one, and `serve --stdio` removes only the
 * two `OPENCODE_*` names before tools start, so an inherited `KILO_SERVER_PASSWORD` would reach every tool.
 */
const PASSWORDS = ["OPENCODE_PASSWORD", "OPENCODE_SERVER_PASSWORD", "KILO_SERVER_PASSWORD"]

/**
 * Names the extension owns from the Kilo settings (`settingsEnvironment`). An inherited value must not mask the
 * setting, so drop it here and set it again in `extra`. The Claude Code `*_SKILLS` names and `NODE_EXTRA_CA_CERTS` are
 * not owned, so an inherited value passes through as in v1.
 */
const MANAGED = ["KILO_DISABLE_CLAUDE_CODE", "OPENCODE_DISABLE_CLAUDE_CODE"]

/**
 * The Integrated Browser and notebook endpoints are this host's private brokers. An inherited value would point
 * tools at another host's broker, or leave them enabled when the feature is off here.
 */
const BROWSER = ["KILO_BROWSER_BROKER_URL", "KILO_BROWSER_BROKER_TOKEN"]
const NOTEBOOK = ["KILO_NOTEBOOK_BROKER_URL", "KILO_NOTEBOOK_BROKER_TOKEN"]

/**
 * The bundled `bin/kilo2` when it exists. Otherwise, in a repository checkout, the isolated dev entry
 * `script/dev-isolated.ts` with its own profile: `KILO_V2_PROFILE`, or a `profile` directory in the extension storage.
 */
export function command(input: {
  extension: string
  storage: string
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): Command | undefined {
  const platform = input.platform ?? process.platform
  const bin = path.join(input.extension, "bin", platform === "win32" ? "kilo2.exe" : "kilo2")
  if (existsSync(bin)) return { cmd: bin, args: ARGS, env: {} }
  const script = path.join(input.extension, "..", "..", "script", "dev-isolated.ts")
  if (!existsSync(script)) return undefined
  return {
    cmd: bun(input.env, platform),
    args: [script, ...ARGS],
    env: { KILO_V2_PROFILE: input.env.KILO_V2_PROFILE ?? path.join(input.storage, "profile") },
  }
}

/** The home directory the server reads (`Global.home`). The isolated dev profile moves it into the profile. */
export function serverHome(cmd: Command | undefined, env: NodeJS.ProcessEnv): string {
  const profile = cmd?.env.KILO_V2_PROFILE
  if (profile) return path.join(path.resolve(profile), "home")
  return env.OPENCODE_TEST_HOME ?? homedir()
}

export function environment(base: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(base).filter(
        ([key]) =>
          !V1_ONLY.includes(key) &&
          !PASSWORDS.includes(key) &&
          !MANAGED.includes(key) &&
          !BROWSER.includes(key) &&
          !NOTEBOOK.includes(key),
      ),
    ),
    // The server trusts the OS certificate store, as VS Code does by default.
    NODE_USE_SYSTEM_CA: base.NODE_USE_SYSTEM_CA ?? "1",
    KILO_CLIENT: "vscode",
    // The indexing plugin gates on machine-local project consent only when the server runs for VS Code.
    KILO_PLATFORM: "vscode",
    // This extension answers the Agent Manager RPC, so it advertises the agent_manager tool.
    KILO_AGENT_MANAGER_HOST: "1",
    ...extra,
  }
}

/**
 * The server environment derived from the Kilo VS Code settings. The CLI reads the `KILO_` names and translates them
 * to the `OPENCODE_` names the runtime reads, so the server starts with Claude Code loading off by default. A changed
 * value applies on the next start, which the extension host triggers by stopping the server.
 */
export function settingsEnvironment(values: {
  claudeCodeCompat: boolean
  extraCaCerts: string
}): Record<string, string> {
  const extraCaCerts = values.extraCaCerts.trim()
  return {
    ...(values.claudeCodeCompat ? {} : { KILO_DISABLE_CLAUDE_CODE: "true" }),
    ...(extraCaCerts.length > 0 ? { NODE_EXTRA_CA_CERTS: extraCaCerts } : {}),
  }
}

/** The indexing server gate: without a workspace folder the server must not index anything. */
export function indexingEnvironment(folders: number | undefined): Record<string, string> {
  return folders && folders > 0 ? {} : { KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" }
}

/** The URL from the first complete JSON line `{"url":"http://127.0.0.1:<port>"}`. */
export function parse(output: string) {
  return output
    .split(/\r?\n/)
    .slice(0, -1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => url(line))
    .find((value) => value !== undefined)
}

export function start(input: {
  command: Command
  cwd: string
  env: NodeJS.ProcessEnv
  settings?: Record<string, string>
  log?: (text: string) => void
  onImport?: (event: ImportEvent) => void
  onExit?: (child: ChildProcess) => void
}): Promise<Server> {
  const password = randomBytes(32).toString("hex")
  mkdirSync(input.cwd, { recursive: true })
  const child = launch(input.command.cmd, input.command.args, {
    cwd: input.cwd,
    // `serve --stdio` removes OPENCODE_PASSWORD from its own environment before it starts tools.
    // dev-isolated.ts runs the CLI in INIT_CWD, which `bun run extension` leaves set to the caller's folder.
    env: environment(input.env, {
      ...input.command.env,
      ...input.settings,
      OPENCODE_PASSWORD: password,
      INIT_CWD: input.cwd,
    }),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })
  const ready = Promise.withResolvers<Server>()
  const state = { output: "", errors: [] as string[], pending: "", done: false, started: false }
  const fail = (message: string) => {
    if (state.done) return
    state.done = true
    clearTimeout(timer.id)
    ready.reject(new Error([message, ...state.errors.slice(-20)].join("\n").trim()))
  }
  const expire = () => {
    fail(`The Kilo server did not start or report progress within ${TIMEOUT / 1000} seconds.`)
    stop(child)
  }
  const timer = { id: setTimeout(expire, TIMEOUT) }
  const deadline = Date.now() + IMPORT_LIMIT

  child.stdout?.on("data", (chunk: Buffer) => {
    state.output = (state.output + chunk.toString()).slice(-OUTPUT_LIMIT)
    const found = parse(state.output)
    if (!found || state.done) return
    state.done = true
    state.started = true
    clearTimeout(timer.id)
    ready.resolve({
      url: found,
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      process: child,
    })
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    input.log?.(text)
    // The first start imports the Kilo v1 sessions before the server listens and reports progress every few seconds.
    // Lines are buffered, because a chunk can split one. The start times out when the progress stops, and in any case
    // after IMPORT_LIMIT. A server that waits for another process's import also reports; the CLI takes the import over
    // when that process stops making progress.
    state.pending += text
    const lines = state.pending.split(/\r?\n/)
    state.pending = lines.pop() ?? ""
    for (const line of lines) {
      const event = importEvent(line)
      if (!event) continue
      input.onImport?.(event)
      const left = deadline - Date.now()
      if (!state.done && left > 0) {
        clearTimeout(timer.id)
        timer.id = setTimeout(expire, Math.min(TIMEOUT, left))
      }
    }
    // Only startup errors are reported; keep the tail and stop collecting once the server is ready.
    if (!state.done) state.errors = [...state.errors.slice(-19), text]
  })
  child.on("error", (error) => fail(`The Kilo server could not start: ${error.message}`))
  child.on("exit", (code, signal) => {
    if (state.started) input.onExit?.(child)
    fail(`The Kilo server exited during startup (${signal ?? `code ${code}`}).`)
  })
  return ready.promise
}

/** One line of progress from the Kilo v1 session import the CLI host runs before the server starts. */
export type ImportEvent =
  | { kind: "start" }
  | { kind: "waiting" }
  | { kind: "progress"; imported: number; total: number }
  | { kind: "done"; imported: number }
  | { kind: "failed" }

const IMPORT = "kilo2: importing Kilo v1 sessions"

/** Reads one complete stderr line of the import; undefined for every other line. */
export function importEvent(line: string): ImportEvent | undefined {
  if (!line.includes(IMPORT)) return undefined
  if (line.includes("failed,")) return { kind: "failed" }
  if (line.includes("waiting for it")) return { kind: "waiting" }
  const done = /done, (\d+) sessions/.exec(line)
  if (done) return { kind: "done", imported: Number(done[1]) }
  const progress = /^kilo2: importing Kilo v1 sessions (\d+)\/(\d+)$/.exec(line)
  if (progress) return { kind: "progress", imported: Number(progress[1]), total: Number(progress[2]) }
  return { kind: "start" }
}

/** Closes stdin, which stops the server. Signals the process group only when it does not exit in time. */
export function stop(child: ChildProcess) {
  child.stdin?.end()
  if (child.exitCode !== null || child.signalCode !== null) return
  const term = setTimeout(() => signal(child, "SIGTERM"), 2_000)
  const force = setTimeout(() => signal(child, "SIGKILL"), 7_000)
  term.unref()
  force.unref()
  child.once("exit", () => {
    clearTimeout(term)
    clearTimeout(force)
  })
}

/**
 * One server per extension host, started on first use and again after it exits. A failed start is kept for `retry`
 * milliseconds, because every webview request and event stream reconnect would start another server. `onError`
 * reports the first failure after a start or Restart Server. `settings` may be a function so a start after a settings
 * change reads the current values.
 */
export function manager(input: {
  command: () => Command | undefined
  cwd: string
  env: NodeJS.ProcessEnv
  settings?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  log?: (text: string) => void
  onError?: (error: Error) => void
  onStart?: (server: Server) => void
  onImport?: (event: ImportEvent) => void
  onStop?: () => void
  retry?: number
}) {
  const state: { current?: Promise<Server>; failed: boolean } = { failed: false }
  const boot = () => {
    const promise = (async () => {
      const found = input.command()
      if (!found)
        throw new Error("No Kilo v2 server found. Put a kilo2 binary in bin/ or run the extension from the repository.")
      // Settings may await host work, such as the loopback notebook and Integrated Browser broker endpoints.
      const settings = typeof input.settings === "function" ? await input.settings() : input.settings
      return start({
        command: found,
        cwd: input.cwd,
        env: input.env,
        settings,
        log: input.log,
        onImport: input.onImport,
        onExit: () => {
          if (state.current !== promise) return
          state.current = undefined
          input.onStop?.()
        },
      })
    })()
    promise.then(
      (server) => {
        state.failed = false
        if (state.current === promise) input.onStart?.(server)
      },
      (error: Error) => {
        if (!state.failed) input.onError?.(error)
        state.failed = true
        const timer = setTimeout(() => {
          if (state.current === promise) state.current = undefined
        }, input.retry ?? RETRY)
        timer.unref()
      },
    )
    return promise
  }
  return {
    get() {
      state.current ??= boot()
      return state.current
    },
    stop() {
      const current = state.current
      state.current = undefined
      state.failed = false
      if (current) input.onStop?.()
      return current?.then(
        (server) => stop(server.process),
        () => undefined,
      )
    },
  }
}

export type Manager = ReturnType<typeof manager>

function url(line: string) {
  const value = json(line)
  if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string") return undefined
  return URL.canParse(value.url) ? value.url : undefined
}

// Other stdout lines can start with "{" too; a line that is not JSON is not the URL line.
function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function signal(child: ChildProcess, name: NodeJS.Signals) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  if (process.platform === "win32") return void child.kill(name)
  process.kill(-child.pid, name)
}

function bun(env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  const file = path.join(
    env.BUN_INSTALL ?? path.join(homedir(), ".bun"),
    "bin",
    platform === "win32" ? "bun.exe" : "bun",
  )
  return existsSync(file) ? file : "bun"
}
