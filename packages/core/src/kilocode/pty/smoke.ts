import { Shell } from "../../shell"
import { KiloPtyTermination } from "./termination"
import { spawn } from "#pty"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"

const TIMEOUT = 15_000
const OUTPUT_LIMIT = 20_000
const DIAGNOSTIC =
  /(?:TUI worker error\b|(?:^|[\r\n])\s*(?:panic|fatal(?: error)?|unhandled exception|uncaught exception)\b)/i

export async function render(file: string, args: string[] = ["--pure"], timeout = 60_000) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-pty-render-"))
  const env: Record<string, string> = {}
  for (const key of ["PATH", "SystemRoot", "SYSTEMROOT", "ComSpec", "LANG", "LC_ALL", "LC_CTYPE", "LANGUAGE"]) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  Object.assign(env, {
    TERM: "xterm-256color",
    KILO_TERMINAL: "1",
    KILO_TEST_HOME: dir,
    KILO_NO_DAEMON: "1",
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_DISABLE_MODELS_FETCH: "1",
    KILO_DISABLE_PROJECT_CONFIG: "1",
    KILO_DISABLE_DEFAULT_PLUGINS: "1",
    KILO_PURE: "1",
    KILO_CONFIG_CONTENT: JSON.stringify({ enabled_providers: [], experimental: { openTelemetry: false } }),
    KILO_AUTH_CONTENT: "{}",
    HOME: dir,
    USERPROFILE: dir,
    APPDATA: path.join(dir, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(dir, "AppData", "Local"),
    XDG_DATA_HOME: path.join(dir, ".local", "share"),
    XDG_CACHE_HOME: path.join(dir, ".cache"),
    XDG_CONFIG_HOME: path.join(dir, ".config"),
    XDG_STATE_HOME: path.join(dir, ".local", "state"),
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
  })

  try {
    const proc = spawn(file, args, { name: "xterm-256color", cwd: dir, env, cols: 100, rows: 40 })
    const state = { output: "", phase: "prompt" }
    const ready = Promise.withResolvers<void>()
    const data = proc.onData((chunk) => {
      const raw = state.output + chunk
      const text = stripVTControlCharacters(raw)
      state.output = raw.slice(-OUTPUT_LIMIT)
      if (DIAGNOSTIC.test(text)) {
        ready.reject(new Error(`TUI diagnostic during ${state.phase}: ${JSON.stringify(state.output)}`))
        return
      }
      const visible = text.replace(/[\r\n]/g, "")
      if (state.phase === "prompt" && visible.includes("Ask anything...")) {
        state.phase = "palette"
        state.output = ""
        try {
          proc.write("\x10")
        } catch (err) {
          ready.reject(err)
        }
        return
      }
      if (state.phase === "palette" && visible.includes("Commands")) ready.resolve()
    })
    const exit = proc.onExit((event) => {
      ready.reject(
        new Error(
          `TUI exited during ${state.phase} (code ${event.exitCode}, signal ${event.signal ?? "none"}): ${JSON.stringify(state.output)}`,
        ),
      )
    })
    const timer = setTimeout(
      () =>
        ready.reject(
          new Error(`TUI timed out during ${state.phase} after ${timeout}ms: ${JSON.stringify(state.output)}`),
        ),
      timeout,
    )
    try {
      await ready.promise
    } finally {
      clearTimeout(timer)
      data.dispose()
      exit.dispose()
      await KiloPtyTermination.terminate(proc)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function smoke() {
  const proc = spawn(Shell.preferred(), [], {
    name: "xterm-256color",
    cwd: process.cwd(),
    env: { ...process.env, TERM: "xterm-256color", KILO_TERMINAL: "1" } as Record<string, string>,
    cols: 80,
    rows: 24,
  })
  const state = { output: "", exited: false }
  const output = Promise.withResolvers<void>()
  const exited = Promise.withResolvers<number>()
  const data = proc.onData((chunk) => {
    state.output += chunk
    const lines = state.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split(/\r?\n/)
    if (lines.some((line) => line.trim() === "KILO_PTY_READY")) output.resolve()
  })
  const exit = proc.onExit((event) => {
    state.exited = true
    exited.resolve(event.exitCode)
  })
  const timeout = AbortSignal.timeout(TIMEOUT)

  try {
    proc.resize(100, 40)
    proc.write("echo KILO_PTY_READY\r")
    await Promise.race([
      output.promise,
      new Promise<never>((_, reject) =>
        timeout.addEventListener(
          "abort",
          () => reject(new Error(`PTY produced no output within ${TIMEOUT}ms: ${JSON.stringify(state.output)}`)),
          { once: true },
        ),
      ),
    ])
    proc.write("exit 7\r")
    const code = await Promise.race([
      exited.promise,
      new Promise<never>((_, reject) =>
        timeout.addEventListener("abort", () => reject(new Error(`PTY did not exit within ${TIMEOUT}ms`)), {
          once: true,
        }),
      ),
    ])
    if (code !== 7) throw new Error(`PTY exited ${code}, expected 7`)
  } finally {
    data.dispose()
    exit.dispose()
    if (!state.exited) proc.kill()
  }

  const active = spawn(Shell.preferred(), [], {
    name: "xterm-256color",
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  })
  let stopped = false
  try {
    await KiloPtyTermination.terminate(active)
    stopped = true
  } finally {
    if (!stopped) active.kill()
  }
}

export * as PtySmoke from "./smoke"
