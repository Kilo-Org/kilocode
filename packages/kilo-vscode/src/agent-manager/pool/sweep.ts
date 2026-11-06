/**
 * Machine-wide cleanup of the pool home. Slots live outside the projects, so
 * without this a deleted project or one that nobody opens again would leave a
 * full checkout behind in a directory the user never sees. vscode-free.
 */

import * as fs from "fs"
import * as path from "path"
import type { SimpleGit } from "simple-git"
import { METADATA_FILE, alive, readMeta, subdirs } from "./slot"

/** A slot that no live process owns and that nothing touched for this long is removed. */
const STALE = 14 * 24 * 60 * 60 * 1000
/** A slot without metadata can still be in creation by another process for at most this long. */
const CREATION = 60 * 60 * 1000

/**
 * Remove slots that no Kilo process can claim, across every repository in the
 * pool home. A slot whose repository is gone (deleted, moved, or pruned) is
 * removed at once. Other slots are removed when no live process owns them and
 * nothing touched them for {@link STALE}, or at once when the pool is disabled.
 */
export async function sweep(
  home: string,
  enabled: boolean,
  client: (cwd: string) => SimpleGit,
  log: (msg: string) => void,
): Promise<void> {
  const age = enabled ? STALE : 0
  for (const project of await subdirs(home)) {
    const dir = path.join(home, project)
    for (const name of await subdirs(dir)) await reap(path.join(dir, name), age, client, log)
    await fs.promises.rmdir(dir).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOTEMPTY" && e.code !== "EEXIST" && e.code !== "ENOENT") {
        log(`worktree pool: remove ${dir}: ${e}`)
      }
    })
  }
}

async function reap(slot: string, age: number, client: (cwd: string) => SimpleGit, log: (msg: string) => void) {
  const gitdir = await linked(slot)
  // git creates the registration before it writes the `.git` file, so a
  // missing target means git no longer tracks this slot.
  if (gitdir && !fs.existsSync(gitdir)) {
    log(`worktree pool: removing slot of a missing repository ${slot}`)
    return purge(slot, log)
  }
  const file = gitdir ? path.join(gitdir, METADATA_FILE) : undefined
  const meta = file ? await readMeta(file, log) : undefined
  if (meta?.pooled && alive(meta.owner)) return
  const wait = meta?.pooled ? age : Math.max(age, CREATION)
  // Metadata is rewritten whenever a process adopts or retargets the slot.
  const stamp = await fs.promises
    .stat(meta && file ? file : slot)
    .then((stat) => stat.mtimeMs)
    .catch(() => undefined)
  if (stamp === undefined) return
  // A fresh mtime can be slightly ahead of the clock, so no wait means remove at once.
  if (wait > 0 && Date.now() - stamp < wait) return
  log(`worktree pool: removing unused slot ${slot}`)
  if (gitdir) {
    // simple-git throws at once when the directory vanished meanwhile.
    await Promise.resolve()
      .then(() => client(slot).raw(["worktree", "remove", "--force", "--force", slot]))
      .catch((e) => log(`worktree pool: remove ${slot}: ${e}`))
  }
  if (fs.existsSync(slot)) await purge(slot, log)
}

async function purge(dir: string, log: (msg: string) => void): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true }).catch((e) => log(`worktree pool: rm ${dir}: ${e}`))
}

/** Git directory a linked worktree points at, or undefined when it has no `.git` file. */
async function linked(dir: string): Promise<string | undefined> {
  const content = await fs.promises.readFile(path.join(dir, ".git"), "utf-8").catch(() => undefined)
  const match = content?.match(/^gitdir:\s*(.+)$/m)
  return match ? path.resolve(dir, match[1].trim()) : undefined
}
