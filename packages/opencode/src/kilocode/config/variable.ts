import fs from "node:fs/promises"
import { realpathSync, statSync } from "node:fs"
import path from "node:path"

export namespace ConfigVariableGuard {
  export type FileScope = {
    root: string
    source: string
  }

  export type Authorize = (input: { requested: string; target: string }) => Promise<boolean>

  type ReadOptions = { token?: string; authorize?: Authorize } & (FileScope | { root?: never; source?: never })

  // A deliberate security block (out-of-scope, swapped, or /proc) — distinct from a plain missing/IO error so
  // callers using missing:"empty" still surface the block instead of silently emptying it.
  export class BlockedError extends Error {
    readonly blocked = true as const
  }

  export function isBlocked(err: unknown): err is BlockedError {
    return err instanceof BlockedError || (typeof err === "object" && err !== null && (err as any).blocked === true)
  }

  const secret = new Set(["KILO_SERVER_PASSWORD", "KILO_SERVER_USERNAME"])

  export function env(name: string) {
    return !secret.has(name.toUpperCase())
  }

  function inside(root: string, file: string) {
    const rel = path.relative(root, file)
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
  }

  function check(file: string, token: string, scope?: FileScope) {
    if (!scope) return
    const root = realpathSync.native(scope.root)
    if (inside(root, file)) return
    throw new BlockedError(`blocked file reference outside project config scope: "${token}"`)
  }

  export async function read(filePath: string, scope?: ReadOptions) {
    const file = await fs.open(filePath, "r")
    try {
      // Resolve the file the fd actually points at, then validate the scope and read through the same fd
      // (file.readFile) so the validated inode is exactly the one we read.
      //
      // On Linux /proc/self/fd/<fd> is the kernel's canonical path for the open fd, so realpath + read both
      // follow the fd — no path is re-resolved after open. On other platforms we cannot name the fd directly,
      // so we realpath the caller's path and then confirm, via fstat vs. stat on that resolved path, that it
      // still refers to the same inode as the open fd. If an attacker swapped the path between open and check,
      // the inodes differ and we reject rather than validating one inode while reading another.
      const target = process.platform === "linux" ? `/proc/self/fd/${file.fd}` : filePath
      const resolved = realpathSync.native(target)
      if (process.platform !== "linux" && scope) {
        const opened = await file.stat()
        const seen = statSync(resolved)
        if (opened.dev !== seen.dev || opened.ino !== seen.ino) {
          throw new BlockedError(`blocked file reference changed during read: "${scope.token ?? "{file:...}"}"`)
        }
      }
      if ((scope?.root === undefined) !== (scope?.source === undefined)) {
        throw new BlockedError(`blocked incomplete file reference scope: "${scope?.token ?? "{file:...}"}"`)
      }
      check(resolved, scope?.token ?? "{file:...}", scope?.root ? scope : undefined)
      if (/^\/proc\/.*\/environ$/.test(resolved)) throw new BlockedError("blocked process environment reference")
      if (scope?.authorize && !(await scope.authorize({ requested: filePath, target: resolved }))) {
        throw new BlockedError(`blocked ignored file reference: "${scope.token ?? "{file:...}"}"`)
      }
      return await file.readFile("utf-8")
    } finally {
      await file.close()
    }
  }
}
