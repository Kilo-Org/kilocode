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
let extract: Promise<typeof import("./read-extract")> | undefined
const extractor = () => (extract ??= import("./read-extract"))

const MAX_LINE_LENGTH = 2_000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`

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
  try {
    for await (const text of reader) {
      signal?.throwIfAborted()
      count += 1
      if (count < offset) continue
      if (lines.length >= limit || bytes >= ReadToolFileSystem.MAX_READ_BYTES) {
        next = count
        break
      }
      const line = text.length > MAX_LINE_LENGTH ? text.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text
      const size = Buffer.byteLength(line, "utf-8") + (lines.length > 0 ? 1 : 0)
      if (bytes + size > ReadToolFileSystem.MAX_READ_BYTES) {
        next = count
        break
      }
      lines.push(line)
      bytes += size
    }
  } finally {
    reader.close()
    stream.destroy()
  }
  if (lines.length === 0 && offset !== 1)
    throw new ReadToolFileSystem.OffsetOutOfRangeError({ offset, lines: count })
  return new ReadToolFileSystem.TextPage({
    type: "text-page",
    content: lines.join("\n"),
    mime: FSUtil.mimeType(input),
    offset,
    truncated: next !== undefined,
    ...(next === undefined ? {} : { next }),
  })
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// kilo_port(unattributed:tool:d6a5d2974993)
export const read = (files: Files, input: AbsolutePath, resource: string, value: ReadToolFileSystem.PageInput = {}) => {
  const native = ReadToolFileSystem.read(files, input, resource, value)
  if (!accepts(input)) return native
  return Effect.gen(function* () {
    const Extract = yield* Effect.promise(extractor)
    if (!Extract.accepts(input)) return yield* native
    const type = yield* Environment.typeFollowing(files, input).pipe(
      Effect.catchTag("Environment.NotFound", () => Effect.succeed(undefined)),
    )
    if (type !== "file") return yield* native
    const limit = Extract.limit(input)
    const { bytes } = yield* files
      .read(input, limit === undefined ? undefined : { offset: 0, length: limit })
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
