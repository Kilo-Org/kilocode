export * as KiloRead from "./index.js"

import type { Files } from "@opencode/core/environment/index"
import { Environment } from "@opencode/core/environment/index"
import type { AbsolutePath } from "@opencode/core/schema"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { define } from "@opencode/plugin/effect/plugin"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Layer } from "effect"
import { extname } from "path"
import { createInterface } from "readline"
import type { Readable } from "stream"

// Extraction parsers are heavy, so only an accepted path loads them. Keep the list in sync with
// read-extract.ts; the tool must not pay for mammoth and SheetJS on every start.
const ACCEPTED = new Set([".docx", ".xlsx", ".ods", ".ipynb"])
const accepts = (file: string) => ACCEPTED.has(extname(file).toLowerCase())
const loadExtract = () => import("./read-extract")
let extract: ReturnType<typeof loadExtract> | undefined
const extractor = () => (extract ??= loadExtract())

const MAX_LINE_LENGTH = 2_000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
// The native reader's cap on the last lines it returns for an offset past the end.
const TAIL_LINES = 100
const clamp = (text: string) =>
  text.length > MAX_LINE_LENGTH ? text.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text

/** One sentence so the model knows the formats this build extracts instead of rejecting as binary. */
export const DESCRIPTION_SUFFIX =
  " Office documents (.docx), spreadsheets (.xlsx, .ods) and notebooks (.ipynb) are returned as text."

export const KiloReadPlugin = define({
  id: "kilocode.read",
  effect: Effect.fn("KiloRead.Plugin")(function* (ctx) {
    yield* ctx.tool.transform((editor) =>
      editor.update("read", (tool) => {
        tool.description += DESCRIPTION_SUFFIX
      }),
    )
  }),
})

// Extraction replaces the bytes the native reader sees, so it returns a page with the same limits
// and continuation as upstream. The read tool, its bounding and its instruction loading stay as
// upstream: the host only swaps the reader behind the tool.
async function page(
  stream: Readable,
  input: AbsolutePath,
  value: ReadToolFileSystem.PageInput,
  signal?: AbortSignal,
) {
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  const offset = value.offset || 1
  const limit = Math.min(value.limit || ReadToolFileSystem.MAX_READ_LINES, ReadToolFileSystem.MAX_READ_LINES)
  const lines: string[] = []
  let bytes = 0
  let count = 0
  let next: number | undefined
  // Adds a line to the page, or records where the next page starts once the page is full.
  const add = (line: string, number: number) => {
    const size = Buffer.byteLength(line, "utf-8") + (lines.length > 0 ? 1 : 0)
    if (lines.length >= limit || bytes + size > ReadToolFileSystem.MAX_READ_BYTES) {
      next = number
      return false
    }
    lines.push(line)
    bytes += size
    return true
  }
  // A negative offset counts back from the last line and an offset past the end returns the last lines, as in the
  // native reader. Both are known only at the end, so keep the latest lines that either answer can need.
  const keep = offset < 0 ? -offset : Math.min(value.limit || TAIL_LINES, TAIL_LINES)
  const recent: string[] = []
  try {
    for await (const text of reader) {
      signal?.throwIfAborted()
      count += 1
      if (offset > 0 && count >= offset) {
        if (!add(clamp(text), count)) break
        continue
      }
      recent.push(clamp(text))
      if (recent.length >= keep * 2) recent.splice(0, recent.length - keep)
    }
  } finally {
    reader.close()
    stream.destroy()
  }
  const kept = recent.slice(-keep)
  const result = (start: number) =>
    new ReadToolFileSystem.TextPage({
      type: "text-page",
      content: lines.join("\n"),
      mime: FSUtil.mimeType(input),
      offset: start,
      truncated: next !== undefined,
      ...(next === undefined ? {} : { next }),
    })
  if (offset < 0) {
    const start = count - kept.length + 1
    kept.every((line, index) => add(line, start + index))
    return result(start)
  }
  if (offset <= Math.max(1, count)) return result(offset)
  // Past the end: the last lines that fit, ending at the last line.
  for (const line of kept.toReversed()) {
    const size = Buffer.byteLength(line, "utf-8") + (lines.length > 0 ? 1 : 0)
    if (bytes + size > ReadToolFileSystem.MAX_READ_BYTES) break
    lines.unshift(line)
    bytes += size
  }
  return result(count - lines.length + 1)
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Content operations follow a final symlink, but stat reports the link. Ask for zero bytes to get the
// target's size without reading it.
const follow = (files: Files, path: AbsolutePath) =>
  files.stat(path).pipe(
    Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)),
    Effect.flatMap((info) => {
      if (info === undefined || info.type !== "symlink") return Effect.succeed(info)
      return files.read(path, { offset: 0, length: 0 }).pipe(
        Effect.map((result) => result.info),
        Effect.catchTag("Environment.WrongKind", () => Effect.succeed(info)),
      )
    }),
  )

// kilo_port(unattributed:tool:d6a5d2974993)
export const read = (files: Files, input: AbsolutePath, resource: string, value: ReadToolFileSystem.PageInput = {}) => {
  const native = ReadToolFileSystem.read(files, input, resource, value)
  if (!accepts(input)) return native
  return Effect.gen(function* () {
    const Extract = yield* Effect.promise(extractor)
    if (!Extract.accepts(input)) return yield* native
    const info = yield* follow(files, input)
    if (info?.type !== "file") return yield* native
    const limit = Extract.limit(input)
    // A ranged read allocates its whole length, so take the file size. The format limit still caps a
    // spreadsheet that is larger than the parser accepts.
    const { bytes } = yield* files
      .read(input, { offset: 0, length: Math.min(info.size + 1, limit ?? Infinity) })
      .pipe(
        Effect.catchTag("Environment.WrongKind", () =>
          Effect.fail(new ReadToolFileSystem.PathKindError({ resource, expected: "a file" })),
        ),
      )
    return yield* Effect.tryPromise({
      try: async (signal) => {
        const stream = await Extract.open(input, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
        if (!stream) throw new Error(`Cannot extract ${resource}`)
        return page(stream, input, value, signal)
      },
      catch: (error) => new ReadToolFileSystem.ReaderError({ resource, detail: message(error) }),
    })
  })
}

const layer = Layer.effect(
  ReadToolFileSystem.Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    return ReadToolFileSystem.Service.of({
      list: environment.files.list,
      read: (path, resource, value) => read(environment.files, path, resource, value),
    })
  }),
)

export const node = makeLocationNode({
  service: ReadToolFileSystem.Service,
  layer,
  deps: [Environment.node],
})
