import fs from "fs/promises"

/**
 * Like `fs.mkdir({ recursive: true })` but also repairs broken symlinks and
 * junctions whose target no longer exists (a Windows edge-case where the user
 * had a junction at e.g. `~/.kilocode` pointing to a deleted directory).
 *
 * `fs.mkdir({ recursive: true })` silently no-ops when a junction exists even
 * if its target is gone, so subsequent writes inside that path fail with ENOENT.
 * We detect this by calling `fs.stat` (which follows the symlink/junction) after
 * mkdir: if stat fails the entry is broken and we remove + recreate it.
 */
export async function ensureRealDir(p: string) {
  await fs.mkdir(p, { recursive: true })
  const ok = await fs.stat(p).then(() => true).catch(() => false)
  if (!ok) {
    await fs.rm(p, { force: true })
    await fs.mkdir(p, { recursive: true })
  }
}
