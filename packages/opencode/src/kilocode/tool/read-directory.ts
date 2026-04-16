import { Effect } from "effect"
import { createReadStream } from "fs"
import { lstat, open } from "fs/promises"
import * as path from "path"
import { createInterface } from "readline"
import { AppFileSystem } from "../../filesystem"
import { Instance } from "../../project/instance"

const LIMIT = 2000
const MAX = 2000
const SUFFIX = `... (line truncated to ${MAX} chars)`
const BYTES = 50 * 1024

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
    { concurrency: "unbounded" },
  )
  return files.filter((item): item is DirectoryFile => item !== undefined)
})

async function lines(filepath: string, opts: { limit: number; offset: number }) {
  const stream = createReadStream(filepath, { encoding: "utf8" })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const start = opts.offset - 1
  const raw: string[] = []
  let bytes = 0
  let count = 0
  let cut = false
  let more = false
  try {
    for await (const text of rl) {
      count += 1
      if (count <= start) continue
      if (raw.length >= opts.limit) {
        more = true
        continue
      }
      const line = text.length > MAX ? text.substring(0, MAX) + SUFFIX : text
      const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
      if (bytes + size > BYTES) {
        cut = true
        more = true
        break
      }
      raw.push(line)
      bytes += size
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  return { raw, count, cut, more, offset: opts.offset }
}

async function isBinaryFile(filepath: string, size: number): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase()
  if (
    [
      ".zip",
      ".tar",
      ".gz",
      ".exe",
      ".dll",
      ".so",
      ".class",
      ".jar",
      ".war",
      ".7z",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".odt",
      ".ods",
      ".odp",
      ".bin",
      ".dat",
      ".obj",
      ".o",
      ".a",
      ".lib",
      ".wasm",
      ".pyc",
      ".pyo",
    ].includes(ext)
  ) {
    return true
  }

  if (size === 0) return false

  const file = await open(filepath, "r")
  try {
    const sample = Math.min(4096, size)
    const bytes = Buffer.alloc(sample)
    const result = await file.read(bytes, 0, sample, 0)
    if (result.bytesRead === 0) return false
    let count = 0
    for (let i = 0; i < result.bytesRead; i++) {
      if (bytes[i] === 0) return true
      if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) count++
    }
    return count / result.bytesRead > 0.3
  } finally {
    await file.close()
  }
}
