/**
 * Where pool slots live. Slots are only warmed in a per-user directory outside
 * the project, so pre-warming never creates `.kilo/worktrees/`. A slot is a full
 * checkout, and inside the project every tool that walks the tree sees it:
 * `conda-build .` finds a second recipe, test runners collect duplicate tests,
 * file watchers and language servers index a copy. Ignore rules do not help,
 * because these tools do not read them.
 *
 * A claim moves the slot into `.kilo/worktrees/` with `git worktree move`,
 * which is a plain rename. So a project on another filesystem gets no slot and
 * creates its worktrees on demand. vscode-free.
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { createHash } from "crypto"
import { sanitizeBranchName } from "../branch-name"
import { pathKey } from "../project/paths"
import { markNoIndex } from "../../util/spotlight"

/** Per-user pool home next to the Kilo CLI data. Honors `XDG_DATA_HOME` and is never roaming on Windows. */
export function poolHome(): string {
  const data = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share")
  return path.join(data, "kilo", "worktree-pool")
}

/** Stable slot directory for one repository root. The readable prefix helps users who inspect disk usage. */
export function poolDir(home: string, root: string): string {
  const slug = sanitizeBranchName(path.basename(root), 32) || "repo"
  const hash = createHash("sha256").update(pathKey(root)).digest("hex").slice(0, 12)
  return path.join(home, `${slug}-${hash}`)
}

/**
 * Return `shared` when a rename from it into the project can work, otherwise
 * undefined, which means no slots for this project. Creates only the pool
 * home, never anything in the project.
 */
export async function locate(root: string, shared: string, log: (msg: string) => void): Promise<string | undefined> {
  const home = path.dirname(shared)
  const same = await fs.promises
    .mkdir(home, { recursive: true })
    .then(() => Promise.all([fs.promises.stat(root), fs.promises.stat(home)]))
    .then(([a, b]) => a.dev === b.dev)
    .catch((e) => {
      log(`worktree pool: cannot use ${home}: ${e}`)
      return false
    })
  if (!same) {
    log(`worktree pool: ${home} is not on the filesystem of ${root}, not pre-warming worktrees`)
    return undefined
  }
  await markNoIndex(home, log)
  return shared
}
