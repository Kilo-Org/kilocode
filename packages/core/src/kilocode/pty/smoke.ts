import { Shell } from "../../shell"
import { KiloPtyTermination } from "./termination"
import { spawn } from "#pty"

const TIMEOUT = 15_000

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
