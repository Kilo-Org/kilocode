export * as KiloConfigWriter from "./write.js"

import { createHash } from "node:crypto"
import path from "node:path"
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import { Context, Effect, Layer, Schema } from "effect"
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
  /** When set, the write fails with reason `conflict` unless the current revision matches. */
  readonly expectedRevision?: string
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

      const read = (file: string) =>
        fs.readFileStringSafe(file).pipe(
          Effect.mapError((cause) => new WriteError({ method: "read", reason: "io", file, cause })),
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

      const write = Effect.fn("KiloConfigWriter.write")(function* (input: WriteInput) {
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
        const before = hash(text)
        if (input.expectedRevision !== undefined && input.expectedRevision !== before)
          return yield* new WriteError({ method: "write", reason: "conflict", file })
        const updated = applyEdits(text, modify(text, [...input.path], input.value, { formattingOptions: formatting }))
        const content = updated.endsWith("\n") ? updated : `${updated}\n`
        yield* fs.writeWithDirs(file, content, 0o600).pipe(
          Effect.mapError((cause) => new WriteError({ method: "write", reason: "io", file, cause })),
        )
        yield* options?.reload ?? Effect.void
        return { file, revision: hash(content), created: current === undefined }
      })

      return Service.of({ target, revision, write })
    }),
  )
