import path from "path"
import type { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"

export namespace KilocodeGlobalConfigStamp {
  const files = ["config.json", "kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc", "config"]

  export const read = Effect.fnUntraced(function* (
    fs: Pick<AppFileSystem.Interface, "readFileStringSafe">,
    dir: string,
  ) {
    const entries = yield* Effect.forEach(
      files,
      Effect.fnUntraced(function* (file) {
        const source = path.join(dir, file)
        const text = yield* fs.readFileStringSafe(source).pipe(Effect.catch(() => Effect.succeed(undefined)))
        return [source, text ?? null] as const
      }),
      { concurrency: "unbounded" },
    )
    return JSON.stringify(entries)
  })
}
