// Spawns with `windowsHide: true`, so no console window flashes on Windows. Use this instead of `child_process.spawn`.
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"

export function launch(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  return spawn(cmd, args, { windowsHide: true, ...opts })
}
