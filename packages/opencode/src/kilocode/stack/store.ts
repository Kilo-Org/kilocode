import path from "node:path"
import { createHash } from "node:crypto"
import { lstat } from "node:fs/promises"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Context, Effect, Layer, Schema, Scope } from "effect"
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import { InstanceState } from "@/effect/instance-state"
import { Stack } from "./schema"

export namespace StackStore {
  export const MISSING_SENTINEL = "\u0000kilo-stack-store:missing\u0000"

  export type Json = string | number | boolean | null | ReadonlyArray<Json> | { readonly [key: string]: Json }

  export class InvalidJsoncError extends Schema.TaggedErrorClass<InvalidJsoncError>()("StackStoreInvalidJsoncError", {
    path: Schema.String,
    detail: Schema.String,
  }) {}

  export class InvalidStackError extends Schema.TaggedErrorClass<InvalidStackError>()("StackStoreInvalidStackError", {
    path: Schema.String,
  }) {}

  export class InvalidMcpError extends Schema.TaggedErrorClass<InvalidMcpError>()("StackStoreInvalidMcpError", {
    path: Schema.String,
  }) {}

  export class RevisionConflictError extends Schema.TaggedErrorClass<RevisionConflictError>()(
    "StackStoreRevisionConflictError",
    {
      path: Schema.String,
      expected: Stack.Digest,
      actual: Stack.Digest,
    },
  ) {}

  export class PatchError extends Schema.TaggedErrorClass<PatchError>()("StackStorePatchError", {
    path: Schema.String,
  }) {}

  export class FileError extends Schema.TaggedErrorClass<FileError>()("StackStoreFileError", {
    path: Schema.String,
    operation: Schema.Literals(["read", "create", "write", "rename", "remove"]),
  }) {}

  export class TransactionError extends Schema.TaggedErrorClass<TransactionError>()("StackStoreTransactionError", {
    operation: Schema.Literals(["commit", "rollback"]),
  }) {}

  export type ReadError = InvalidJsoncError | InvalidStackError | InvalidMcpError | FileError
  export type PrepareError = ReadError | RevisionConflictError | PatchError
  export type CommitError = RevisionConflictError | TransactionError | FileError
  export type RollbackError = RevisionConflictError | TransactionError | FileError

  export interface Snapshot {
    readonly path: string
    readonly raw?: string
    readonly revision: Stack.Digest
    readonly stack?: Stack.Config
    readonly mcp: Readonly<Record<string, unknown>>
  }

  export interface PrepareInput {
    readonly revision: Stack.Digest
    readonly stack: Stack.Config
    readonly mcp: Readonly<Record<string, Json | undefined>>
  }

  export interface Prepared {
    readonly path: string
    readonly revision: Stack.Digest
    readonly nextRevision: Stack.Digest
  }

  export interface Committed {
    readonly path: string
    readonly revision: Stack.Digest
    readonly previousRevision: Stack.Digest
  }

