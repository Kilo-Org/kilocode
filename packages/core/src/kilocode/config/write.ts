export * as KiloConfigWriter from "./write.js"

import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"

/**
 * Filesystem or content failure from a Kilo config write. `reason` tells the caller how to recover: `invalid` and
 * `conflict` leave the file untouched, `io` is an unexpected filesystem error.
 */
export class WriteError extends Schema.TaggedError<WriteError>()("KiloConfigWriterError", {
  method: Schema.String,
  reason: Schema.Literals(["io", "invalid", "conflict"]),
  file: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    if (this.reason === "invalid") return `${this.file} is not valid JSON or JSONC; it was left unchanged`
    if (this.reason === "conflict") return `${this.file} changed since the caller read it`
    const detail = this.cause instanceof Error ? this.cause.message : this.cause && String(this.cause)
    return `Kilo config write failed: ${this.method}${detail ? `: ${detail}` : ""}`
  }
}

/** A content revision of a config file, stable while its bytes are unchanged. */
export interface Revision {
  readonly file: string
  readonly hash: string
}

export interface Target {
  readonly directory: string
  /** Resolve against the global config directory instead of a project directory; changes the candidate order. */
  readonly global?: boolean
}

export interface WriteInput {
  readonly target: Target
  /** JSON path of the value to set, or to remove when `value` is undefined. */
  readonly path: readonly string[]
  readonly value: unknown
  /**
   * Optimistic-concurrency guard checked under the writer's lock. A string fails with reason `conflict` unless the
   * current revision matches; `null` requires the target to be absent, for a create-if-absent write; omitted writes
   * unconditionally.
   */
  readonly expectedRevision?: string | null
}

export interface WriteResult {
  readonly file: string
  /** Revision after the write, to pass to a later write as `expectedRevision`. */
  readonly revision: string
  readonly created: boolean
}

export interface Interface {
  /** The file a write to `target` would use: the first existing candidate, else the `newFile` name. */
  readonly target: (target: Target) => Effect.Effect<string, WriteError>
  /** The current content revision, or undefined when the file does not exist. */
  readonly revision: (file: string) => Effect.Effect<Revision | undefined, WriteError>
  /** Set, or remove, the value at `path`, preserving surrounding comments and formatting. */
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, WriteError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/KiloConfigWriter") {}

export interface Options {
  /**
   * Runs after each successful write. It carries the config reload signal: this module cannot reach `Config`'s
   * private reload, so the settings RPC provides it. A write under a watched config root also reloads on its own;
   * the hook additionally reloads a file created outside the watched set.
   */
  readonly reload?: Effect.Effect<void>
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex")

const formatting = { tabSize: 2, insertSpaces: true } as const

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      // Serializes read-check-write within this process, like Config.update's updateLock. Cross-process writers are
      // not covered: the revision guard detects a conflicting external write, it does not prevent one.
      const lock = Semaphore.makeUnsafe(1)

      const mapIO = (method: string, file: string) => (cause: FSUtil.Error) =>
        new WriteError({ method, reason: "io", file, cause })

      // Only NotFound means the file is absent. An unreadable file is an error, not an empty one, so a denied
      // read never overwrites the existing file with defaults.
      const read = (file: string) =>
        fs.readFileString(file).pipe(
          Effect.catchIf(
            (error) => error.reason._tag === "NotFound",
            () => Effect.undefined,
          ),
          Effect.mapError(mapIO("read", file)),
        )

      const target = Effect.fn("KiloConfigWriter.target")(function* (input: Target) {
        for (const candidate of KiloConfigFiles.writeCandidates(input.directory, input.global ?? false)) {
          if (yield* fs.isFile(candidate)) return candidate
        }
        return path.join(input.directory, KiloConfigFiles.newFile)
      })

      const revision = Effect.fn("KiloConfigWriter.revision")(function* (file: string) {
        const text = yield* read(file)
        return text === undefined ? undefined : { file, hash: hash(text) }
      })

      // Create the temporary file with 0600 and rename it over the target: the target is never briefly
      // umask-readable, and a crash leaves the old file intact rather than a partial one.
      const writeAtomic = Effect.fnUntraced(function* (file: string, content: string) {
        yield* fs.ensureDir(path.dirname(file))
        const temporary = `${file}.${randomUUID()}.tmp`
        const discard = fs.remove(temporary, { force: true }).pipe(Effect.orDie)
        yield* fs
          .writeFileString(temporary, content, { mode: 0o600, flag: "wx" })
          .pipe(Effect.tapError(() => discard))
        yield* fs.rename(temporary, file).pipe(Effect.tapError(() => discard))
      })

      const write = Effect.fn("KiloConfigWriter.write")(
        function* (input: WriteInput) {
          const file = yield* target(input.target)
          const current = yield* read(file)
          const text = current ?? "{}\n"
          const errors: ParseError[] = []
          parse(text, errors, { allowTrailingComma: true })
          if (errors.length > 0)
            return yield* new WriteError({
              method: "write",
              reason: "invalid",
              file,
              cause: `${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset}`,
            })
          const expected = input.expectedRevision
          if (expected !== undefined) {
            const before = hash(text)
            const matched = expected === null ? current === undefined : current !== undefined && expected === before
            if (!matched) return yield* new WriteError({ method: "write", reason: "conflict", file })
          }
          const updated = applyEdits(text, modify(text, [...input.path], input.value, { formattingOptions: formatting }))
          const content = updated.endsWith("\n") ? updated : `${updated}\n`
          yield* writeAtomic(file, content).pipe(Effect.mapError(mapIO("write", file)))
          yield* options?.reload ?? Effect.void
          return { file, revision: hash(content), created: current === undefined }
        },
        (effect) => lock.withPermit(effect),
      )

      return Service.of({ target, revision, write })
    }),
  )
