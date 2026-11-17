// Filesystem layout of the browser bridge: data files under the Kilo data dir and a
// per-user runtime dir for CLI sockets and the hub registry.
import path from "path"
import fs from "fs/promises"
import { Global } from "@opencode-ai/core/global"

export namespace Paths {
  function env(name: string) {
    const value = process.env[name]
    return value === undefined || value === "" ? undefined : value
  }

  // <kilo data dir>/browser
  export function data() {
    return env("KILO_BROWSER_DATA_DIR") ?? path.join(Global.Path.data, "browser")
  }

  // Unix socket and registry directory. macOS keeps it under Application Support,
  // Linux follows the XDG runtime dir so it disappears with the login session.
  export function run() {
    const override = env("KILO_BROWSER_RUN_DIR")
    if (override) return override
    if (process.platform === "linux") {
      const runtime = env("XDG_RUNTIME_DIR")
      if (runtime) return path.join(runtime, "kilo-browser")
    }
    return path.join(data(), "run")
  }

  export function hubs() {
    return path.join(run(), "hubs")
  }

  export function socket(hubId: string) {
    if (process.platform === "win32") return `\\\\.\\pipe\\kilo-browser-${hubId}`
    const dir = run()
    const full = path.join(dir, `${hubId}.sock`)
    // sun_path is 104 bytes on macOS and 108 on Linux; keep a short fallback.
    return full.length <= 100 ? full : path.join(dir, `${hubId.slice(0, 8)}.sock`)
  }

  export function pairing() {
    return path.join(data(), "pairing.json")
  }

  // Creates the directory and refuses to hand back one that the current user cannot
  // vouch for. `tight` also forces 0700, which the CLI socket directory needs.
  export async function ensure(dir: string, tight = false): Promise<string> {
    await fs.mkdir(dir, { recursive: true, mode: tight ? 0o700 : 0o755 })
    if (process.platform === "win32") return dir
    const stat = await fs.stat(dir)
    const uid = process.getuid?.()
    if (uid !== undefined && tight && stat.uid !== uid) {
      throw new Error(`refusing to use ${dir}: it is owned by uid ${stat.uid}, not ${uid}`)
    }
    if (tight && (stat.mode & 0o777) !== 0o700) await fs.chmod(dir, 0o700)
    return dir
  }

  export async function ensureRun() {
    return ensure(run(), true)
  }

  export async function ensureData() {
    return ensure(data())
  }
}
