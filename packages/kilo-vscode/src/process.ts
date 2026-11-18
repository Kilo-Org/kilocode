// Spawns with `windowsHide: true`, so no console window flashes on Windows. Use this instead of `child_process.spawn`.
import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileOptionsWithStringEncoding,
  type SpawnOptions,
} from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

export function launch(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  return spawn(cmd, args, { windowsHide: true, ...opts })
}

/** Promisified `execFile` with `windowsHide: true`, for small helpers such as `ffmpeg -version`. */
export async function exec(
  cmd: string,
  args: string[],
  opts: Omit<ExecFileOptionsWithStringEncoding, "encoding"> = {},
): Promise<{ stdout: string; stderr: string }> {
  return run(cmd, args, { ...opts, encoding: "utf8", windowsHide: true })
}

/**
 * A spawned child run to completion: its exit status, and the text of both output streams, mirrored to `log` as it
 * arrives. `close` comes after both streams ended, so the last line of the output is never cut off.
 */
export function collected(child: ChildProcess, log: (text: string) => void): Promise<{ ok: boolean; output: string }> {
  const result = Promise.withResolvers<{ ok: boolean; output: string }>()
  const lines: string[] = []
  const collect = (chunk: Buffer) => {
    const text = chunk.toString()
    log(text)
    lines.push(text)
  }
  child.stdout?.on("data", collect)
  child.stderr?.on("data", collect)
  child.on("error", (error) => result.resolve({ ok: false, output: error.message }))
  child.on("close", (code) => result.resolve({ ok: code === 0, output: lines.join("").trim() }))
  return result.promise
}
