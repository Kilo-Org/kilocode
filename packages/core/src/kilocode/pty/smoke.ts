import { Shell } from "../../shell"
import { KiloPtyTermination } from "./termination"
import { spawn } from "#pty"

const TIMEOUT = 15_000
const RENDER_TIMEOUT = 60_000

export function marker(output: string) {
  const text = output
    .replace(/\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[P^_](?:[^\x1b]|\x1b(?!\\))*\x1b\\/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
  return text.split(/\r?\n/).some((line) => line.trim() === "KILO_PTY_READY")
}

async function render() {
  const proc = spawn(process.execPath, ["--pure"], {
    name: "xterm-256color",
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: "xterm-256color",
      KILO_TERMINAL: "1",
      KILO_NO_DAEMON: "1",
      KILO_DISABLE_AUTOUPDATE: "1",
      KILO_DISABLE_MODELS_FETCH: "1",
      KILO_DISABLE_PROJECT_CONFIG: "1",
      KILO_DISABLE_DEFAULT_PLUGINS: "1",
      KILO_DISABLE_TERMINAL_TITLE: "0",
      KILO_CONFIG_CONTENT: "{}",
      KILO_AUTH_CONTENT: "{}",
    } as Record<string, string>,
    cols: 100,
    rows: 40,
  })
  const state = { output: "", exited: false }
  const ready = Promise.withResolvers<void>()
  const data = proc.onData((chunk) => {
    state.output = (state.output + chunk).slice(-20_000)
    if (state.output.includes("Ask anything...")) ready.resolve()
  })
  const exit = proc.onExit((event) => {
    state.exited = true
    ready.reject(new Error(`TUI exited before rendering (code ${event.exitCode}): ${JSON.stringify(state.output)}`))
  })
  const timeout = AbortSignal.timeout(RENDER_TIMEOUT)

  try {
    await Promise.race([
      ready.promise,
      new Promise<never>((_, reject) =>
        timeout.addEventListener(
          "abort",
          () =>
            reject(
              new Error(`TUI produced no rendered frame within ${RENDER_TIMEOUT}ms: ${JSON.stringify(state.output)}`),
            ),
          { once: true },
        ),
      ),
    ])
  } finally {
    data.dispose()
    exit.dispose()
    if (!state.exited) await KiloPtyTermination.terminate(proc)
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
    if (marker(state.output)) output.resolve()
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

  await render()
}

export * as PtySmoke from "./smoke"
