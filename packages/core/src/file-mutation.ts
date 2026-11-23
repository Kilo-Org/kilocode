export * as FileMutation from "./file-mutation"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect" // kilocode_change - Option for filesystem identity
import { dirname } from "path"
import { KeyedMutex } from "./effect/keyed-mutex"
import { FSUtil } from "./fs-util"

export interface Target {
  readonly canonical: string
  readonly resource: string
}

export interface WriteInput {
  readonly target: Target
  readonly content: string | Uint8Array
}

// kilocode_change start - bind a write to the filesystem identity the approval covered
export type Identity =
  | { readonly type: "file"; readonly dev: number; readonly ino: number }
  | { readonly type: "absent" }

export class TargetChangedError extends Schema.TaggedErrorClass<TargetChangedError>()(
  "FileMutation.TargetChangedError",
  { path: Schema.String },
) {}

export class TargetKindError extends Schema.TaggedErrorClass<TargetKindError>()("FileMutation.TargetKindError", {
  path: Schema.String,
}) {}
// kilocode_change end

export interface TextWriteInput {
  readonly target: Target
  readonly content: string
  readonly approved: Identity // kilocode_change - the identity observed when the write was approved
}

export interface ConditionalWriteInput extends WriteInput {
  readonly expected: Uint8Array
}

export interface RemoveInput {
  readonly target: Target
}

export class StaleContentError extends Schema.TaggedErrorClass<StaleContentError>()("FileMutation.StaleContentError", {
  path: Schema.String,
}) {}

export class TargetExistsError extends Schema.TaggedErrorClass<TargetExistsError>()("FileMutation.TargetExistsError", {
  path: Schema.String,
}) {}

