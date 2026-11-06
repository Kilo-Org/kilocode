import { mkdirSync, realpathSync } from "node:fs"
import path from "node:path"
import { Global } from "@opencode/util/global"

function canonical(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return realpathSync.native(dir)
}

/**
 * Sandbox state under the kilo2 state directory. The state directory is writable inside the sandbox, so the profile
 * denies writes to this subtree, and the directory exists before any sandboxed process starts (bubblewrap protects
 * only paths that exist).
 */
export const root = path.join(canonical(Global.Path.state), "sandbox")
mkdirSync(root, { recursive: true, mode: 0o700 })
