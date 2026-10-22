import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"

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
  const ok = await fs
    .stat(p)
    .then(() => true)
    .catch(() => false)
  if (!ok) {
    await fs.rm(p, { force: true })
    await fs.mkdir(p, { recursive: true })
  }
}

async function writable(p: string) {
  const probe = path.join(p, `.kilo-write-${process.pid}-${randomUUID()}`)
  await fs.writeFile(probe, "", { flag: "wx", mode: 0o600 })
  await fs.unlink(probe)
}

async function ready(p: string) {
  await ensureRealDir(p)
  await writable(p)
}

export async function resolveState(p: string, fallback?: string) {
  const sticky =
    fallback === undefined
      ? false
      : await fs.stat(fallback).then(
          (stat) =>
            stat.isDirectory() &&
            writable(fallback).then(
              () => true,
              () => false,
            ),
          () => false,
        )
  if (sticky && fallback !== undefined) return fallback

  const err = await ready(p).then(
    () => undefined,
    (err: unknown) => err,
  )
  if (err === undefined) return p
  if (fallback === undefined) throw err

  const failed = await ready(fallback).then(
    () => undefined,
    (err: unknown) => err,
  )
  if (failed !== undefined) {
    throw new AggregateError([err, failed], `Cannot use state directory "${p}" or fallback "${fallback}"`)
  }

  const msg = err instanceof Error ? err.message : "Unknown error"
  // Logging is not initialized until Global.Path.log exists.
  console.warn(`[kilo] Cannot use state directory "${p}"; using "${fallback}" instead: ${msg}`)
  return fallback
}
