// Runs `kilo browser install-chromium` with the command and environment of the spawned server, so the Chromium lands in
// the data directory that server reads, also from a repository checkout with its isolated profile. One install runs at
// a time: a second request answers `busy` instead of starting a download the first one would delete halfway.
import type { ChildProcess } from "node:child_process"
import { environment, type Command } from "../server"
import { launch } from "../process"

/** A download the user did not watch must not run forever, and a stalled connection must not hold the slot. */
const TIMEOUT = 10 * 60_000

export type Result = {
  ok: boolean
  output: string
  /** Another install is still running, so this one did not start. */
  busy?: boolean
  timedOut?: boolean
  cancelled?: boolean
}

let active: ChildProcess | undefined
let stop: (() => void) | undefined

/** Stop the running install, for the extension to call when it shuts down. */
export function cancelChromiumInstall() {
  stop?.()
}

function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  // The child is its own process group on POSIX (the installer starts a browser download under it), so kill the group.
  try {
    if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGTERM")
    else child.kill("SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
}

export function installChromium(input: {
  command: Command
  cwd: string
  env: NodeJS.ProcessEnv
  log: (text: string) => void
  /** Receives the installer's output as it arrives, for the panel's progress line. */
  onProgress?: (text: string) => void
  timeoutMs?: number
}): Promise<Result> {
  if (active) return Promise.resolve({ ok: false, output: "A Chromium install is already running.", busy: true })
  // The server command is `<cli> serve …`; the same CLI takes the subcommand before it.
  const prefix = input.command.args.slice(0, input.command.args.indexOf("serve"))
  const child = launch(input.command.cmd, [...prefix, "browser", "install-chromium"], {
    cwd: input.cwd,
    env: environment(input.env, { ...input.command.env, INIT_CWD: input.cwd }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })
  active = child
  const lines: string[] = []
  const { promise, resolve } = Promise.withResolvers<Result>()
  let done = false
  let timer: NodeJS.Timeout | undefined
  const finish = (result: Result) => {
    if (done) return
    done = true
    clearTimeout(timer)
    active = undefined
    stop = undefined
    resolve(result)
  }
  timer = setTimeout(() => {
    kill(child)
    finish({
      ok: false,
      output: [...lines, `Chromium install timed out after ${Math.round((input.timeoutMs ?? TIMEOUT) / 1000)}s.`].join(
        "",
      ),
      timedOut: true,
    })
  }, input.timeoutMs ?? TIMEOUT)
  stop = () => {
    kill(child)
    finish({ ok: false, output: [...lines, "Chromium install cancelled."].join(""), cancelled: true })
  }
  const collect = (chunk: Buffer) => {
    const text = chunk.toString()
    lines.push(text)
    input.log(text)
    input.onProgress?.(text)
  }
  child.stdout?.on("data", collect)
  child.stderr?.on("data", collect)
  child.on("error", (error) => finish({ ok: false, output: error.message }))
  child.on("close", (code) => finish({ ok: code === 0, output: lines.join("").trim() }))
  return promise
}
