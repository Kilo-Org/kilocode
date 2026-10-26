import { Shell } from "../../shell"
import { KiloPtyTermination } from "./termination"
import { spawn } from "#pty"

const TIMEOUT = 30_000
// Shells can drop input written before they are ready to read it (for example pwsh under
// ConPTY while PSReadLine starts), so resend the probe until the shell answers.
const RETRY = 1_000

export async function smoke(file = Shell.preferred(), args: string[] = []) {
  const proc = spawn(file, args, {
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
  const probe = () => {
    if (state.exited) return
    try {
      proc.write("echo KILO_PTY_READY\r")
    } catch (err) {
      output.reject(err)
    }
  }
  const retry = setInterval(probe, RETRY)

  try {
    proc.resize(100, 40)
    probe()
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
    // Stop probing before exit so no probe follows the exit command. Probes already queued
    // only print the marker again and run before exit.
    clearInterval(retry)
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
    clearInterval(retry)
    data.dispose()
    exit.dispose()
    if (!state.exited) proc.kill()
  }

  const active = spawn(file, args, {
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
