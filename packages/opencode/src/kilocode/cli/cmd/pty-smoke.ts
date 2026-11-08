import { cmd } from "@/cli/cmd/cmd"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { VtScreen } from "./tui/vt/vt-screen"

const OUTPUT_LIMIT = 20_000
const LOG_TAIL = 80
const IDLE_LIMIT = 25_000
const DIAGNOSTIC =
  /(?:TUI worker error\b|worker (?:unhandledRejection|uncaughtException)\b|(?:^|[\r\n])\s*(?:panic|fatal(?: error)?|unhandled exception|uncaught exception)\b)/i

/**
 * Tail whatever the child wrote to the CLI log directory inside the harness home.
 * Filenames vary (dev.log, opencode.log, a timestamped .log), so read the directory
 * instead of guessing, and skip nested directories like background-process.
 */
async function logs(dataHome: string) {
  const dir = path.join(dataHome, "kilo", "log")
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = entries.filter((entry) => entry.isFile())
  if (files.length === 0) return `no CLI logs under ${dir}`
  const parts = await Promise.all(
    files.map(async (entry) => {
      const text = await readFile(path.join(dir, entry.name), "utf8").catch((err) => `<unreadable: ${err}>`)
      const lines = text.trimEnd().split("\n").slice(-LOG_TAIL)
      return `--- ${entry.name} (last ${lines.length} lines) ---\n${lines.join("\n")}`
    }),
  )
  return parts.join("\n")
}

export async function render(file: string, args: string[] = ["--pure"], timeout = 60_000) {
  const { spawn } = await import("@opencode-ai/core/pty/driver")
  const { KiloPtyTermination } = await import("@opencode-ai/core/kilocode/pty/termination")
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
    // A release binary logs at INFO, which is too coarse to locate a startup stall.
    // KiloLog.init reads this, so the log tail attached on failure shows every step.
    KILO_LOG_LEVEL: process.env.KILO_PTY_SMOKE_LOG_LEVEL ?? "DEBUG",
    // Must stay below IDLE_LIMIT so an unanswered worker call is reported in the log tail
    // instead of being cut off by the silence watchdog.
    KILO_RPC_HANDSHAKE_TIMEOUT: "8000",
    KILO_CONFIG_CONTENT: JSON.stringify({ enabled_providers: ["anthropic"], experimental: { openTelemetry: false } }),
    KILO_AUTH_CONTENT: "{}",
    ANTHROPIC_API_KEY: "dummy",
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

  const keep = process.env.KILO_PTY_SMOKE_KEEP === "1"
  try {
    const cwd = path.join(dir, "project")
    await mkdir(cwd)
    const proc = spawn(file, args, { name: "xterm-256color", cwd, env, cols: 100, rows: 40 })
    const screen = new VtScreen(100, 40)
    const state = {
      output: "",
      phase: "screen",
      suffix: crypto.randomUUID().slice(0, 8),
      prefix: crypto.randomUUID().slice(0, 8),
      bytes: 0,
      chunks: 0,
      last: Date.now(),
    }
    const alive = () => {
      if (!proc.pid) return false
      try {
        process.kill(proc.pid, 0)
        return true
      } catch {
        return false
      }
    }
    const detail = () =>
      `phase=${state.phase} chunks=${state.chunks} bytes=${state.bytes} ` +
      `idle=${Date.now() - state.last}ms pid=${proc.pid} alive=${alive()}`
    const ready = Promise.withResolvers<void>()
    const write = (value: string) => {
      try {
        proc.write(value)
      } catch (err) {
        ready.reject(err)
      }
    }
    const probe = () => {
      if (state.phase === "edit" || state.phase === "done" || !screen.text().trim()) return
      state.phase = "input"
      write(`\x05\x15${state.suffix}`)
    }
    const data = proc.onData((chunk) => {
      state.bytes += chunk.length
      state.chunks++
      state.last = Date.now()
      const raw = state.output + chunk
      state.output = raw.slice(-OUTPUT_LIMIT)
      if (DIAGNOSTIC.test(stripVTControlCharacters(raw))) {
        ready.reject(new Error(`TUI diagnostic during ${state.phase}: ${JSON.stringify(state.output)}`))
        return
      }
      screen.write(chunk)
      const text = screen.text()
      if (state.phase === "screen") return probe()
      if (state.phase === "input" && text.includes(state.suffix)) {
        state.phase = "edit"
        write(`\x01${state.prefix}`)
        return
      }
      if (state.phase === "edit" && text.includes(state.prefix + state.suffix)) {
        state.phase = "done"
        ready.resolve()
      }
    })
    const exit = proc.onExit((event) => {
      ready.reject(
        new Error(
          `TUI exited during ${state.phase} (code ${event.exitCode}, signal ${event.signal ?? "none"}): ${JSON.stringify(state.output)}`,
        ),
      )
    })
    const retry = setInterval(probe, 1_000)
    const timer = setTimeout(
      () =>
        ready.reject(
          new Error(
            `TUI timed out during ${state.phase} after ${timeout}ms: ${detail()}, ` +
              `screen=${JSON.stringify(screen.text())}, output=${JSON.stringify(state.output)}`,
          ),
        ),
      timeout,
    )
    // Fail fast on a silent-but-alive stream during the screen phase, the only phase
    // observed to stall in CI. The input/edit phases are driven by the 1s probe above,
    // so a global idle check there would risk new flakes; the overall timeout stays
    // as the outer bound regardless of phase.
    const watch = setInterval(() => {
      if (state.phase !== "screen") return
      if (Date.now() - state.last < IDLE_LIMIT) return
      ready.reject(
        new Error(
          `TUI went silent during ${state.phase} after ${IDLE_LIMIT}ms with no output: ${detail()}, ` +
            `screen=${JSON.stringify(screen.text())}, output=${JSON.stringify(state.output)}`,
        ),
      )
    }, 1_000)
    const outcome = await ready.promise.then(
      () => undefined,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    )
    clearTimeout(timer)
    clearInterval(retry)
    clearInterval(watch)
    data.dispose()
    exit.dispose()
    const failed = await KiloPtyTermination.terminate(proc).then(
      () => undefined,
      (err: unknown) => err,
    )
    if (outcome) throw new Error(`${outcome.message}\n${await logs(env.XDG_DATA_HOME!)}`, { cause: outcome })
    if (failed) throw failed
  } finally {
    if (keep) console.error(`kept PTY smoke home: ${dir}`)
    if (!keep) await rm(dir, { recursive: true, force: true })
  }
}

export const PtySmokeCommand = cmd({
  command: "__pty-smoke",
  describe: false,
  async handler() {
    if (process.env.KILO_PTY_SMOKE !== "1") throw new Error("PTY smoke command is release-only")
    const { PtySmoke } = await import("@opencode-ai/core/kilocode/pty/smoke")
    await PtySmoke.smoke()
    await render(process.execPath)
    console.log("Compiled TUI startup smoke test passed")
  },
})
