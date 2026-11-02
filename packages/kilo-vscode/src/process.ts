// Spawns with `windowsHide: true`, so no console window flashes on Windows. Use this instead of `child_process.spawn`.
import { execFile, spawn, type ChildProcess, type ExecFileOptionsWithStringEncoding, type SpawnOptions } from "node:child_process"
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
