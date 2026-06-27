import { dirname } from "node:path"
import { Effect } from "effect"
import { batchMutations, enabled, ensureDirectory } from "@kilocode/sandbox"
import type { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Encoding from "../encoding"
import * as Bom from "@/util/bom"

/**
 * Encoding-aware file operations routed through the application's filesystem
 * capability so active sandbox profiles apply to tool writes.
 */

const wrap = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)))

export const read = (fs: AppFileSystem.Interface, path: string) =>
  Effect.gen(function* () {
    const bytes = yield* fs.readFile(path).pipe(Effect.mapError(wrap))
    const data = Buffer.from(bytes)
    const encoding = Encoding.detect(data)
    return { text: Encoding.decode(data, encoding), encoding }
  })

export const write = (fs: AppFileSystem.Interface, path: string, text: string, encoding: string = Encoding.DEFAULT) =>
  Effect.gen(function* () {
    const data = Encoding.encode(text, encoding)
    if (!(yield* enabled)) return yield* fs.writeWithDirs(path, data)
    yield* batchMutations(
      Effect.gen(function* () {
        yield* ensureDirectory(fs, dirname(path))
        yield* fs.writeFile(path, data)
      }),
    )
  }).pipe(Effect.mapError(wrap))

export const sync = (fs: AppFileSystem.Interface, path: string, bom: boolean, encoding: string) =>
  Effect.gen(function* () {
    const current = yield* read(fs, path)
    const target =
      encoding === Encoding.UTF8_BOM && !bom
        ? Encoding.DEFAULT
        : encoding === Encoding.DEFAULT && bom
          ? Encoding.UTF8_BOM
          : encoding
    yield* write(fs, path, Bom.join(current.text, bom), target)
    return current.text
  })
