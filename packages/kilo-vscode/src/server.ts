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

export function environment(base: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(base).filter(([key]) => !V1_ONLY.includes(key) && !PASSWORDS.includes(key))),
    // The server trusts the OS certificate store, as VS Code does by default.
    NODE_USE_SYSTEM_CA: base.NODE_USE_SYSTEM_CA ?? "1",
    KILO_CLIENT: "vscode",
    ...extra,
  }
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
  log?: (text: string) => void
  onExit?: (child: ChildProcess) => void
}): Promise<Server> {
  const password = randomBytes(32).toString("hex")
  mkdirSync(input.cwd, { recursive: true })
  const child = launch(input.command.cmd, input.command.args, {
    cwd: input.cwd,
    // `serve --stdio` removes OPENCODE_PASSWORD from its own environment before it starts tools.
    // dev-isolated.ts runs the CLI in INIT_CWD, which `bun run extension` leaves set to the caller's folder.
    env: environment(input.env, { ...input.command.env, OPENCODE_PASSWORD: password, INIT_CWD: input.cwd }),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })
  const ready = Promise.withResolvers<Server>()
  const state = { output: "", errors: [] as string[], done: false, started: false }
  const fail = (message: string) => {
    if (state.done) return
    state.done = true
    clearTimeout(timer)
    ready.reject(new Error([message, ...state.errors.slice(-20)].join("\n").trim()))
  }
  const timer = setTimeout(() => {
    fail(`The Kilo server did not start within ${TIMEOUT / 1000} seconds.`)
    stop(child)
  }, TIMEOUT)

  child.stdout?.on("data", (chunk: Buffer) => {
    state.output = (state.output + chunk.toString()).slice(-OUTPUT_LIMIT)
    const found = parse(state.output)
    if (!found || state.done) return
    state.done = true
    state.started = true
    clearTimeout(timer)
    ready.resolve({
      url: found,
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      process: child,
    })
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
 * reports the first failure after a start or Restart Server.
 */
export function manager(input: {
  command: () => Command | undefined
  cwd: string
  env: NodeJS.ProcessEnv
  log?: (text: string) => void
  onError?: (error: Error) => void
  retry?: number
}) {
  const state: { current?: Promise<Server>; failed: boolean } = { failed: false }
  const boot = () => {
    const found = input.command()
    const promise = found
      ? start({
          command: found,
          cwd: input.cwd,
          env: input.env,
          log: input.log,
          onExit: () => {
            if (state.current === promise) state.current = undefined
          },
        })
      : Promise.reject(
          new Error("No Kilo v2 server found. Put a kilo2 binary in bin/ or run the extension from the repository."),
        )
    promise.then(
      () => {
        state.failed = false
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
  const file = path.join(env.BUN_INSTALL ?? path.join(homedir(), ".bun"), "bin", platform === "win32" ? "bun.exe" : "bun")
  return existsSync(file) ? file : "bun"
}
