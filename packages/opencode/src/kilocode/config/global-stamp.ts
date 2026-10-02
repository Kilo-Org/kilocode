import path from "path"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Effect } from "effect"

export namespace KilocodeGlobalConfigStamp {
  const files = ["config.json", "kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc", "config"]

  // Hash the file contents. Metadata alone is not enough: a same-size rewrite
  // inside one clock tick leaves mtime, ctime, size and ino unchanged, which
  // hides the edit. That gap is real on runners with coarse file timestamps
  // (a Linux CI runner measured a ~4ms clock granularity). Read the small
  // global config files with node:fs instead of the FSUtil service to keep the
  // per-check cost down.
  export const read = Effect.fnUntraced(function* (dir: string) {
    const parts = yield* Effect.forEach(
      files,
      Effect.fnUntraced(function* (file) {
        const source = path.join(dir, file)
        const text = yield* Effect.promise(() => readFile(source, "utf8").catch(() => ""))
        return `${source}\u0000${text}`
      }),
      { concurrency: "unbounded" },
    )
    return createHash("sha1").update(parts.join("\u0001")).digest("hex")
  })
}
