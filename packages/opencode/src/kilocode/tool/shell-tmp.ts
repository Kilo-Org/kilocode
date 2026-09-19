// Cloud sessions allowlist a session-scoped temp dir instead of the shared one.
//
// The platform injects `external_directory` rules permitting only
// `/tmp/<SESSION_ID>/**` (plus a few session-scoped roots) and denying
// everything else, while the bash tool description otherwise advertises the
// shared `Global.Path.tmp`. Naming the session dir here keeps the guidance
// within the permitted set.
import fs from "node:fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"

// The allowlist root is the literal `/tmp`, not `os.tmpdir()`: `os.tmpdir()`
// follows `TMPDIR`, so deriving from it could point the model back at a denied
// path if that override ever reaches the server process.
const ALLOWLIST_ROOT = "/tmp"

export function sessionTmp() {
  const cloud = process.env["KILO_CLOUD_AGENT"]?.toLowerCase()
  if (cloud !== "true" && cloud !== "1") return Global.Path.tmp
  const session = process.env.SESSION_ID
  if (!session || !/^[A-Za-z0-9_-]+$/.test(session)) return Global.Path.tmp
  const dir = path.join(ALLOWLIST_ROOT, session)
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    // lstat, not stat: a pre-existing symlink must not redirect the advertised dir
    if (!fs.lstatSync(dir).isDirectory()) return Global.Path.tmp
    return dir
  } catch {
    return Global.Path.tmp
  }
}
