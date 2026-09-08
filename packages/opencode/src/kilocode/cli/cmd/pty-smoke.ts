import { cmd } from "@/cli/cmd/cmd"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { VtScreen } from "./tui/vt/vt-screen"

const OUTPUT_LIMIT = 20_000
const DIAGNOSTIC =
  /(?:TUI worker error\b|(?:^|[\r\n])\s*(?:panic|fatal(?: error)?|unhandled exception|uncaught exception)\b)/i

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
    }
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
            `TUI timed out during ${state.phase} after ${timeout}ms: screen=${JSON.stringify(screen.text())}, output=${JSON.stringify(state.output)}`,
          ),
        ),
      timeout,
    )
    try {
      await ready.promise
    } finally {
      clearTimeout(timer)
      clearInterval(retry)
      data.dispose()
      exit.dispose()
      await KiloPtyTermination.terminate(proc)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
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
