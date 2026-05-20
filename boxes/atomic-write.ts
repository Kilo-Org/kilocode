/**
 * atomic-write.ts — tmp→rename atomic file write
 * Pattern from abtop (MIT)
 * Deps: fs/promises, path (Node built-ins)
 */

import { writeFile, rename, unlink } from "fs/promises"
import { join, extname } from "path"

export async function atomicWrite(filePath: string, content: string | Buffer): Promise<void> {
  const tmp = join(
    filePath.slice(0, filePath.lastIndexOf("/") + 1 || filePath.lastIndexOf("\\") + 1),
    `.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(filePath)}`,
  )
  try {
    await writeFile(tmp, content)
    await rename(tmp, filePath)
  } catch (err) {
    try { await unlink(tmp) } catch { /* ignore */ }
    throw err
  }
}
