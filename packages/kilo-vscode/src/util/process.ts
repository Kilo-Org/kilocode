/**
 * Process spawning utilities for the VS Code extension.
 *
 * All helpers set `windowsHide: true` to prevent cmd.exe console windows from
 * flashing on Windows. Always use these instead of importing `spawn` or
 * `execFile` from `child_process` directly.
 *
 * If you need the raw callback form of `execFile`, pass `windowsHide: true`
 * explicitly in the options object.
 */

import {
  spawn as _spawn,
  execFile as _execFile,
  type SpawnOptions,
  type ExecFileOptionsWithStringEncoding,
  type ChildProcess,
} from "child_process"
import { promisify } from "util"

const _exec = promisify(_execFile)

/** `child_process.spawn` with `windowsHide: true` forced on. */
export function spawn(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  return _spawn(cmd, args, { windowsHide: true, ...opts })
}

/** Promisified `child_process.execFile` with `windowsHide: true` forced on. */
export async function exec(
  cmd: string,
  args: string[],
  opts: Omit<ExecFileOptionsWithStringEncoding, "encoding"> = {},
): Promise<{ stdout: string; stderr: string }> {
  return _exec(cmd, args, { ...opts, encoding: "utf8", windowsHide: true })
}
