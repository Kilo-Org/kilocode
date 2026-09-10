// A classification fixture that owns the roots it is judged against.
//
// The tree has to live somewhere writable, and that is the OS temp dir — which is exactly the
// relation the "external" scenarios must not collapse into. On Linux `os.tmpdir()` is `/tmp`, so a
// fixture that declares the real temp roots puts its own outside-the-world directory *inside* one
// of them; `temp` ranks below `external`, so every external verdict silently downgrades and the
// scenario stops testing anything. macOS hides the bug because its temp dir is under
// `/private/var/folders`, which those same declarations do not name.
//
// So the fixture declares roots derived from itself: `temp` is a directory inside the base, and
// anything under the base that is not the workspace, the home or that temp root is genuinely
// external — on Linux and macOS alike.
//
// The same trap has a second mouth: `TMPDIR` can point inside `$HOME`, and then the base sits under
// a declared *system* root instead, so external decays to `system`. The system list is therefore
// filtered against the base too, rather than being trusted to never contain it.
//
// Production classification is untouched: `PathRisk.env` still treats `/tmp` and friends as temp
// roots by default, and `path.test.ts` asserts that against a default environment.
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PathRisk } from "../../../src/kilocode/security/path"

// Real system roots. Any of these that the fixture base turns out to sit under is dropped at build
// time (see `classificationFixture`): the base must be free to be external.
const SYSTEM = [
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/System",
  "/Library",
  "/dev",
  "/boot",
  "/proc",
  "/sys",
  "/home",
  "/Users",
  "/opt",
]

/**
 * Build an isolated tree plus the `PathRisk` environment that describes it.
 *
 * `workspace` is the path of the workspace relative to the fake home. The returned `temp` and
 * `external` directories exist on disk and are, by construction, the declared temp root and a
 * directory outside every declared root.
 */
export async function classificationFixture(prefix: string, workspace: string[]) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))
  // Drop every declared root the base actually sits under, so "external" cannot collapse into one.
  const system = SYSTEM.filter((root) => path.relative(root, base).startsWith(".."))
  const home = path.join(base, "home")
  const temp = path.join(base, "temp")
  const external = path.join(base, "external")
  const ws = path.join(home, ...workspace)
  await fs.mkdir(temp, { recursive: true })
  await fs.mkdir(external, { recursive: true })
  await fs.mkdir(ws, { recursive: true })
  const env = PathRisk.env({
    workspace: { directory: ws, worktree: ws },
    home,
    temp: [temp],
    system,
  })
  return {
    base,
    home,
    ws,
    /** The declared temp root: paths strictly inside it are `temp`, the root itself is `external`. */
    temp,
    /** Outside the workspace, the fake home and every declared temp root. */
    external,
    env,
    cleanup: () => fs.rm(base, { recursive: true, force: true }),
  }
}
