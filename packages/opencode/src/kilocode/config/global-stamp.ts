import path from "path"
import { stat } from "node:fs/promises"
import { Effect } from "effect"

export namespace KilocodeGlobalConfigStamp {
  const files = ["config.json", "kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc", "config"]

  // Metadata is enough to detect edits and is cheaper than reading every body.
  // Nanosecond mtime and ctime avoid the same-size edit gap of millisecond
  // `Date` mtimes, which would otherwise hide same-length rewrites.
  export const read = Effect.fnUntraced(function* (dir: string) {
    const entries = yield* Effect.forEach(
      files,
      Effect.fnUntraced(function* (file) {
        const source = path.join(dir, file)
        const info = yield* Effect.promise(() => stat(source, { bigint: true }).catch(() => undefined))
        if (!info) return [source, null] as const
        return [source, String(info.mtimeNs), String(info.ctimeNs), String(info.size), String(info.ino)] as const
      }),
      { concurrency: "unbounded" },
    )
    return entries.map((entry) => entry.join(":")).join("|")
  })
}