  export interface Interface {
    readonly path: () => Effect.Effect<string, FileError>
    readonly read: () => Effect.Effect<Snapshot, ReadError>
    readonly prepare: (input: PrepareInput) => Effect.Effect<Prepared, PrepareError, Scope.Scope>
    readonly commit: (prepared: Prepared) => Effect.Effect<Committed, CommitError>
    readonly rollback: (committed: Committed) => Effect.Effect<void, RollbackError>
    readonly withLock: <A, E, R>(
      body: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | EffectFlock.LockError | FileError, R>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/StackStore") {}

  interface Parsed {
    readonly stack?: Stack.Config
    readonly mcp: Readonly<Record<string, unknown>>
  }

  interface State {
    readonly path: string
    readonly temp: string
    readonly backup?: string
    readonly revision: Stack.Digest
    readonly next: Stack.Digest
    commit?: Committed
  }

  function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  function missing(value: unknown) {
    return typeof value === "object" && value !== null && "code" in value && value.code === "ENOENT"
  }

  export function revision(raw: string | undefined): Stack.Digest {
    const value = raw ?? MISSING_SENTINEL
    return Schema.decodeUnknownSync(Stack.Digest)(`sha256:${createHash("sha256").update(value).digest("hex")}`)
  }

  function detail(raw: string, errors: ReadonlyArray<ParseError>) {
    return errors
      .map((error) => {
        const before = raw.substring(0, error.offset).split("\n")
        const line = before.length
        const column = before[before.length - 1].length + 1
        return `${printParseErrorCode(error.error)} at line ${line}, column ${column}`
      })
      .join("; ")
  }

  const decode = Effect.fnUntraced(function* (raw: string, file: string) {
    const errors: ParseError[] = []
    const data = yield* Effect.try({
      try: (): unknown => parse(raw, errors, { allowTrailingComma: true }),
      catch: () => new InvalidJsoncError({ path: file, detail: "JSONC parser failed" }),
    })
    if (errors.length > 0) return yield* new InvalidJsoncError({ path: file, detail: detail(raw, errors) })
    if (!record(data)) return yield* new InvalidJsoncError({ path: file, detail: "Root value must be an object" })

    const stack =
      data.stack === undefined
        ? undefined
        : yield* Schema.decodeUnknownEffect(Stack.Config)(data.stack, { onExcessProperty: "error" }).pipe(
            Effect.mapError(() => new InvalidStackError({ path: file })),
          )
    if (data.mcp !== undefined && !record(data.mcp)) return yield* new InvalidMcpError({ path: file })
    return { ...(stack === undefined ? {} : { stack }), mcp: data.mcp ?? {} } satisfies Parsed
  })

  const patch = Effect.fnUntraced(function* (raw: string | undefined, input: PrepareInput, file: string) {
    return yield* Effect.try({
      try: () => {
        const format = {
          insertSpaces: true,
          tabSize: 2,
          eol: raw?.includes("\r\n") ? "\r\n" : "\n",
        }
        const base = raw ?? "{}\n"
        const stack = applyEdits(base, modify(base, ["stack"], input.stack, { formattingOptions: format }))
        return Object.entries(input.mcp).reduce(
          (result, [id, value]) =>
            applyEdits(result, modify(result, ["mcp", id], value, { formattingOptions: format })),
          stack,
        )
      },
      catch: () => new PatchError({ path: file }),
    })
  })

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const flock = yield* EffectFlock.Service
      const stages = new WeakMap<Prepared, State>()
      const commits = new WeakMap<Committed, State>()

      const target = Effect.fnUntraced(function* (create = false, operation: FileError["operation"] = "read") {
        const ctx = yield* InstanceState.context
        const root = yield* fs
          .realPath(ctx.worktree)
          .pipe(Effect.mapError(() => new FileError({ path: ctx.worktree, operation })))
        if (!(yield* fs.isDir(root))) return yield* new FileError({ path: ctx.worktree, operation })
        const dir = path.join(root, ".kilo")

        const inspect = Effect.fnUntraced(function* () {
          const info = yield* Effect.tryPromise({ try: () => lstat(dir), catch: (cause) => cause }).pipe(
            Effect.catchIf(missing, () => Effect.succeed(undefined)),
            Effect.mapError(() => new FileError({ path: dir, operation })),
          )
          if (!info) return undefined
          if (info.isSymbolicLink() || !info.isDirectory()) return yield* new FileError({ path: dir, operation })
          const real = yield* fs.realPath(dir).pipe(Effect.mapError(() => new FileError({ path: dir, operation })))
          if (!AppFileSystem.contains(root, real) || real !== dir) {
            return yield* new FileError({ path: dir, operation })
          }
          return real
        })

        const existing = yield* inspect()
        if (!existing && create) {
          yield* fs.ensureDir(dir).pipe(Effect.mapError(() => new FileError({ path: dir, operation: "create" })))
          if (!(yield* inspect())) return yield* new FileError({ path: dir, operation: "create" })
        }
        const file = path.join(dir, "kilo.jsonc")
        const info = yield* Effect.tryPromise({ try: () => lstat(file), catch: (cause) => cause }).pipe(
          Effect.catchIf(missing, () => Effect.succeed(undefined)),
          Effect.mapError(() => new FileError({ path: file, operation })),
        )
        if (info?.isSymbolicLink() || (info && !info.isFile())) return yield* new FileError({ path: file, operation })
        if (info) {
          const real = yield* fs.realPath(file).pipe(Effect.mapError(() => new FileError({ path: file, operation })))
          if (!AppFileSystem.contains(root, real) || real !== file)
            return yield* new FileError({ path: file, operation })
        }
        return file
      })

      const source = Effect.fnUntraced(function* (file: string) {
        return yield* fs
          .readFileStringSafe(file)
          .pipe(Effect.mapError(() => new FileError({ path: file, operation: "read" })))
      })

      const load = Effect.fnUntraced(function* (file: string) {
        const raw = yield* source(file)
        const parsed = raw === undefined ? ({ mcp: {} } satisfies Parsed) : yield* decode(raw, file)
        return {
          path: file,
          ...(raw === undefined ? {} : { raw }),
          revision: revision(raw),
          ...(parsed.stack === undefined ? {} : { stack: parsed.stack }),
          mcp: parsed.mcp,
        } satisfies Snapshot
      })

      const read = Effect.fn("StackStore.read")(function* () {
        return yield* load(yield* target())
      })

      const prepare = Effect.fn("StackStore.prepare")(function* (input: PrepareInput) {
        const file = yield* target(true, "create")
        const current = yield* load(file)
        if (current.revision !== input.revision) {
          return yield* new RevisionConflictError({
            path: file,
            expected: input.revision,
            actual: current.revision,
          })
        }

        const stack = yield* Schema.decodeUnknownEffect(Stack.Config)(input.stack, { onExcessProperty: "error" }).pipe(
          Effect.mapError(() => new InvalidStackError({ path: file })),
        )
        const output = yield* patch(current.raw, { ...input, stack }, file)
        yield* decode(output, file)
        if ((yield* target(true, "create")) !== file) return yield* new FileError({ path: file, operation: "create" })
        yield* fs
          .ensureDir(path.dirname(file))
          .pipe(Effect.mapError(() => new FileError({ path: file, operation: "create" })))
        const temp = yield* fs
          .makeTempFileScoped({ directory: path.dirname(file), prefix: ".kilo-stack-", suffix: ".tmp" })
          .pipe(Effect.mapError(() => new FileError({ path: file, operation: "create" })))
        const raw = current.raw
        const backup =
          raw === undefined
            ? undefined
            : yield* fs
                .makeTempFileScoped({ directory: path.dirname(file), prefix: ".kilo-stack-backup-", suffix: ".tmp" })
                .pipe(Effect.mapError(() => new FileError({ path: file, operation: "create" })))
        yield* fs
          .writeFileString(temp, output, { mode: 0o600 })
          .pipe(Effect.mapError(() => new FileError({ path: file, operation: "write" })))
        if (backup !== undefined && raw !== undefined) {
          yield* fs
            .writeFileString(backup, raw, { mode: 0o600 })
            .pipe(Effect.mapError(() => new FileError({ path: file, operation: "write" })))
        }

        const prepared: Prepared = {
          path: file,
          revision: current.revision,
          nextRevision: revision(output),
        }
        const state: State = {
          path: file,
          temp,
          ...(backup === undefined ? {} : { backup }),
          revision: current.revision,
          next: prepared.nextRevision,
        }
        stages.set(prepared, state)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            stages.delete(prepared)
            if (state.commit) commits.delete(state.commit)
          }),
        )
        return prepared
      })

      const commit = Effect.fn("StackStore.commit")(function* (prepared: Prepared) {
        const state = stages.get(prepared)
        if (!state) return yield* new TransactionError({ operation: "commit" })
        if ((yield* target(false, "rename")) !== state.path) {
          return yield* new FileError({ path: state.path, operation: "rename" })
        }
        const actual = revision(yield* source(state.path))
        if (actual !== state.revision) {
          return yield* new RevisionConflictError({ path: state.path, expected: state.revision, actual })
        }
        yield* fs
          .rename(state.temp, state.path)
          .pipe(Effect.mapError(() => new FileError({ path: state.path, operation: "rename" })))
        const committed: Committed = {
          path: state.path,
          revision: state.next,
          previousRevision: state.revision,
        }
        stages.delete(prepared)
        commits.set(committed, state)
        state.commit = committed
        return committed
      })

      const rollback = Effect.fn("StackStore.rollback")(function* (committed: Committed) {
        const state = commits.get(committed)
        if (!state) return yield* new TransactionError({ operation: "rollback" })
        if ((yield* target(false, "rename")) !== state.path) {
          return yield* new FileError({ path: state.path, operation: "rename" })
        }
        const actual = revision(yield* source(state.path))
        if (actual !== state.next) {
          return yield* new RevisionConflictError({ path: state.path, expected: state.next, actual })
        }
        if (state.backup !== undefined) {
          yield* fs
            .rename(state.backup, state.path)
            .pipe(Effect.mapError(() => new FileError({ path: state.path, operation: "rename" })))
        } else {
          yield* fs
            .remove(state.path, { force: true })
            .pipe(Effect.mapError(() => new FileError({ path: state.path, operation: "remove" })))
        }
        commits.delete(committed)
        return undefined
      })

      const withLock: Interface["withLock"] = (body) =>
        Effect.flatMap(target(), (file) => flock.withLock(body, `stack-store:${file}`))

      return Service.of({ path: target, read, prepare, commit, rollback, withLock })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(EffectFlock.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )
}
