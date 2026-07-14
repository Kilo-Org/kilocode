import { Effect, Schema, Scope } from "effect" // kilocode_change - stable object reads do not use Option
import { NonNegativeInt } from "@opencode-ai/core/schema"
import * as path from "path"
import { Readable } from "stream" // kilocode_change
import { createInterface } from "readline"
import * as Tool from "./tool"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./read.txt"
import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config" // kilocode_change - optional configured reference authorization
import { assertExternalDirectoryEffect } from "./external-directory"
import { Instruction } from "../session/instruction"
import { isPdfAttachment, sniffAttachmentMime } from "@/util/media"
// kilocode_change start
import * as Encoding from "../kilocode/encoding"
import { KiloReference } from "@/kilocode/reference/contains"
import * as KiloConfiguredReference from "@/kilocode/reference"
import { KiloReadObject } from "@/kilocode/tool/read-object"
import * as Extract from "../kilocode/tool/read-extract"
import * as TextStream from "../kilocode/text-stream"
// kilocode_change end

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
// kilocode_change start - report the safe Unicode slice length
const suffix = (length: number) => `... (line truncated to ${length} chars)`
// kilocode_change end
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`
const SAMPLE_BYTES = 4096
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

// `offset` and `limit` were originally `z.coerce.number()` — the runtime
// coercion was useful when the tool was called from a shell but serves no
// purpose in the LLM tool-call path (the model emits typed JSON). The JSON
// Schema output is identical (`type: "number"`), so the LLM view is
// unchanged; purely CLI-facing uses must now send numbers rather than strings.
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file or directory to read" }),
  offset: Schema.optional(NonNegativeInt).annotate({
    description: "The line number to start reading from (1-indexed)",
  }),
  limit: Schema.optional(NonNegativeInt).annotate({
    description: "The maximum number of lines to read (defaults to 2000)",
  }),
})

type Display =
  | {
      type: "directory"
      path: string
      entries: string[]
      offset: number
      totalEntries: number
      truncated: boolean
    }
  | {
      type: "file"
      path: string
      text: string
      lineStart: number
      lineEnd: number
      totalLines: number
      truncated: boolean
    }

type Metadata = {
  preview: string
  truncated: boolean
  loaded: string[]
  display?: Display
}

export const ReadTool = Tool.define<
  typeof Parameters,
  Metadata,
  FSUtil.Service | Instruction.Service | LSP.Service | Scope.Scope
>(
  "read",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const instruction = yield* Instruction.Service
    const lsp = yield* LSP.Service
    const scope = yield* Scope.Scope

    // kilocode_change start - authorize missing paths without enumerating sibling names
    const miss = Effect.fn("ReadTool.miss")(function* (filepath: string, worktree: string, ctx: Tool.Context) {
      const dir = path.dirname(filepath)
      const parent = yield* fs.realPath(dir).pipe(Effect.option)
      if (parent._tag === "None") return yield* Effect.fail(new Error(`File not found: ${filepath}`))
      yield* assertExternalDirectoryEffect(ctx, parent.value, { bypass: false, kind: "directory" })
      yield* ctx.ask({
        permission: "read",
        patterns: [...new Set([filepath, parent.value].map((item) => path.relative(worktree, item)))],
        always: ["*"],
        metadata: {},
      })
      return yield* Effect.fail(new Error(`File not found: ${filepath}`))
    })
    // kilocode_change end

    const warm = Effect.fn("ReadTool.warm")(function* (filepath: string) {
      // LSP warm-up is optional; do not let a background defect fail an otherwise successful read.
      yield* lsp.touchFile(filepath).pipe(Effect.ignoreCause, Effect.forkIn(scope))
    })

    const list = Effect.fn("ReadTool.list")(function* (filepath: string) {
      const items = yield* fs.readDirectoryEntries(filepath)
      return yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* (item) {
          if (item.type === "directory") return item.name + "/"
          if (item.type !== "symlink") return item.name

          const target = yield* fs.stat(path.join(filepath, item.name)).pipe(Effect.catch(() => Effect.void))
          if (target?.type === "Directory") return item.name + "/"
          return item.name
        }),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items: string[]) => items.sort((a, b) => a.localeCompare(b))))
    })

    // kilocode_change start - extracted formats and text consume the authorized open object
    const lines = Effect.fn("ReadTool.lines")(
      (file: KiloReadObject.File, opts: { limit: number; offset: number }, abort: AbortSignal) =>
        Effect.tryPromise({
          try: async (signal) => {
            const combined = AbortSignal.any([abort, signal])
            const extracted = Extract.accepts(file.requested)
              ? await Extract.open(file.requested, await file.read(Extract.limit(file.requested), combined))
              : undefined
            if (extracted) return collect(TextStream.abortable(extracted, combined), opts)
            return TextStream.withFallback(
              () => file.stream(combined),
              (next) => file.read(undefined, next),
              (stream) => collect(stream, opts),
              combined,
            )
          },
          catch: (err) => (err instanceof Error ? err : new Error(String(err))),
        }),
    )
    // kilocode_change end

    const isBinaryFile = (filepath: string, bytes: Uint8Array) => {
      const ext = path.extname(filepath).toLowerCase()
      switch (ext) {
        case ".zip":
        case ".tar":
        case ".gz":
        case ".exe":
        case ".dll":
        case ".so":
        case ".class":
        case ".jar":
        case ".war":
        case ".7z":
        case ".doc":
        case ".docx":
        case ".xls":
        case ".xlsx":
        case ".ppt":
        case ".pptx":
        case ".odt":
        case ".ods":
        case ".odp":
        case ".bin":
        case ".dat":
        case ".obj":
        case ".o":
        case ".a":
        case ".lib":
        case ".wasm":
        case ".pyc":
        case ".pyo":
          return true
      }

      if (bytes.length === 0) return false

      // kilocode_change start - UTF-16/32 BOM: NUL bytes are legitimate, skip the NUL/control-char heuristic
      const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (Encoding.hasUtf16Bom(buf, bytes.length) || Encoding.hasUtf32Bom(buf, bytes.length)) return false
      // kilocode_change end

      let nonPrintableCount = 0
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) return true
        if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
          nonPrintableCount++
        }
      }

      return nonPrintableCount / bytes.length > 0.3
    }

    const run = Effect.fn("ReadTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      const instance = yield* InstanceState.context
      let filepath = params.filePath
      if (!path.isAbsolute(filepath)) {
        filepath = path.resolve(instance.directory, filepath)
      }
      if (process.platform === "win32") {
        filepath = FSUtil.normalizePath(filepath)
      }
      const requested = filepath
      const title = path.relative(instance.worktree, requested)
      // kilocode_change start - resolve V1 configured references without introducing a Core location-layer dependency
      const config = yield* Effect.serviceOption(Config.Service)
      const references =
        config._tag === "Some"
          ? KiloConfiguredReference.resolveAll({
              references: (yield* config.value.get()).reference ?? {},
              directory: instance.directory,
              worktree: instance.worktree,
            })
          : []
      // kilocode_change end
      // kilocode_change start - fail before read authorization when the target is missing
      const info = yield* fs.stat(requested).pipe(
        Effect.catchIf(
          (err) => "reason" in err && err.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
      )
      if (!info) {
        return yield* miss(requested, instance.worktree, ctx)
      }
      // kilocode_change end

      // kilocode_change start - directory mentions expose only a bound listing, never child file bodies
      if (info.type === "Directory") {
        const resolved = yield* fs.realPath(requested)
        const target = process.platform === "win32" ? FSUtil.normalizePath(resolved) : resolved
        const explicit =
          typeof ctx.extra?.["referenceRoot"] === "string" &&
          (yield* KiloReference.path(fs, ctx.extra["referenceRoot"], target))
        const referenced =
          explicit ||
          (yield* KiloReference.contains({ fs, references, target }))
        yield* assertExternalDirectoryEffect(ctx, target, { bypass: referenced, kind: "directory" })
        yield* ctx.ask({
          permission: "read",
          patterns: [...new Set([requested, target].map((item) => path.relative(instance.worktree, item)))],
          always: ["*"],
          metadata: {},
        })
        if (ctx.extra?.["denyDirectory"] === true) {
          return yield* Effect.fail(new Error(`Directory attachments cannot be expanded: ${requested}`))
        }
        const items = yield* list(target)
        const limit = Math.max(1, params.limit ?? DEFAULT_READ_LIMIT) // kilocode_change - prevent zero-limit loops
        const offset = params.offset || 1
        const start = offset - 1
        const sliced = items.slice(start, start + limit)
        const truncated = start + sliced.length < items.length

        return {
          title,
          output: [
            `<path>${target}</path>`,
            `<type>directory</type>`,
            `<entries>`,
            sliced.join("\n"),
            truncated
              ? `\n(Showing ${sliced.length} of ${items.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
              : `\n(${items.length} entries)`,
            `</entries>`,
          ].join("\n"),
          metadata: {
            preview: sliced.slice(0, 20).join("\n"),
            truncated,
            loaded: [],
            display: {
              type: "directory" as const,
              path: target,
              entries: sliced,
              offset,
              totalEntries: items.length,
              truncated,
            },
          },
        }
      }
      // kilocode_change start - authorize metadata, then bind every content read to the same reopened object
      const file = yield* KiloReadObject.file(requested)
      const explicit =
        typeof ctx.extra?.["referenceRoot"] === "string" &&
        (yield* KiloReference.path(fs, ctx.extra["referenceRoot"], file.target))
      const referenced =
        explicit ||
        (yield* KiloReference.contains({ fs, references, target: file.target }))
      yield* assertExternalDirectoryEffect(ctx, file.target, { bypass: referenced, kind: "file" })
      yield* ctx.ask({
        permission: "read",
        patterns: [...new Set([requested, file.target].map((item) => path.relative(instance.worktree, item)))],
        always: ["*"],
        metadata: {},
      })
      return yield* KiloReadObject.use(file, (bound) =>
        Effect.gen(function* () {
          const loaded =
            ctx.extra?.["includeInstructions"] === false
              ? []
              : yield* instruction.resolve(ctx.messages, bound.target, ctx.messageID)
          const sample = yield* Effect.tryPromise({
            try: (signal) => bound.sample(SAMPLE_BYTES, AbortSignal.any([ctx.abort, signal])),
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          })
          const mime = sniffAttachmentMime(sample, FSUtil.mimeType(requested))
          const isImage = SUPPORTED_IMAGE_MIMES.has(mime)

          if (isImage || isPdfAttachment(mime)) {
            const bytes = yield* Effect.tryPromise({
              try: (signal) => bound.read(undefined, AbortSignal.any([ctx.abort, signal])),
              catch: (err) => (err instanceof Error ? err : new Error(String(err))),
            })
            const msg = isPdfAttachment(mime) ? "PDF read successfully" : "Image read successfully"
            return {
              title,
              output: msg,
              metadata: { preview: msg, truncated: false, loaded: loaded.map((item) => item.filepath) },
              attachments: [{ type: "file" as const, mime, url: `data:${mime};base64,${bytes.toString("base64")}` }],
            }
          }

          if (!Extract.binary(requested) && isBinaryFile(requested, sample)) {
            return yield* Effect.fail(new Error(`Cannot read binary file: ${requested}`))
          }
          const file = yield* lines(
            bound,
            { limit: Math.max(1, params.limit ?? DEFAULT_READ_LIMIT), offset: params.offset || 1 },
            ctx.abort,
          )
          if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
            return yield* Effect.fail(
              new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`),
            )
          }

          let output = [`<path>${bound.target}</path>`, `<type>file</type>`, "<content>\n"].join("\n")
          output += file.raw.map((line, i) => `${i + file.offset}: ${line}`).join("\n")
          const last = file.offset + file.raw.length - 1
          const next = last + 1
          const truncated = file.more || file.cut
          if (file.cut) {
            output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`
          } else if (file.more) {
            output += `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)`
          } else {
            output += `\n\n(End of file - total ${file.count} lines)`
          }
          output += "\n</content>"
          yield* warm(bound.target)
          if (loaded.length > 0) {
            output += `\n\n<system-reminder>\n${loaded.map((item) => item.content).join("\n\n")}\n</system-reminder>`
          }
          return {
            title,
            output,
            metadata: {
              preview: file.raw.slice(0, 20).join("\n"),
              truncated,
              loaded: loaded.map((item) => item.filepath),
              display: {
                type: "file" as const,
                path: bound.target,
                text: file.raw.join("\n"),
                lineStart: file.offset,
                lineEnd: last,
                totalLines: file.count,
                truncated,
              },
            },
          }
        }),
      )
      // kilocode_change end
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

// kilocode_change start - extracted formats use native readers; ordinary text is supplied by FSUtil above
async function collect(stream: Readable, opts: { limit: number; offset: number }) {
  // kilocode_change end
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
      // kilocode_change start - keep truncated output valid Unicode
      const sliced = TextStream.safeSlice(text, MAX_LINE_LENGTH)
      const line = text.length > MAX_LINE_LENGTH ? sliced + suffix(sliced.length) : text
      // kilocode_change end
      const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
      if (bytes + size > MAX_BYTES) {
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
