import { Effect, type FileSystem } from "effect"

export function exists(fs: Pick<FileSystem.FileSystem, "exists">, dir: string, current: string) {
  return fs.exists(dir).pipe(
    Effect.catch((err) => {
      if (dir === current || err.reason._tag !== "PermissionDenied") return Effect.fail(err)
      // Denied access does not prove deletion. Keep the saved association for recovery.
      return Effect.logWarning("historical sandbox is inaccessible", { directory: dir, error: err }).pipe(
        Effect.as(true),
      )
    }),
  )
}
