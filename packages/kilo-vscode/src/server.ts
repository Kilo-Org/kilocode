// Starts and stops the Kilo v2 server. `serve --stdio` prints one JSON line with the URL and exits when its stdin
// closes, so the open stdin pipe is the process lifetime. There is no parent PID watchdog on v2.
import type { ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { local } from "./local"
import { launch } from "./process"
import { dataPlans } from "./documents/document-reader"

export type Command = { cmd: string; args: string[]; env: Record<string, string> }
export type Server = { url: string; authorization: string; process: ChildProcess }

const ARGS = ["serve", "--port", "0", "--stdio"]
const TIMEOUT = 60_000
const OUTPUT_LIMIT = 4096
const RETRY = 10_000
const IDENTITY = 5_000
/** Attempts per printed URL: a transient failure must not discard the line the server just printed. */
const VERIFY_ATTEMPTS = 2
const VERIFY_RETRY = 500
/** The stdio server binds a numeric loopback address; the credential goes only to these. */
const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]"])
const JSON_TYPE = /^application\/(?:[\w.-]+\+)?json\b/i

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

/** The global plan directory the server writes. The isolated dev profile moves the data directory into the profile. */
export function serverPlans(cmd: Command | undefined, env: NodeJS.ProcessEnv): string {
  const profile = cmd?.env.KILO_V2_PROFILE
  if (profile) return path.join(path.resolve(profile), "data", "kilo2", "plans")
  return dataPlans(env)
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
 * The server environment derived from the Kilo VS Code settings and the running editor. The CLI reads the `KILO_`
 * names and translates them to the `OPENCODE_` names the runtime reads, so the server starts with Claude Code loading
 * off by default. A changed value applies on the next start, which the extension host triggers by stopping the server.
 */
export function settingsEnvironment(values: {
  claudeCodeCompat: boolean
  extraCaCerts: string
  editor: string
}): Record<string, string> {
  const extraCaCerts = values.extraCaCerts.trim()
  return {
    // v1 `services/cli-backend/server-manager.ts` reported the editor as `${vscode.env.appName} ${vscode.version}`,
    // which the Gateway stores as `X-KILOCODE-EDITORNAME`.
    KILOCODE_EDITOR_NAME: values.editor,
    ...(values.claudeCodeCompat ? {} : { KILO_DISABLE_CLAUDE_CODE: "true" }),
    ...(extraCaCerts.length > 0 ? { NODE_EXTRA_CA_CERTS: extraCaCerts } : {}),
  }
}

/** The indexing server gate: without a workspace folder the server must not index anything. */
export function indexingEnvironment(folders: number | undefined): Record<string, string> {
  return folders && folders > 0 ? {} : { KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" }
}

/** Every complete URL line, in the order it was printed. */
function candidates(output: string) {
  return output
    .split(/\r?\n/)
    .slice(0, -1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => url(line))
    .filter((value) => value !== undefined)
}

type Answer =
  | { ok: true }
  | { ok: false; failure: string; status?: number; json?: boolean }

/**
 * One GET of `/api/info` from the printed server with the given credential. The body is discarded: the credential this
 * child alone was given is the identity, and an unverified server must not make the extension host buffer a document.
 */
async function call(target: URL, authorization: string): Promise<Answer> {
  const response = await local(target, {
    headers: { authorization },
    signal: AbortSignal.timeout(IDENTITY),
  }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
  if (response instanceof Error) return { ok: false, failure: response.message }
  const type = response.headers.get("content-type") ?? ""
  const json = JSON_TYPE.test(type)
  await response.body?.cancel().catch(() => undefined)
  if (response.status !== 200 || !json)
    return {
      ok: false,
      failure: `${target.pathname} returned ${response.status} (${type || "no content type"})`,
      status: response.status,
      json,
    }
  return { ok: true }
}

/**
 * Confirms a printed URL is the server this extension started: it must refuse a wrong credential the way the Kilo
 * server does, and accept the one only that child was given, as JSON. Returns why it does not, or undefined when it
 * does.
 */
async function verify(url: string, authorization: string) {
  const base = URL.canParse(url) ? new URL(url) : undefined
  // The stdio server binds a plain numeric loopback address; a line naming anything else must not receive the
  // credential.
  if (!base || base.protocol !== "http:" || !LOOPBACK.has(base.hostname))
    return `${url} did not answer as the Kilo server: not a loopback http address.`
  const target = new URL("/api/info", base)
  const wrong = `Basic ${Buffer.from("opencode:not-the-password").toString("base64")}`
  // A local server that answers without the generated password is not the one this child started, even when it
  // serves the same JSON document.
  const probe = await call(target, wrong)
  if (probe.ok) return `${url} did not answer as the Kilo server: /api/info accepted a wrong credential.`
  // Only a server that refuses the credential the way the Kilo server does (a JSON 401) may receive the generated
  // one. Any other answer is an unrelated service, and its request log would keep the header.
  if (probe.status !== 401 || probe.json !== true)
    return `${url} did not answer as the Kilo server: ${probe.failure}.`
  const answer = await call(target, authorization)
  if (!answer.ok) return `${url} did not answer as the Kilo server: ${answer.failure}.`
  return undefined
}

export function start(input: {
  command: Command
  cwd: string
  env: NodeJS.ProcessEnv
  settings?: Record<string, string>
  log?: (text: string) => void
  onExit?: (child: ChildProcess) => void
}): Promise<Server> {
  const password = randomBytes(32).toString("hex")
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
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
  const state = {
    output: "",
    errors: [] as string[],
    done: false,
    started: false,
    verifying: false,
    tried: new Set<string>(),
    attempts: new Map<string, number>(),
    seen: new Set<string>(),
    retry: undefined as ReturnType<typeof setTimeout> | undefined,
  }
  const fail = (message: string) => {
    if (state.done) return
    state.done = true
    clearTimeout(timer)
    clearTimeout(state.retry)
    ready.reject(new Error([message, ...state.errors.slice(-20)].join("\n").trim()))
  }
  // A printed URL is used only once `/api/info` answers with the password this child alone was given. A line printed
  // by anything else on stdout (a plugin or MCP server that logs one) names a server the webviews must not read: the
  // client only reports an unreadable response, and both views keep it until the window reloads.
  const identify = async () => {
    if (state.done || state.verifying) return
    const all = candidates(state.output)
    const found = all.find((value) => !state.tried.has(value) && !state.seen.has(value))
    if (found === undefined) {
      // Every candidate of this pass failed. A transient failure must not discard the line the server printed, so
      // retry the candidates that still have an attempt left; a later line starts the next pass at once.
      if (!all.some((value) => !state.tried.has(value))) return
      state.seen.clear()
      clearTimeout(state.retry)
      state.retry = setTimeout(() => {
        if (state.done || state.verifying) return
        void identify()
      }, VERIFY_RETRY)
      return
    }
    state.seen.add(found)
    state.verifying = true
    // A candidate that throws is a candidate that failed: releasing the guard lets a later line be read.
    const failure = await verify(found, authorization).catch((error: unknown) => {
      return `${found} did not answer as the Kilo server: ${error instanceof Error ? error.message : String(error)}`
    })
    state.verifying = false
    if (state.done) return
    if (failure !== undefined) {
      // Another line may still name the server this child started; the start fails on exit or the timeout above.
      const attempts = (state.attempts.get(found) ?? 0) + 1
      state.attempts.set(found, attempts)
      if (attempts >= VERIFY_ATTEMPTS) state.tried.add(found)
      state.errors = [...state.errors.slice(-19), failure]
      return void identify()
    }
    state.done = true
    state.started = true
    clearTimeout(timer)
    clearTimeout(state.retry)
    ready.resolve({ url: found, authorization, process: child })
  }
  const timer = setTimeout(() => {
    fail(`The Kilo server did not start within ${TIMEOUT / 1000} seconds.`)
    stop(child)
  }, TIMEOUT)

  child.stdout?.on("data", (chunk: Buffer) => {
    state.output = (state.output + chunk.toString()).slice(-OUTPUT_LIMIT)
    void identify()
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    input.log?.(text)
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
