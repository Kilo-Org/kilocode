import { Effect } from "effect"
import { lstat } from "fs/promises"
import * as path from "path"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { Instance } from "../../project/instance"
import { isBinaryFile, lines } from "../../tool/read"

const LIMIT = 2000
const CONCURRENCY = 8

export type DirectoryFile = {
  filepath: string
  content: string
}

export const readDirectoryFiles = Effect.fn("KiloReadDirectory.files")(function* (
  fs: AppFileSystem.Interface,
  filepath: string,
  items: string[],
) {
  const entries = yield* fs.readDirectoryEntries(filepath).pipe(Effect.catch(() => Effect.succeed([])))
  const types = new Map(entries.map((entry) => [entry.name, entry.type]))
  const files = yield* Effect.forEach(
    items.filter((item) => !item.endsWith("/") && types.get(item) === "file"),
    Effect.fnUntraced(function* (item) {
      const child = path.join(filepath, item)
      const info = yield* Effect.promise(() => lstat(child)).pipe(Effect.catch(() => Effect.void))
      if (!info?.isFile()) return
      const binary = yield* Effect.promise(() => isBinaryFile(child, info.size)).pipe(
        Effect.catch(() => Effect.succeed(true)),
      )
      if (binary) return
      const file = yield* Effect.promise(() => lines(child, { limit: LIMIT, offset: 1 })).pipe(
        Effect.catch(() => Effect.void),
      )
      if (!file) return
      const rel = path.relative(Instance.directory, child).replaceAll("\\", "/")
      const note = file.cut || file.more ? "\n\n(File truncated)" : ""
      return {
        filepath: child,
        content: `<file_content path="${rel}">\n${file.raw.join("\n")}${note}\n</file_content>`,
      }
    }),
    { concurrency: CONCURRENCY },
  )
  return files.filter((item): item is DirectoryFile => item !== undefined)
})
