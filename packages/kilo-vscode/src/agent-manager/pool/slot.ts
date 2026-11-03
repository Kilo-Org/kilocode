/**
 * Facts about one pool slot on disk, shared by the pool and the machine-wide
 * sweep: its metadata file, whether its owner process is alive, and the
 * directories that can hold slots. vscode-free.
 */

import * as fs from "fs"

export const METADATA_FILE = "kilo-agent-manager-metadata.json"

/** Metadata in a slot's git directory. A claim clears it to `{}`. */
export interface PoolMeta {
  pooled?: boolean
  owner?: number
  baseRef?: string
  baseOid?: string
}

export async function readMeta(file: string, log: (msg: string) => void): Promise<PoolMeta | undefined> {
  // A missing file is the normal case for a non-pooled worktree, so stay quiet.
  const content = await fs.promises.readFile(file, "utf-8").catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") log(`worktree pool: read metadata ${file}: ${e}`)
    return undefined
  })
  if (content === undefined) return undefined
  return await Promise.resolve()
    .then(() => JSON.parse(content) as PoolMeta)
    .catch((e) => {
      log(`worktree pool: parse metadata ${file}: ${e}`)
      return undefined
    })
}

/** True when the process that owns a slot still runs. */
export function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

export async function subdirs(dir: string): Promise<string[]> {
  // Another process can remove the directory at any time, for example in its own sweep.
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return []
    throw e
  })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}