export interface WriteResult {
  readonly operation: "write"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface RemoveResult {
  readonly operation: "remove"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface Interface {
  // kilocode_change start - identity binding for approved writes
  /**
   * Observe the filesystem identity a write approval covers. Fails with `TargetKindError` when the target is not a
   * regular file or its filesystem identity is unavailable.
   */
  readonly inspect: (target: Target) => Effect.Effect<Identity, FSUtil.Error | TargetKindError>
  // kilocode_change end
  /** Create without replacing an existing target. */
  readonly create: (input: WriteInput) => Effect.Effect<WriteResult, TargetExistsError | FSUtil.Error>
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /** Write text while retaining an existing UTF-8 BOM and emitting at most one BOM. */
  // kilocode_change start - the write must carry its approved identity
  readonly writeTextPreservingBom: (
    input: TextWriteInput,
  ) => Effect.Effect<WriteResult, FSUtil.Error | TargetChangedError>
  // kilocode_change end
  /** Commit only if an existing target still has the expected bytes. */
  readonly writeIfUnchanged: (
    input: ConditionalWriteInput,
  ) => Effect.Effect<WriteResult, StaleContentError | FSUtil.Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<RemoveResult, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileMutation") {}

/**
 * Serialize file changes by canonical target. Conditional writes compare and
 * write under the same process-local lock so cooperating OpenCode mutations do
 * not overwrite changes made from the same stale content.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const withTargetLock =
      (target: Target) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        locks.withLock(target.canonical)(Effect.uninterruptible(effect))

    const writeResult = (target: Target, existed: boolean): WriteResult => ({
      operation: "write",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const removeResult = (target: Target, existed: boolean): RemoveResult => ({
      operation: "remove",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* fs.exists(input.target.canonical)
          yield* fs.writeWithDirs(input.target.canonical, input.content)
          return writeResult(input.target, existed)
        }),
      ),
    )

    // kilocode_change start - observe the filesystem identity a write approval covers
    const inspect = Effect.fn("FileMutation.inspect")(function* (target: Target) {
      const info = yield* fs
        .stat(target.canonical)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
      if (info === undefined) return { type: "absent" } satisfies Identity
      if (info.type !== "File") return yield* Effect.fail(new TargetKindError({ path: target.canonical }))
      const ino = Option.getOrUndefined(info.ino)
      // kilocode_change - a zero inode is not a usable identity: some filesystems report it for every file on the
      // volume, so a dev/ino comparison would match any of them. Fail as a typed error, not a defect.
      if (ino === undefined || ino === 0) return yield* Effect.fail(new TargetKindError({ path: target.canonical }))
      return { type: "file", dev: info.dev, ino } satisfies Identity
    })
    // kilocode_change end

    const writeTextPreservingBom = Effect.fn("FileMutation.writeTextPreservingBom")((input: TextWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          // kilocode_change start - write only the filesystem object the approval covered
          const next = splitBom(input.content)
          if (input.approved.type === "absent") {
            const create = fs.writeFileString(input.target.canonical, joinBom(next.text, next.bom), { flag: "wx" })
            yield* create.pipe(
              Effect.catchReason("PlatformError", "NotFound", () =>
                fs.ensureDir(dirname(input.target.canonical)).pipe(Effect.andThen(create)),
              ),
              Effect.catchReason("PlatformError", "AlreadyExists", () =>
                Effect.fail(new TargetChangedError({ path: input.target.canonical })),
              ),
            )
            return writeResult(input.target, false)
          }
          const approved = input.approved
          const changed = () => new TargetChangedError({ path: input.target.canonical })
          const bom = yield* Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fs
                .open(input.target.canonical, { flag: "r" })
                .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.fail(changed())))
              const info = yield* file.stat
              if (info.dev !== approved.dev || Option.getOrUndefined(info.ino) !== approved.ino)
                return yield* Effect.fail(changed())
              // collect the BOM prefix across short reads
              const head = new Uint8Array(3)
              let size = 0
              while (size < 3) {
                const chunk = yield* file.readAlloc(3 - size)
                if (Option.isNone(chunk)) break
                const bytes = chunk.value
                if (bytes.length === 0) break
                const take = Math.min(bytes.length, 3 - size)
                head.set(bytes.subarray(0, take), size)
                size += take
              }
              return hasUtf8Bom(head.subarray(0, size))
            }),
          )
          // kilocode_change - state the scope of the identity check:
          // the identity is verified on the descriptor opened for the read/BOM probe, so it covers the target identity
          // as of the check. The content write then reopens the path through writeWithDirs. KeyedMutex serializes
          // agent-internal writes to one target.
          yield* fs.writeWithDirs(input.target.canonical, joinBom(next.text, bom || next.bom))
          return writeResult(input.target, true)
          // kilocode_change end
        }),
      ),
    )

    const create = Effect.fn("FileMutation.create")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const write =
            typeof input.content === "string"
              ? fs.writeFileString(input.target.canonical, input.content, { flag: "wx" })
              : fs.writeFile(input.target.canonical, input.content, { flag: "wx" })
          yield* write.pipe(
            Effect.catchReason("PlatformError", "NotFound", () =>
              fs.ensureDir(dirname(input.target.canonical)).pipe(Effect.andThen(write)),
            ),
            Effect.catchReason("PlatformError", "AlreadyExists", () =>
              Effect.fail(new TargetExistsError({ path: input.target.canonical })),
            ),
          )
          return writeResult(input.target, false)
        }),
      ),
    )

    const writeIfUnchanged = Effect.fn("FileMutation.writeIfUnchanged")((input: ConditionalWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const current = yield* fs.readFile(input.target.canonical)
          if (!sameBytes(current, input.expected)) {
            return yield* new StaleContentError({ path: input.target.canonical })
          }
          yield* typeof input.content === "string"
            ? fs.writeFileString(input.target.canonical, input.content)
            : fs.writeFile(input.target.canonical, input.content)
          return writeResult(input.target, true)
        }),
      ),
    )

    const remove = Effect.fn("FileMutation.remove")((input: RemoveInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* fs.remove(input.target.canonical).pipe(
            Effect.as(true),
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
          )
          return removeResult(input.target, existed)
        }),
      ),
    )

    return Service.of({ inspect, create, write, writeTextPreservingBom, writeIfUnchanged, remove }) // kilocode_change - inspect registered
  }),
)

function splitBom(text: string) {
  const stripped = text.replace(/^\uFEFF+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}

function joinBom(text: string, bom: boolean) {
  const stripped = splitBom(text).text
  return bom ? `\uFEFF${stripped}` : stripped
}

function hasUtf8Bom(content: Uint8Array) {
  return content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  return left.every((byte, index) => byte === right[index])
}

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node] })

/**
 * Deferred until the corresponding V2 integrations exist.
 */
// TODO: Add formatter integration after V2 formatter runtime exists.
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after V2 snapshot design exists.
// TODO: Notify LSP and collect diagnostics after V2 LSP runtime exists.
// TODO: Design multi-file transactions / rollback if apply_patch needs atomic edits.
// Until then, edits are sequential and report partial application.
// TODO: Define crash recovery and idempotency for side effects between Tool.Called and durable settlement.
